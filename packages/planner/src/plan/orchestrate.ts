import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dispatchRunNotification } from '@foundry/adapters/notify/dispatch.js';
import { getMonorepoRoot } from '@foundry/core/paths.js';
import type { DoctorDeps } from '@foundry/doctor/deps.js';
import { createDefaultDeps } from '@foundry/doctor/deps.js';
import { printDoctorReport } from '@foundry/doctor/report.js';
import { runDoctorChecks } from '@foundry/doctor/run.js';
import { resolveModePreflightChecks } from '@foundry/doctor/preflight-options.js';
import { createBrowserCaptureAdapter } from '@foundry/adapters/browser-capture.js';
import { promptComposer } from '@foundry/adapters/cursor.js';
import { LoopDetector } from '@foundry/core/loop/detection.js';
import { appendEvent, appendThreadHandoff } from '@foundry/core/comms/events.js';
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
import { invokeAgentWithCheckpoint } from '../agent-invoke.js';
import {
  assertAgentPassBudgetAvailable,
  AgentPassBudgetExhaustedError,
  AgentPassCheckpointError,
  evaluateAgentPassAfterIncrement,
  recordLoopSignal,
} from './agent-pass-policy.js';
import { listOpenConflicts, writeConflict } from '@foundry/core/conflicts/conflict.js';
import { runResearchSwarm } from './swarm.js';
import { detectSwarmDisagreement } from './swarm-disagreement.js';
import {
  createRun,
  updateRunStatus,
  writeRunState,
  type RunRef,
} from '@foundry/core/state/run-writer.js';

const pkgPath = join(getMonorepoRoot(import.meta.url), 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

export { AgentPassBudgetExhaustedError, AgentPassCheckpointError } from './agent-pass-policy.js';

export interface PlanDeps {
  doctorDeps: DoctorDeps;
  promptAgent: (prompt: string, cwd: string) => Promise<string>;
  isTTY: boolean;
  cannedIntakeAnswers?: string[];
  browserCapture?: ReturnType<typeof createBrowserCaptureAdapter>;
  loopDetector?: LoopDetector;
}

export interface ExecutePlanOptions {
  idea: string;
  projectRoot: string;
  budget?: RunBudget;
  referenceUrl?: string;
  swarmResearch?: boolean;
  swarmBranches?: number;
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
    browserCapture: createBrowserCaptureAdapter(),
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
  phase: string,
  deps: PlanDeps,
  fn: () => Promise<string>,
): Promise<{ ref: RunRef; result: string }> {
  assertAgentPassBudgetAvailable(ref, projectRoot);

  const loopDetector =
    deps.loopDetector ?? new LoopDetector({ budget: ref.run.budget });
  recordLoopSignal(ref, projectRoot, phase, loopDetector);

  const invoked = await invokeAgentWithCheckpoint({
    ref,
    projectRoot,
    phase,
    fn,
  });
  const updatedRef = incrementAgentPass(invoked.ref);
  evaluateAgentPassAfterIncrement(updatedRef, projectRoot, phase);
  return { ref: updatedRef, result: invoked.result };
}

async function runDoctorPreflight(deps: PlanDeps): Promise<void> {
  const report = await runDoctorChecks(deps.doctorDeps, resolveModePreflightChecks('plan'));

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

function appendSwarmProvenance(runDir: string, researchMd: string): string {
  const provenancePath = join(runDir, 'swarm-provenance.md');
  if (!existsSync(provenancePath)) {
    return researchMd;
  }
  const provenance = readFileSync(provenancePath, 'utf8').trim();
  if (!provenance) {
    return researchMd;
  }
  return `${researchMd}\n\n## Swarm provenance (citations)\n\n${provenance}\n`;
}

function approvalGateActions(runDir: string): {
  next_actions: string[];
  blocked_actions: string[];
} {
  const openConflicts = listOpenConflicts(runDir);
  if (openConflicts.length === 0) {
    return {
      next_actions: ['Review artifacts and run `foundry approve` to continue'],
      blocked_actions: ['build', 'publish issues'],
    };
  }

  const ids = openConflicts.map((conflict) => conflict.id).join(', ');
  return {
    next_actions: [`Resolve open conflicts before approval: ${ids}`],
    blocked_actions: ['approve', 'build', 'publish issues'],
  };
}

interface OrchestrateContext {
  referenceUrl?: string;
  swarmResearch?: boolean;
  swarmBranches?: number;
}

async function orchestrateFromPhase(
  ref: RunRef,
  idea: string,
  projectRoot: string,
  deps: PlanDeps,
  context: OrchestrateContext = {},
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

  if (context.referenceUrl && !hasArtifact(ref, 'reference-requirements.md')) {
    const capture = deps.browserCapture ?? createBrowserCaptureAdapter();
    const captured = await capture.summarizeUrl(context.referenceUrl);
    if (captured.ok) {
      writeArtifact(
        ref.runDir,
        'reference-requirements.md',
        `# Reference requirements\n\nSource: ${captured.url}\n\n${captured.summary}\n`,
      );
      logArtifactPublished(ref, 'research', 'reference-requirements.md');
    }
  }

  if (!hasArtifact(ref, 'research.md')) {
    console.log('\nResearching…');
    startPhase(ref, 'research', 'Running research agent pass');

    if (context.swarmResearch) {
      const profile = resolveBudgetProfile(ref.run.budget);
      const requested = context.swarmBranches ?? 2;
      const branchCount = Math.min(Math.max(requested, 2), Math.max(2, profile.max_active));
      const swarm = await runResearchSwarm(ref, {
        idea,
        branchCount,
        parallel: true,
        runSwarm: async (branchId, branchIdea) => {
          const pass = await consumeAgentPass(ref, projectRoot, 'swarm_research', deps, () =>
            deps.promptAgent(buildResearchPrompt(branchIdea, intakeMd), projectRoot),
          );
          ref = pass.ref;
          return {
            branchId,
            citation: `swarm://${branchId}`,
            summary: pass.result.slice(0, 500),
          };
        },
      });
      ref = swarm.ref;
      researchMd = appendSwarmProvenance(ref.runDir, swarm.mergedMd);

      const disagreement = detectSwarmDisagreement(swarm.branches);
      if (disagreement) {
        writeConflict(ref.runDir, {
          id: 'swarm-disagreement',
          prd_section: disagreement.prd_section,
          summary: disagreement.summary,
          status: 'open',
          created_at: new Date().toISOString(),
        });
        appendEvent(ref.runDir, {
          type: 'conflict_raised',
          phase: 'research',
          summary: disagreement.summary,
          thread: 'research.md',
        });
      }
    } else {
      const pass = await consumeAgentPass(ref, projectRoot, 'research', deps, () =>
        deps.promptAgent(buildResearchPrompt(idea, intakeMd), projectRoot),
      );
      ref = pass.ref;
      researchMd = pass.result;
    }

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
    const pass = await consumeAgentPass(ref, projectRoot, 'interview', deps, () =>
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
    const pass = await consumeAgentPass(ref, projectRoot, 'algorithm_pass', deps, () =>
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
    const pass = await consumeAgentPass(ref, projectRoot, 'synthesis', deps, () =>
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

    const gateActions = approvalGateActions(ref.runDir);
    ref = updateRunStatus(projectRoot, ref.runId, 'awaiting_approval', {
      phase: 'awaiting_approval',
      next_actions: gateActions.next_actions,
      blocked_actions: gateActions.blocked_actions,
      artifacts: [
        'intake.md',
        'research.md',
        'intent.md',
        ...algorithmWritten,
        ...writtenArtifacts,
      ],
    });

    void dispatchRunNotification({
      event: 'approval_waiting',
      title: 'Foundry',
      body: 'Plan awaiting approval — review artifacts in .foundry/runs/',
    }).catch(() => undefined);
  }

  return ref;
}

export async function executePlan(options: ExecutePlanOptions): Promise<RunRef> {
  const {
    idea,
    projectRoot,
    budget = DEFAULT_BUDGET,
    referenceUrl,
    swarmResearch,
    swarmBranches,
  } = options;
  const deps = createDefaultPlanDeps({
    ...options.deps,
    loopDetector: options.deps?.loopDetector ?? new LoopDetector({ budget }),
  });

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

  return orchestrateFromPhase(ref, idea, projectRoot, deps, {
    referenceUrl,
    swarmResearch,
    swarmBranches,
  });
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

  return orchestrateFromPhase(ref, idea, projectRoot, deps, {});
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

  const openConflicts = listOpenConflicts(ref.runDir);
  const hasOpenConflicts = openConflicts.length > 0;

  console.log(
    hasOpenConflicts
      ? '\nPlan complete — conflicts require resolution\n'
      : '\nPlan complete — approve to continue\n',
  );
  console.log(`Run: ${ref.runId}`);
  console.log(`Directory: ${ref.runDir}\n`);
  console.log('Artifacts:');
  for (const name of paths) {
    console.log(`  ${join(ref.runDir, name)}`);
  }
  if (hasOpenConflicts) {
    const ids = openConflicts.map((conflict) => conflict.id).join(', ');
    console.log(`\nStatus: awaiting_approval (approval/build blocked by open conflicts: ${ids})`);
  } else {
    console.log('\nStatus: awaiting_approval (build blocked until approved)');
  }
}

export function handlePlanError(err: unknown): never {
  console.error(`foundry plan: ${safeErrorMessage(err)}`);
  process.exit(1);
}
