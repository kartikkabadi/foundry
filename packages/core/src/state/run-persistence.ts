import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import {
  formatRunJsonValidationError,
  parseRunJson,
  RunJsonValidationError,
} from '../schema/run-json.js';
import {
  agentPassBudgetFromProfile,
  DEFAULT_BUDGET,
  resolveBudgetProfile,
} from '../config/budget-profiles.js';
import type { RunJson, RunStatus } from '../types/run.js';
import { RUN_JSON_SCHEMA_VERSION } from '../types/run.js';
import {
  RunStateError,
  assertProjectInitialized,
  getRunsDir,
} from './project-init.js';
import { latestEventSummary } from '../comms/events.js';

export interface CreateRunResult {
  runId: string;
  runDir: string;
  runJsonPath: string;
  statusMdPath: string;
  run: RunJson;
}

export interface RunRef {
  runId: string;
  runDir: string;
  runJsonPath: string;
  statusMdPath: string;
  run: RunJson;
}

/** Seam for loading and persisting run.json + status.md on disk. */
export interface RunPersistence {
  readRunJson(runJsonPath: string): RunJson;
  writeRunState(runRef: Pick<RunRef, 'runJsonPath' | 'statusMdPath' | 'run'>): RunJson;
}

function malformedRunError(runJsonPath: string, cause: RunJsonValidationError): RunStateError {
  return new RunStateError(
    'MALFORMED',
    `Invalid run.json schema: ${runJsonPath} — ${formatRunJsonValidationError(cause)}`,
  );
}

export function parseStoredRunJson(runJsonPath: string, parsed: unknown): RunJson {
  try {
    return parseRunJson(parsed);
  } catch (error) {
    if (error instanceof RunJsonValidationError) {
      throw malformedRunError(runJsonPath, error);
    }
    throw error;
  }
}

export function readRunJson(runJsonPath: string): RunJson {
  if (!existsSync(runJsonPath)) {
    throw new RunStateError('NOT_FOUND', `Run state not found: ${runJsonPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(runJsonPath, 'utf8'));
  } catch {
    throw new RunStateError('MALFORMED', `Malformed run.json: ${runJsonPath}`);
  }

  return parseStoredRunJson(runJsonPath, parsed);
}

export function statusMarkdown(run: RunJson, runDir?: string): string {
  const lines = [
    '# Run status',
    '',
    `- **Run ID:** ${run.run_id}`,
    `- **Mode:** ${run.mode}`,
    `- **Budget:** ${run.budget}`,
    `- **Status:** ${run.status}`,
    `- **Phase:** ${run.phase}`,
    `- **Composer speed:** ${run.composer_speed}`,
    `- **Updated:** ${run.updated_at}`,
  ];

  if (runDir) {
    const eventSummary = latestEventSummary(runDir);
    if (eventSummary) {
      lines.push(`- **Latest event:** ${eventSummary}`);
    }
  }

  if (run.next_actions.length > 0) {
    lines.push('', '## Next actions', '');
    for (const action of run.next_actions) {
      lines.push(`- ${action}`);
    }
  }

  if (run.blocked_actions.length > 0) {
    lines.push('', '## Blocked actions', '');
    for (const action of run.blocked_actions) {
      lines.push(`- ${action}`);
    }
  }

  if (run.build) {
    lines.push('', '## Build', '');
    lines.push(`- **Goal complete:** ${run.build.goal_complete ? 'yes' : 'no'}`);
    if (run.build.deferred.length > 0) {
      lines.push(`- **Deferred:** ${run.build.deferred.map((n) => `#${n}`).join(', ')}`);
    }
    if (run.build.review_status === 'pending') {
      lines.push('- **Review:** awaiting_review');
    }
    if (run.build.current_issue) {
      lines.push(`- **Current issue:** #${run.build.current_issue}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function writeRunState(runRef: Pick<RunRef, 'runJsonPath' | 'statusMdPath' | 'run'>): RunJson {
  const run: RunJson = { ...runRef.run, updated_at: new Date().toISOString() };
  const runDir = dirname(runRef.runJsonPath);
  writeFileSync(runRef.runJsonPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  writeFileSync(runRef.statusMdPath, statusMarkdown(run, runDir), 'utf8');
  return run;
}

export const fileRunPersistence: RunPersistence = {
  readRunJson,
  writeRunState,
};

function defaultRunJson(
  runId: string,
  foundryVersion: string,
  overrides: Partial<RunJson> = {},
): RunJson {
  const defaultProfile = resolveBudgetProfile(DEFAULT_BUDGET);
  const now = new Date().toISOString();
  return {
    schema_version: RUN_JSON_SCHEMA_VERSION,
    run_id: runId,
    foundry_version: foundryVersion,
    mode: 'plan',
    budget: DEFAULT_BUDGET,
    status: 'running',
    phase: 'init',
    composer_speed: 'standard',
    created_at: now,
    updated_at: now,
    agent_pass_budget: agentPassBudgetFromProfile(defaultProfile),
    artifacts: [],
    blocked_actions: [],
    next_actions: [],
    ...overrides,
  };
}

export function runRefFromDir(runDir: string, runId: string): RunRef {
  const runJsonPath = join(runDir, 'run.json');
  const statusMdPath = join(runDir, 'status.md');
  const run = fileRunPersistence.readRunJson(runJsonPath);
  return { runId, runDir, runJsonPath, statusMdPath, run };
}

export function createRun(
  projectRoot: string,
  foundryVersion: string,
  overrides: Partial<RunJson> = {},
): CreateRunResult {
  assertProjectInitialized(projectRoot);

  const runId = overrides.run_id ?? randomUUID();
  const runDir = join(getRunsDir(projectRoot), runId);
  mkdirSync(runDir, { recursive: true });

  const run = defaultRunJson(runId, foundryVersion, overrides);
  const runJsonPath = join(runDir, 'run.json');
  const statusMdPath = join(runDir, 'status.md');

  const written = fileRunPersistence.writeRunState({ runJsonPath, statusMdPath, run });

  return { runId, runDir, runJsonPath, statusMdPath, run: written };
}

export function updateRunStatus(
  projectRoot: string,
  runId: string,
  status: RunStatus,
  patch: Partial<
    Pick<RunJson, 'next_actions' | 'blocked_actions' | 'phase' | 'artifacts' | 'agent_pass_budget'>
  > = {},
): RunRef {
  const runDir = join(getRunsDir(projectRoot), runId);
  if (!existsSync(runDir)) {
    throw new RunStateError('NOT_FOUND', `Run not found: ${runId}`);
  }

  const ref = runRefFromDir(runDir, runId);
  const updated: RunJson = {
    ...ref.run,
    status,
    ...patch,
  };

  const written = fileRunPersistence.writeRunState({ ...ref, run: updated });
  return { ...ref, run: written };
}
