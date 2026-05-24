import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DoctorDeps } from '@foundry/doctor/deps.js';
import { createDefaultDeps } from '@foundry/doctor/deps.js';
import { runDoctorChecks } from '@foundry/doctor/run.js';
import { printDoctorReport } from '@foundry/doctor/report.js';
import type { BuildState, IssuePlanNode, ProofRecord } from '@foundry/core/types/build.js';
import type { RunRef } from '@foundry/core/state/run-store.js';
import { updateRunStatus, writeRunState } from '@foundry/core/state/run-store.js';
import { appendEvent } from '@foundry/core/comms/events.js';
import {
  formatExecutionOrder,
  parseIssuePlanGraph,
  topologicalOrder,
} from './issue-plan-graph.js';
import { evaluateBuildGoalComplete, formatBuildSummary, deferIssue } from './defer.js';
import { executeIssueWorker, mockAgentWriteFile, type BuildWorkerDeps } from './worker.js';
import { toProofRecord } from './proof-registry.js';
import { readProofJson } from './proof-registry.js';

export interface ExecuteBuildOptions {
  projectRoot: string;
  ref: RunRef;
  dryRun?: boolean;
  deferIssueNumber?: number;
  deps?: Partial<BuildDeps>;
}

export interface BuildDeps {
  doctorDeps: DoctorDeps;
  workerDeps: BuildWorkerDeps;
}

export class BuildPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildPreflightError';
  }
}

export function createDefaultBuildDeps(overrides: Partial<BuildDeps> = {}): BuildDeps {
  return {
    doctorDeps: createDefaultDeps(),
    workerDeps: {
      runAgent: async (opts) => mockAgentWriteFile(opts),
      autoApproveReview: true,
    },
    ...overrides,
  };
}

export async function runBuildPreflight(
  projectRoot: string,
  deps: DoctorDeps,
): Promise<void> {
  const report = await runDoctorChecks(deps, {
    forTarget: 'build',
    deep: false,
    strict: false,
  });

  if (report.exitCode !== 0) {
    printDoctorReport(report, false);
    throw new BuildPreflightError('Build preflight failed (doctor --for build).');
  }
}

function loadIssuePlan(runDir: string): IssuePlanNode[] {
  const issuePlanPath = join(runDir, 'issue-plan.md');
  if (!existsSync(issuePlanPath)) {
    throw new BuildPreflightError('issue-plan.md not found in run directory.');
  }
  return parseIssuePlanGraph(readFileSync(issuePlanPath, 'utf8'));
}

function initBuildState(nodes: IssuePlanNode[]): BuildState {
  return {
    issues: nodes.map((node) => ({
      number: node.number,
      title: node.title,
      type: node.type,
      status: 'pending',
      blocked_by: node.blocked_by,
    })),
    deferred: [],
    goal_complete: false,
  };
}

function nextPendingIssue(build: BuildState, ordered: IssuePlanNode[]): IssuePlanNode | null {
  for (const node of ordered) {
    const state = build.issues.find((issue) => issue.number === node.number);
    if (state?.status === 'pending' && !build.deferred.includes(node.number)) {
      return node;
    }
  }
  return null;
}

export async function executeBuild(options: ExecuteBuildOptions): Promise<RunRef> {
  const { projectRoot, ref, dryRun = false, deferIssueNumber } = options;
  const deps = createDefaultBuildDeps(options.deps);

  if (ref.run.status !== 'approved' && ref.run.status !== 'running' && ref.run.status !== 'paused') {
    throw new BuildPreflightError(
      `Cannot build run in status "${ref.run.status}". Approve the plan first.`,
    );
  }

  await runBuildPreflight(projectRoot, deps.doctorDeps);

  const nodes = loadIssuePlan(ref.runDir);
  const ordered = topologicalOrder(nodes);

  if (dryRun) {
    console.log(formatExecutionOrder(nodes));
    return ref;
  }

  let build = ref.run.build ?? initBuildState(nodes);
  let proofs: ProofRecord[] = ref.run.proofs ?? [];

  if (deferIssueNumber !== undefined) {
    build = deferIssue(build, deferIssueNumber, 'deferred via CLI');
    const updated = writeRunState({
      ...ref,
      run: {
        ...ref.run,
        mode: 'build',
        status: 'running',
        phase: 'build_executing',
        build,
        proofs,
        next_actions: [formatBuildSummary(build)],
      },
    });
    return { ...ref, run: updated };
  }

  let currentRef = updateRunStatus(projectRoot, ref.runId, 'running', {
    phase: 'build_preflight',
    next_actions: ['Starting build execution'],
  });

  currentRef = updateRunStatus(projectRoot, ref.runId, 'running', {
    phase: 'build_executing',
  });

  appendEvent(ref.runDir, {
    type: 'agent_started',
    phase: 'build_executing',
    summary: `Build started with ${ordered.length} issue(s)`,
  });

  while (true) {
    const pending = nextPendingIssue(build, ordered);
    if (!pending) {
      break;
    }

    if (build.deferred.includes(pending.number)) {
      build = {
        ...build,
        issues: build.issues.map((issue) =>
          issue.number === pending.number ? { ...issue, status: 'deferred' } : issue,
        ),
      };
      continue;
    }

    build = { ...build, current_issue: pending.number };

    const workerResult = await executeIssueWorker({
      projectRoot,
      runDir: ref.runDir,
      issue: pending,
      build,
      deps: deps.workerDeps,
    });

    build = workerResult.build;
    const proofPayload = readProofJson(workerResult.proofPath);
    proofs = [...proofs, toProofRecord(workerResult.proofPath, proofPayload)];

    appendEvent(ref.runDir, {
      type: 'artifact_published',
      phase: 'build_executing',
      summary: `Issue #${pending.number} proof recorded`,
      artifact: workerResult.proofPath,
    });

    const written = writeRunState({
      ...currentRef,
      run: {
        ...currentRef.run,
        mode: 'build',
        phase: build.review_status === 'pending' ? 'build_review' : 'build_executing',
        build,
        proofs,
        next_actions: [`Completed issue #${pending.number}`, formatBuildSummary(build)],
      },
    });
    currentRef = { ...currentRef, run: written };
  }

  build = evaluateBuildGoalComplete(build);
  const finalStatus = build.goal_complete ? 'complete' : 'running';
  const finalPhase = build.goal_complete ? 'build_complete' : 'build_executing';

  currentRef = updateRunStatus(projectRoot, ref.runId, finalStatus, {
    phase: finalPhase,
    next_actions: build.goal_complete
      ? ['Build goal complete']
      : [formatBuildSummary(build), 'Resolve deferred issues or resume build'],
  });

  const finalWritten = writeRunState({
    ...currentRef,
    run: {
      ...currentRef.run,
      mode: 'build',
      build,
      proofs,
    },
  });
  currentRef = { ...currentRef, run: finalWritten };

  appendEvent(ref.runDir, {
    type: 'agent_finished',
    phase: finalPhase,
    summary: build.goal_complete ? 'Build goal complete' : 'Build paused with open items',
  });

  return currentRef;
}

export async function resumeBuildFromCheckpoint(options: ExecuteBuildOptions): Promise<RunRef> {
  const ref = options.ref;
  if (!ref.run.build) {
    throw new BuildPreflightError('No build checkpoint to resume.');
  }

  const resumed = updateRunStatus(options.projectRoot, ref.runId, 'running', {
    phase: 'build_executing',
    next_actions: [`Resuming issue #${ref.run.build.current_issue ?? 'next'}`],
  });

  return executeBuild({ ...options, ref: resumed });
}

export function handleBuildError(error: unknown): never {
  if (error instanceof BuildPreflightError) {
    console.error(`foundry build: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
