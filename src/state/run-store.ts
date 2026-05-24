import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  formatRunJsonValidationError,
  parseRunJson,
  RunJsonValidationError,
} from '../schema/run-json.js';
import type { RunJson, RunStatus } from '../types/run.js';
import { RUN_JSON_SCHEMA_VERSION } from '../types/run.js';
import {
  RunStateError,
  assertProjectInitialized,
  getRunsDir,
} from './project-init.js';

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

function defaultRunJson(
  runId: string,
  foundryVersion: string,
  overrides: Partial<RunJson> = {},
): RunJson {
  const now = new Date().toISOString();
  return {
    schema_version: RUN_JSON_SCHEMA_VERSION,
    run_id: runId,
    foundry_version: foundryVersion,
    mode: 'plan',
    budget: 'deep',
    status: 'running',
    phase: 'init',
    composer_speed: 'standard',
    created_at: now,
    updated_at: now,
    agent_pass_budget: { max_active: 12, used: 0, limit: 80 },
    artifacts: [],
    blocked_actions: [],
    next_actions: [],
    ...overrides,
  };
}

function malformedRunError(runJsonPath: string, cause: RunJsonValidationError): RunStateError {
  return new RunStateError(
    'MALFORMED',
    `Invalid run.json schema: ${runJsonPath} — ${formatRunJsonValidationError(cause)}`,
  );
}

function readParsedRunJson(runJsonPath: string, parsed: unknown): RunJson {
  try {
    return parseRunJson(parsed);
  } catch (error) {
    if (error instanceof RunJsonValidationError) {
      throw malformedRunError(runJsonPath, error);
    }
    throw error;
  }
}

interface RunScanResult {
  runId: string;
  runDir: string;
  runJsonPath: string;
  runJsonMtimeMs: number;
  valid?: RunRef;
  malformed?: RunStateError;
  rawStatus?: string;
}

export function statusMarkdown(run: RunJson): string {
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

  lines.push('');
  return lines.join('\n');
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

  return readParsedRunJson(runJsonPath, parsed);
}

export function writeRunState(runRef: Pick<RunRef, 'runJsonPath' | 'statusMdPath' | 'run'>): RunJson {
  const run: RunJson = { ...runRef.run, updated_at: new Date().toISOString() };
  writeFileSync(runRef.runJsonPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  writeFileSync(runRef.statusMdPath, statusMarkdown(run), 'utf8');
  return run;
}

function runRefFromDir(runDir: string, runId: string): RunRef {
  const runJsonPath = join(runDir, 'run.json');
  const statusMdPath = join(runDir, 'status.md');
  const run = readRunJson(runJsonPath);
  return { runId, runDir, runJsonPath, statusMdPath, run };
}

function scanRunResults(projectRoot: string): RunScanResult[] {
  assertProjectInitialized(projectRoot);
  const runsDir = getRunsDir(projectRoot);

  if (!existsSync(runsDir)) {
    return [];
  }

  const results: RunScanResult[] = [];
  for (const entry of readdirSync(runsDir)) {
    const runDir = join(runsDir, entry);
    if (!statSync(runDir).isDirectory()) {
      continue;
    }

    const runJsonPath = join(runDir, 'run.json');
    if (!existsSync(runJsonPath)) {
      continue;
    }

    const runJsonMtimeMs = statSync(runJsonPath).mtimeMs;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(runJsonPath, 'utf8'));
    } catch {
      results.push({
        runId: entry,
        runDir,
        runJsonPath,
        runJsonMtimeMs,
        malformed: new RunStateError('MALFORMED', `Malformed run.json: ${runJsonPath}`),
      });
      continue;
    }

    const rawStatus =
      parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).status === 'string'
        ? ((parsed as Record<string, unknown>).status as string)
        : undefined;

    try {
      const run = readParsedRunJson(runJsonPath, parsed);
      const statusMdPath = join(runDir, 'status.md');
      results.push({
        runId: entry,
        runDir,
        runJsonPath,
        runJsonMtimeMs,
        rawStatus: run.status,
        valid: { runId: entry, runDir, runJsonPath, statusMdPath, run },
      });
    } catch (error) {
      if (error instanceof RunStateError && error.code === 'MALFORMED') {
        results.push({
          runId: entry,
          runDir,
          runJsonPath,
          runJsonMtimeMs,
          rawStatus,
          malformed: error,
        });
        continue;
      }
      throw error;
    }
  }

  return results;
}

function throwLatestMalformed(results: RunScanResult[]): never {
  const malformed = results
    .filter((result) => result.malformed)
    .sort((a, b) => b.runJsonMtimeMs - a.runJsonMtimeMs);

  throw malformed[0]!.malformed!;
}

export function listRunRefs(projectRoot: string): RunRef[] {
  const refs = scanRunResults(projectRoot)
    .filter((result) => result.valid)
    .map((result) => result.valid!)
    .sort(
      (a, b) => new Date(b.run.updated_at).getTime() - new Date(a.run.updated_at).getTime(),
    );

  return refs;
}

export function findLatestRun(projectRoot: string): RunRef | null {
  const results = scanRunResults(projectRoot);
  const refs = results
    .filter((result) => result.valid)
    .map((result) => result.valid!)
    .sort(
      (a, b) => new Date(b.run.updated_at).getTime() - new Date(a.run.updated_at).getTime(),
    );

  if (refs.length > 0) {
    return refs[0] ?? null;
  }

  if (results.some((result) => result.malformed)) {
    throwLatestMalformed(results);
  }

  return null;
}

export function findActiveRun(projectRoot: string): RunRef | null {
  const refs = listRunRefs(projectRoot);
  return refs.find((ref) => ref.run.status === 'running') ?? null;
}

export function findLatestPausedRun(projectRoot: string, runId?: string): RunRef | null {
  const results = scanRunResults(projectRoot);

  const malformedPaused = results.filter(
    (result) => result.malformed && result.rawStatus === 'paused',
  );
  if (malformedPaused.length > 0) {
    if (runId) {
      const match = malformedPaused.find((result) => result.runId === runId);
      if (match?.malformed) {
        throw match.malformed;
      }
    } else {
      malformedPaused.sort((a, b) => b.runJsonMtimeMs - a.runJsonMtimeMs);
      throw malformedPaused[0]!.malformed!;
    }
  }

  const refs = results
    .filter((result) => result.valid && result.valid.run.status === 'paused')
    .map((result) => result.valid!)
    .sort(
      (a, b) => new Date(b.run.updated_at).getTime() - new Date(a.run.updated_at).getTime(),
    );

  if (runId) {
    return refs.find((ref) => ref.runId === runId) ?? null;
  }

  return refs[0] ?? null;
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

  const written = writeRunState({ runJsonPath, statusMdPath, run });

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

  const written = writeRunState({ ...ref, run: updated });
  return { ...ref, run: written };
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
