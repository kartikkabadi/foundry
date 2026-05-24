import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMonorepoRoot } from '@foundry/core/paths.js';
import type { DoctorDeps } from '@foundry/doctor/deps.js';
import { createDefaultDeps } from '@foundry/doctor/deps.js';
import { printDoctorReport } from '@foundry/doctor/report.js';
import { runDoctorChecks } from '@foundry/doctor/run.js';
import { promptComposer } from '@foundry/adapters/cursor.js';
import {
  agentPassBudgetFromProfile,
  DEFAULT_BUDGET,
  resolveBudgetProfile,
} from '@foundry/core/config/budget-profiles.js';
import type { RunBudget } from '@foundry/core/types/run.js';
import {
  ALGORITHM_PASS_ARTIFACTS,
  assertAlgorithmPassArtifacts,
  assertSynthesisArtifacts,
  parseDelimitedArtifacts,
  REQUIRED_SYNTHESIS_ARTIFACTS,
  writeArtifact,
} from './artifacts.js';
import { validateIntentCoverage } from './coverage-slots.js';
import { collectIntake, formatIntakeMarkdown } from './intake.js';
import {
  buildAlgorithmPassPrompt,
  buildInterviewPrompt,
  buildResearchPrompt,
  buildSynthesisPrompt,
  DEFAULT_AUTONOMY_CONTRACT,
} from './prompts.js';
import { safeErrorMessage } from '@foundry/core/config/secrets.js';
import { appendEvent, appendThreadHandoff } from '@foundry/core/comms/events.js';
import {
  createRun,
  pauseRun,
  updateRunStatus,
  writeRunState,
  type RunRef,
} from '@foundry/core/state/run-writer.js';

const pkgPath = join(getMonorepoRoot(import.meta.url), 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

export class AgentPassBudgetExhaustedError extends Error {
  constructor(message = 'Agent-pass budget exhausted; run paused at checkpoint.') {
    super(message);
    this.name = 'AgentPassBudgetExhaustedError';
  }
}

export interface PlanDeps {
  doctorDeps: DoctorDeps;
  promptAgent: (prompt: string, cwd: string) => Promise<string>;
  isTTY: boolean;
  cannedIntakeAnswers?: string[];
}

export interface ExecutePlanOptions {
  idea: string;
  projectRoot: string;
  budget?: RunBudget;
  deps?: Partial<PlanDeps>;
}

export interface ResumePlanOptions {
  projectRoot: string;
  ref: RunRef;
  deps?: Partial<PlanDeps>;
}

export function createDefaultPlanDeps(overrides: Partial<PlanDeps> = {}): PlanDeps {
  return {
    doctorDeps: createDefaultDeps(),
    promptAgent: promptComposer,
    isTTY: process.stdin.isTTY,
    ...overrides,
  };
}

function artifactPath(runDir: string, name: string): string {
  return join(runDir, name);
}

function hasArtifact(ref: RunRef, name: string): boolean {
  return existsSync(artifactPath(ref.runDir, name));
}

function readArtifact(ref: RunRef, name: string): string {
  return readFileSync(artifactPath(ref.runDir, name), 'utf8');
}

function parseIdeaFromIntake(intakeMd: string): string {
  const match = intakeMd.match(/\*\*Idea:\*\* (.+)/);
  if (!match?.[1]) {
    throw new Error('Could not parse idea from intake.md');
  }
  return match[1].trim();
}

function updateRunPhase(ref: RunRef, phase: RunRef['run']['phase'], artifacts: string[]): RunRef {
  const updated = {
    ...ref.run,
    phase,
    artifacts: [...new Set([...ref.run.artifacts, ...artifacts])],
  };
  const written = writeRunState({ ...ref, run: updated });
  return { ...ref, run: written };
}

function incrementAgentPass(ref: RunRef): RunRef {
  const used = ref.run.agent_pass_budget.used + 1;
  const updated = {
    ...ref.run,
    agent_pass_budget: {
      ...ref.run.agent_pass_budget,
      used,
    },
  };
  const written = writeRunState({ ...ref, run: updated });
  return { ...ref, run: written };
}

async function consumeAgentPass(
  ref: RunRef,
  projectRoot: string,
  fn: () => Promise<string>,
): Promise<{ ref: RunRef; result: string }> {
  if (ref.run.agent_pass_budget.used >= ref.run.agent_pass_budget.limit) {
    pauseRun(projectRoot, 'Agent-pass budget exhausted — resume with `foundry resume`');
    throw new AgentPassBudgetExhaustedError();
  }

  const result = await fn();
  const updatedRef = incrementAgentPass(ref);
  return { ref: updatedRef, result };
}

async function runDoctorPreflight(deps: PlanDeps): Promise<void> {
  const report = await runDoctorChecks(deps.doctorDeps, {
    forTarget: 'plan',
    deep: true,
    strict: false,
  });

  if (report.exitCode !== 0) {
    printDoctorReport(report, false);
    console.error('\nPlan aborted: doctor preflight failed.');
    console.error('Fix issues above, then re-run `foundry doctor --for plan --deep`.');
    process.exit(1);
  }
}

function logArtifactPublished(ref: RunRef, phase: string, filename: string): void {
  appendEvent(ref.runDir, {
    type: 'artifact_published',
    phase,
    summary: `Published ${filename}`,
    artifact: filename,
    thread: 'plan.md',
  });
  appendThreadHandoff(
    ref.runDir,
    'plan.md',
    filename,
    `Handoff: ${filename} ready for review.`,
  );
}

function startPhase(ref: RunRef, phase: string, summary: string): void {
  appendEvent(ref.runDir, {
    type: 'agent_started',
    phase,
    summary,
    thread: 'plan.md',
  });
  appendThreadHandoff(ref.runDir, 'plan.md', phase, summary);
}

function finishPhase(ref: RunRef, phase: string, summary: string): void {
  appendEvent(ref.runDir, {
    type: 'agent_finished',
    phase,
    summary,
    thread: 'plan.md',
  });
}

async function orchestrateFromPhase(
  ref: RunRef,
  idea: string,
  projectRoot: string,
  deps: PlanDeps,
): Promise<RunRef> {
  let intakeMd = hasArtifact(ref, 'intake.md') ? readArtifact(ref, 'intake.md') : '';

  if (!hasArtifact(ref, 'intake.md')) {
    startPhase(ref, 'intake', 'Collecting intake answers');
    const intake = await collectIntake(idea, {
      isTTY: deps.isTTY,
      cannedAnswers: deps.cannedIntakeAnswers,
    });
    intakeMd = formatIntakeMarkdown(intake.idea, intake.answers);
    writeArtifact(ref.runDir, 'intake.md', intakeMd);
    logArtifactPublished(ref, 'intake', 'intake.md');
    finishPhase(ref, 'intake', 'Intake complete');
    ref = updateRunPhase(ref, 'research', ['intake.md']);
  } else if (ref.run.phase === 'init') {
    ref = updateRunPhase(ref, 'research', ['intake.md']);
  }

  let researchMd = hasArtifact(ref, 'research.md') ? readArtifact(ref, 'research.md') : '';

  if (!hasArtifact(ref, 'research.md')) {
    console.log('\nResearching…');
    startPhase(ref, 'research', 'Running research agent pass');
    const pass = await consumeAgentPass(ref, projectRoot, () =>
      deps.promptAgent(buildResearchPrompt(idea, intakeMd), projectRoot),
    );
    ref = pass.ref;
    researchMd = pass.result;
    writeArtifact(ref.runDir, 'research.md', researchMd);
    logArtifactPublished(ref, 'research', 'research.md');
    finishPhase(ref, 'research', 'Research complete');
    ref = updateRunPhase(ref, 'interview', ['research.md']);
  } else if (
    ref.run.phase === 'research' ||
    ref.run.phase === 'init'
  ) {
    ref = updateRunPhase(ref, 'interview', ['research.md']);
  }

  let intentRaw = hasArtifact(ref, 'intent.md') ? readArtifact(ref, 'intent.md') : '';

  if (!hasArtifact(ref, 'intent.md')) {
    console.log('Interview (10 coverage slots)…');
    startPhase(ref, 'interview', 'Running intent interview');
    const pass = await consumeAgentPass(ref, projectRoot, () =>
      deps.promptAgent(buildInterviewPrompt(idea, intakeMd, researchMd), projectRoot),
    );
    ref = pass.ref;
    intentRaw = pass.result;
    validateIntentCoverage(intentRaw);
    writeArtifact(ref.runDir, 'intent.md', intentRaw);
    logArtifactPublished(ref, 'interview', 'intent.md');
    finishPhase(ref, 'interview', 'Intent interview complete');
    ref = updateRunPhase(ref, 'algorithm_pass', ['intent.md']);
  } else if (ref.run.phase === 'interview') {
    ref = updateRunPhase(ref, 'algorithm_pass', ['intent.md']);
  }

  const algorithmComplete = ALGORITHM_PASS_ARTIFACTS.every((name) => hasArtifact(ref, name));
  let algorithmWritten = ALGORITHM_PASS_ARTIFACTS.filter((name) => hasArtifact(ref, name));

  if (!algorithmComplete) {
    console.log('Algorithm Pass…');
    startPhase(ref, 'algorithm_pass', 'Running algorithm pass');
    const pass = await consumeAgentPass(ref, projectRoot, () =>
      deps.promptAgent(
        buildAlgorithmPassPrompt(idea, intakeMd, researchMd, intentRaw),
        projectRoot,
      ),
    );
    ref = pass.ref;
    const algorithmParsed = parseDelimitedArtifacts(pass.result);
    assertAlgorithmPassArtifacts(algorithmParsed);

    algorithmWritten = [];
    for (const name of ALGORITHM_PASS_ARTIFACTS) {
      if (!hasArtifact(ref, name)) {
        writeArtifact(ref.runDir, name, algorithmParsed.get(name)!);
        logArtifactPublished(ref, 'algorithm_pass', name);
      }
      algorithmWritten.push(name);
    }
    finishPhase(ref, 'algorithm_pass', 'Algorithm pass complete');
    ref = updateRunPhase(ref, 'synthesis', algorithmWritten);
  } else if (ref.run.phase === 'algorithm_pass') {
    ref = updateRunPhase(ref, 'synthesis', algorithmWritten);
  }

  const algorithmSummary = ALGORITHM_PASS_ARTIFACTS.map(
    (name) => `### ${name}\n${readArtifact(ref, name)}`,
  ).join('\n\n');

  const synthesisComplete =
    REQUIRED_SYNTHESIS_ARTIFACTS.every((name) => hasArtifact(ref, name)) &&
    hasArtifact(ref, 'autonomy-contract.md');

  if (!synthesisComplete) {
    console.log('Synthesizing planning artifacts…');
    startPhase(ref, 'synthesis', 'Running synthesis pass');
    const pass = await consumeAgentPass(ref, projectRoot, () =>
      deps.promptAgent(
        buildSynthesisPrompt(idea, intakeMd, researchMd, intentRaw, algorithmSummary),
        projectRoot,
      ),
    );
    ref = pass.ref;
    const synthesisParsed = parseDelimitedArtifacts(pass.result);
    assertSynthesisArtifacts(synthesisParsed);

    const writtenArtifacts: string[] = [];
    for (const name of REQUIRED_SYNTHESIS_ARTIFACTS) {
      if (!hasArtifact(ref, name)) {
        writeArtifact(ref.runDir, name, synthesisParsed.get(name)!);
        logArtifactPublished(ref, 'synthesis', name);
      }
      writtenArtifacts.push(name);
    }

    if (!hasArtifact(ref, 'autonomy-contract.md')) {
      writeArtifact(ref.runDir, 'autonomy-contract.md', DEFAULT_AUTONOMY_CONTRACT);
      logArtifactPublished(ref, 'synthesis', 'autonomy-contract.md');
    }
    writtenArtifacts.push('autonomy-contract.md');
    finishPhase(ref, 'synthesis', 'Plan synthesis complete — awaiting approval');

    ref = updateRunStatus(projectRoot, ref.runId, 'awaiting_approval', {
      phase: 'awaiting_approval',
      next_actions: ['Review artifacts and run `foundry approve` to continue'],
      blocked_actions: ['build', 'publish issues'],
      artifacts: [
        'intake.md',
        'research.md',
        'intent.md',
        ...algorithmWritten,
        ...writtenArtifacts,
      ],
    });
  }

  return ref;
}

export async function executePlan(options: ExecutePlanOptions): Promise<RunRef> {
  const { idea, projectRoot, budget = DEFAULT_BUDGET } = options;
  const deps = createDefaultPlanDeps(options.deps);

  await runDoctorPreflight(deps);

  const profile = resolveBudgetProfile(budget);
  let ref: RunRef = createRun(projectRoot, pkg.version, {
    mode: 'plan',
    budget: profile.budget,
    phase: 'init',
    status: 'running',
    agent_pass_budget: agentPassBudgetFromProfile(profile),
    next_actions: ['Complete intake'],
  });

  return orchestrateFromPhase(ref, idea, projectRoot, deps);
}

export async function resumePlanFromCheckpoint(options: ResumePlanOptions): Promise<RunRef> {
  const { projectRoot, ref: inputRef } = options;
  const deps = createDefaultPlanDeps(options.deps);

  if (inputRef.run.mode !== 'plan') {
    throw new Error(`Cannot resume plan: run mode is ${inputRef.run.mode}`);
  }

  if (inputRef.run.status === 'awaiting_approval' || inputRef.run.status === 'approved') {
    return inputRef;
  }

  const idea = hasArtifact(inputRef, 'intake.md')
    ? parseIdeaFromIntake(readArtifact(inputRef, 'intake.md'))
    : '';

  if (!idea) {
    throw new Error('Cannot resume plan: intake.md missing and idea unknown.');
  }

  let ref = updateRunStatus(projectRoot, inputRef.runId, 'running', {
    next_actions: [`Resuming plan at phase ${inputRef.run.phase}`],
  });

  return orchestrateFromPhase(ref, idea, projectRoot, deps);
}

export function printPlanCompleteBanner(ref: RunRef): void {
  const paths = [
    'run.json',
    'status.md',
    'intake.md',
    'research.md',
    'intent.md',
    ...ALGORITHM_PASS_ARTIFACTS,
    ...REQUIRED_SYNTHESIS_ARTIFACTS,
    'autonomy-contract.md',
  ];

  console.log('\nPlan complete — approve to continue\n');
  console.log(`Run: ${ref.runId}`);
  console.log(`Directory: ${ref.runDir}\n`);
  console.log('Artifacts:');
  for (const name of paths) {
    console.log(`  ${join(ref.runDir, name)}`);
  }
  console.log('\nStatus: awaiting_approval (build blocked until approved)');
}

export function handlePlanError(err: unknown): never {
  console.error(`foundry plan: ${safeErrorMessage(err)}`);
  process.exit(1);
}
