import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DoctorDeps } from '@foundry/doctor/deps.js';
import { createDefaultDeps } from '@foundry/doctor/deps.js';
import { runDoctorChecks } from '@foundry/doctor/run.js';
import { isMockBuild, resolveModePreflightChecks } from '@foundry/doctor/preflight-options.js';
import { printDoctorReport } from '@foundry/doctor/report.js';
import type { BuildState, IssuePlanNode, ProofRecord } from '@foundry/core/types/build.js';
import { assertApproved, GateError } from '@foundry/core/gates.js';
import type { RunRef } from '@foundry/core/state/run-store.js';
import { updateRunStatus, writeRunState } from '@foundry/core/state/run-store.js';
import { appendEvent } from '@foundry/core/comms/events.js';
import {
  depsSatisfied,
  formatExecutionOrder,
  parseIssuePlanGraph,
  topologicalOrder,
} from './issue-plan-graph.js';
import { computeBuildWaves } from './parallel-schedule.js';
import { evaluateBuildGoalComplete, formatBuildSummary, deferIssue } from './defer.js';
import { runBuildAgent } from '@foundry/adapters/build-agent.js';
import { executeIssueWorker, mockAgentWriteFile, type BuildWorkerDeps } from './worker.js';
import { toProofRecord } from './proof-registry.js';
import { readProofJson } from './proof-registry.js';

export interface ExecuteBuildOptions {
  projectRoot: string;
  ref: RunRef;
  dryRun?: boolean;
  deferIssueNumber?: number;
  /** Max concurrent issue workers per wave (default 1 = serial). Capped at 3. */
  parallel?: number;
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

function defaultRunAgent(
  opts: Parameters<BuildWorkerDeps['runAgent']>[0],
): ReturnType<BuildWorkerDeps['runAgent']> {
  if (isMockBuild()) {
    return Promise.resolve(mockAgentWriteFile(opts));
  }
  return runBuildAgent({
    issue: opts.issue,
    worktreePath: opts.worktreePath,
    projectRoot: opts.projectRoot,
  });
}

export function createDefaultBuildDeps(overrides: Partial<BuildDeps> = {}): BuildDeps {
  const mockMode = isMockBuild();
  return {
    doctorDeps: createDefaultDeps(),
    workerDeps: {
      runAgent: defaultRunAgent,
      autoApproveReview: mockMode,
    },
    ...overrides,
  };
}

export async function runBuildPreflight(
  projectRoot: string,
  deps: DoctorDeps,
): Promise<void> {
  const report = await runDoctorChecks(deps, resolveModePreflightChecks('build'));

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

export function nextPendingIssue(
  build: BuildState,
  ordered: IssuePlanNode[],
): IssuePlanNode | null {
  for (const node of ordered) {
    const state = build.issues.find((issue) => issue.number === node.number);
    if (
      state?.status === 'pending' &&
      !build.deferred.includes(node.number) &&
      depsSatisfied(build, node)
    ) {
      return node;
    }
  }
  return null;
}

function mergeWorkerBuild(base: BuildState, workerResult: Awaited<ReturnType<typeof executeIssueWorker>>): BuildState {
  return {
    ...workerResult.build,
    issues: base.issues.map((entry) => {
      const updated = workerResult.build.issues.find((i) => i.number === entry.number);
      return updated && workerResult.issue.number === entry.number ? updated : entry;
    }),
    deferred: base.deferred,
    current_issue: workerResult.build.current_issue,
    review_status: workerResult.build.review_status ?? base.review_status,
    goal_complete: base.goal_complete,
  };
}

function recordWorkerProof(
  runDir: string,
  issueNumber: number,
  proofPath: string,
  waveLabel: string,
): ProofRecord {
  const proofPayload = readProofJson(proofPath);
  appendEvent(runDir, {
    type: 'artifact_published',
    phase: 'build_executing',
    summary: `Issue #${issueNumber} proof recorded${waveLabel}`,
    artifact: proofPath,
  });
  return toProofRecord(proofPath, proofPayload);
}

/** Run one wave of issue workers (serial when wave length is 1). */
async function executeWave(
  issues: IssuePlanNode[],
  ctx: {
    projectRoot: string;
    runDir: string;
    deps: BuildDeps;
    getBuild: () => BuildState;
    setBuild: (build: BuildState) => void;
    getProofs: () => ProofRecord[];
    setProofs: (proofs: ProofRecord[]) => void;
    getCurrentRef: () => RunRef;
    setCurrentRef: (ref: RunRef) => void;
  },
): Promise<void> {
  if (issues.length === 0) {
    return;
  }

  const waveLabel = issues.length > 1 ? ' (wave)' : '';

  if (issues.length === 1) {
    const issue = issues[0]!;
    let build: BuildState = { ...ctx.getBuild(), current_issue: issue.number };
    const workerResult = await executeIssueWorker({
      projectRoot: ctx.projectRoot,
      runDir: ctx.runDir,
      issue,
      build,
      deps: ctx.deps.workerDeps,
    });
    build = workerResult.build;
    const proof = recordWorkerProof(ctx.runDir, issue.number, workerResult.proofPath, waveLabel);
    const proofs = [...ctx.getProofs(), proof];
    ctx.setBuild(build);
    ctx.setProofs(proofs);
    const written = writeRunState({
      ...ctx.getCurrentRef(),
      run: {
        ...ctx.getCurrentRef().run,
        mode: 'build',
        phase: build.review_status === 'pending' ? 'build_review' : 'build_executing',
        build,
        proofs,
        next_actions: [`Completed issue #${issue.number}`, formatBuildSummary(build)],
      },
    });
    ctx.setCurrentRef({ ...ctx.getCurrentRef(), run: written });
    return;
  }

  let build = ctx.getBuild();
  const results = await Promise.all(
    issues.map(async (issue) => {
      const snapshot = structuredClone(build);
      return executeIssueWorker({
        projectRoot: ctx.projectRoot,
        runDir: ctx.runDir,
        issue,
        build: snapshot,
        deps: ctx.deps.workerDeps,
      });
    }),
  );

  for (const workerResult of results) {
    build = mergeWorkerBuild(build, workerResult);
    const proof = recordWorkerProof(
      ctx.runDir,
      workerResult.issue.number,
      workerResult.proofPath,
      waveLabel,
    );
    ctx.setProofs([...ctx.getProofs(), proof]);
  }

  ctx.setBuild(build);
  const proofs = ctx.getProofs();
  const written = writeRunState({
    ...ctx.getCurrentRef(),
    run: {
      ...ctx.getCurrentRef().run,
      mode: 'build',
      phase: build.review_status === 'pending' ? 'build_review' : 'build_executing',
      build,
      proofs,
      next_actions: [formatBuildSummary(build)],
    },
  });
  ctx.setCurrentRef({ ...ctx.getCurrentRef(), run: written });
}

export async function executeBuild(options: ExecuteBuildOptions): Promise<RunRef> {
  const { projectRoot, ref, dryRun = false, deferIssueNumber } = options;
  const deps = createDefaultBuildDeps(options.deps);

  try {
    assertApproved(ref.run);
  } catch (error) {
    if (error instanceof GateError) {
      throw new BuildPreflightError(error.message);
    }
    throw error;
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

  const parallel = Math.min(3, Math.max(1, options.parallel ?? 1));

  appendEvent(ref.runDir, {
    type: 'agent_started',
    phase: 'build_executing',
    summary: `Build started with ${ordered.length} issue(s)${parallel > 1 ? ` (parallel=${parallel})` : ''}`,
  });

  const byNumber = new Map(nodes.map((n) => [n.number, n]));

  const waveCtx = {
    projectRoot,
    runDir: ref.runDir,
    deps,
    getBuild: () => build,
    setBuild: (next: BuildState) => {
      build = next;
    },
    getProofs: () => proofs,
    setProofs: (next: ProofRecord[]) => {
      proofs = next;
    },
    getCurrentRef: () => currentRef,
    setCurrentRef: (next: RunRef) => {
      currentRef = next;
    },
  };

  if (parallel <= 1) {
    while (true) {
      const pending = nextPendingIssue(build, ordered);
      if (!pending) {
        break;
      }
      await executeWave([pending], waveCtx);
      if (build.review_status === 'pending') {
        break;
      }
    }
  } else {
    const completed = new Set(
      build.issues.filter((i) => i.status === 'completed').map((i) => i.number),
    );
    const waves = computeBuildWaves(nodes, { maxParallel: parallel, completed });
    for (const wave of waves) {
      const waveIssues = wave
        .map((num) => byNumber.get(num))
        .filter((node): node is IssuePlanNode => {
          if (!node) {
            return false;
          }
          const state = build.issues.find((i) => i.number === node.number);
          return (
            state?.status === 'pending' &&
            !build.deferred.includes(node.number) &&
            depsSatisfied(build, node)
          );
        });

      await executeWave(waveIssues, waveCtx);
      if (build.review_status === 'pending') {
        break;
      }
    }
  }

  build = evaluateBuildGoalComplete(build);
  const awaitingReview = build.review_status === 'pending';
  const finalStatus = build.goal_complete ? 'complete' : awaitingReview ? 'paused' : 'running';
  const finalPhase = build.goal_complete
    ? 'build_complete'
    : awaitingReview
      ? 'build_review'
      : 'build_executing';

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
