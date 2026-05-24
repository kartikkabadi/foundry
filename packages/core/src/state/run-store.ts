import { RunStateError } from './project-init.js';
import {
  type CreateRunResult,
  type RunPersistence,
  type RunRef,
  createRun,
  fileRunPersistence,
  readRunJson,
  statusMarkdown,
  updateRunStatus,
  writeRunState,
} from './run-persistence.js';
import {
  type RunQuery,
  type RunScanResult,
  fileRunQuery,
  findActiveRun,
  findLatestAwaitingApprovalRun,
  findLatestPausedRun,
  findLatestRun,
  listRunRefs,
} from './run-query.js';

export type { CreateRunResult, RunRef, RunPersistence, RunQuery, RunScanResult };
export {
  createRun,
  fileRunPersistence,
  fileRunQuery,
  findActiveRun,
  findLatestAwaitingApprovalRun,
  findLatestPausedRun,
  findLatestRun,
  listRunRefs,
  readRunJson,
  statusMarkdown,
  updateRunStatus,
  writeRunState,
};

export function approveRun(projectRoot: string, runId?: string): RunRef {
  const target = runId
    ? listRunRefs(projectRoot).find((ref) => ref.runId === runId) ?? null
    : findLatestAwaitingApprovalRun(projectRoot);

  if (!target) {
    if (runId) {
      throw new RunStateError('NOT_FOUND', `No run found with id: ${runId}`);
    }
    throw new RunStateError(
      'NOT_FOUND',
      'No run awaiting approval. Complete `foundry plan` first.',
    );
  }

  if (target.run.status === 'approved') {
    return target;
  }

  if (target.run.status !== 'awaiting_approval') {
    throw new RunStateError(
      'NOT_FOUND',
      `Run ${target.runId} is ${target.run.status}; only awaiting_approval runs can be approved.`,
    );
  }

  return updateRunStatus(projectRoot, target.runId, 'approved', {
    next_actions: ['Run `foundry build` to execute the approved plan'],
    blocked_actions: [],
  });
}

export function pauseRun(
  projectRoot: string,
  nextAction = 'Resume with `foundry resume`',
): RunRef {
  const active = findActiveRun(projectRoot);
  if (!active) {
    const latest = findLatestRun(projectRoot);
    if (!latest) {
      throw new RunStateError('NO_RUNS', 'No runs found in this repo.');
    }
    throw new RunStateError(
      'NO_ACTIVE_RUN',
      `No active run to pause (latest run ${latest.runId} is ${latest.run.status}).`,
    );
  }

  return updateRunStatus(projectRoot, active.runId, 'paused', {
    next_actions: [nextAction],
  });
}

export function resumeRun(projectRoot: string, runId?: string): RunRef {
  const paused = findLatestPausedRun(projectRoot, runId);
  if (!paused) {
    if (runId) {
      throw new RunStateError('NOT_FOUND', `No paused run found with id: ${runId}`);
    }
    throw new RunStateError('NO_PAUSED_RUN', 'No paused run found in this repo.');
  }

  return updateRunStatus(projectRoot, paused.runId, 'running', {
    next_actions: [],
  });
}

export function formatRunSummary(ref: RunRef): string {
  const { run } = ref;
  const lines = [
    `Run ${ref.runId} (${run.mode})`,
    `  Status: ${run.status}`,
    `  Phase: ${run.phase}`,
    `  Budget: ${run.budget}`,
    `  Updated: ${run.updated_at}`,
  ];

  if (run.next_actions.length > 0) {
    lines.push(`  Next: ${run.next_actions[0]}`);
  }

  return lines.join('\n');
}
