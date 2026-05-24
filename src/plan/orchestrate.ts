import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { DoctorDeps } from '../doctor/deps.js';
import { createDefaultDeps } from '../doctor/deps.js';
import { printDoctorReport } from '../doctor/report.js';
import { runDoctorChecks } from '../doctor/run.js';
import { promptComposer } from '../adapters/cursor.js';
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
import { safeErrorMessage } from './secrets.js';
import {
  createRun,
  updateRunStatus,
  writeRunState,
  type RunRef,
} from '../state/run-writer.js';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

export interface PlanDeps {
  doctorDeps: DoctorDeps;
  promptAgent: (prompt: string, cwd: string) => Promise<string>;
  isTTY: boolean;
  cannedIntakeAnswers?: string[];
}

export interface ExecutePlanOptions {
  idea: string;
  projectRoot: string;
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

function updateRunPhase(ref: RunRef, phase: RunRef['run']['phase'], artifacts: string[]): RunRef {
  const updated = {
    ...ref.run,
    phase,
    artifacts: [...new Set([...ref.run.artifacts, ...artifacts])],
  };
  const written = writeRunState({ ...ref, run: updated });
  return { ...ref, run: written };
}

export async function executePlan(options: ExecutePlanOptions): Promise<RunRef> {
  const { idea, projectRoot } = options;
  const deps = createDefaultPlanDeps(options.deps);

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

  let ref: RunRef = createRun(projectRoot, pkg.version, {
    mode: 'plan',
    phase: 'init',
    status: 'running',
    next_actions: ['Complete intake'],
  });

  const intake = await collectIntake(idea, {
    isTTY: deps.isTTY,
    cannedAnswers: deps.cannedIntakeAnswers,
  });
  const intakeMd = formatIntakeMarkdown(intake.idea, intake.answers);
  writeArtifact(ref.runDir, 'intake.md', intakeMd);
  ref = updateRunPhase(ref, 'research', ['intake.md']);

  console.log('\nResearching…');
  const researchRaw = await deps.promptAgent(
    buildResearchPrompt(idea, intakeMd),
    projectRoot,
  );
  writeArtifact(ref.runDir, 'research.md', researchRaw);
  ref = updateRunPhase(ref, 'interview', ['research.md']);

  console.log('Interview (10 coverage slots)…');
  const researchMd = researchRaw;
  const intentRaw = await deps.promptAgent(
    buildInterviewPrompt(idea, intakeMd, researchMd),
    projectRoot,
  );
  validateIntentCoverage(intentRaw);
  writeArtifact(ref.runDir, 'intent.md', intentRaw);
  ref = updateRunPhase(ref, 'algorithm_pass', ['intent.md']);

  console.log('Algorithm Pass…');
  const algorithmRaw = await deps.promptAgent(
    buildAlgorithmPassPrompt(idea, intakeMd, researchMd, intentRaw),
    projectRoot,
  );
  const algorithmParsed = parseDelimitedArtifacts(algorithmRaw);
  assertAlgorithmPassArtifacts(algorithmParsed);

  const algorithmWritten: string[] = [];
  for (const name of ALGORITHM_PASS_ARTIFACTS) {
    writeArtifact(ref.runDir, name, algorithmParsed.get(name)!);
    algorithmWritten.push(name);
  }

  const algorithmSummary = ALGORITHM_PASS_ARTIFACTS.map(
    (name) => `### ${name}\n${algorithmParsed.get(name)}`,
  ).join('\n\n');

  ref = updateRunPhase(ref, 'synthesis', algorithmWritten);

  console.log('Synthesizing planning artifacts…');
  const synthesisRaw = await deps.promptAgent(
    buildSynthesisPrompt(idea, intakeMd, researchMd, intentRaw, algorithmSummary),
    projectRoot,
  );
  const synthesisParsed = parseDelimitedArtifacts(synthesisRaw);
  assertSynthesisArtifacts(synthesisParsed);

  const writtenArtifacts: string[] = [];
  for (const name of REQUIRED_SYNTHESIS_ARTIFACTS) {
    writeArtifact(ref.runDir, name, synthesisParsed.get(name)!);
    writtenArtifacts.push(name);
  }

  writeArtifact(ref.runDir, 'autonomy-contract.md', DEFAULT_AUTONOMY_CONTRACT);
  writtenArtifacts.push('autonomy-contract.md');

  ref = updateRunStatus(projectRoot, ref.runId, 'awaiting_approval', {
    phase: 'awaiting_approval',
    next_actions: ['Review artifacts and approve to continue'],
    blocked_actions: ['build', 'publish issues'],
    artifacts: [
      'intake.md',
      'research.md',
      'intent.md',
      ...algorithmWritten,
      ...writtenArtifacts,
    ],
  });

  return ref;
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
