import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RunJson } from '../types/run.js';
import { RunStateError, assertProjectInitialized, getRunsDir } from './project-init.js';
import { parseStoredRunJson, type RunRef } from './run-persistence.js';

export interface RunScanResult {
  runId: string;
  runDir: string;
  runJsonPath: string;
  runJsonMtimeMs: number;
  valid?: RunRef;
  malformed?: RunStateError;
  rawStatus?: string;
}

/** Seam for listing and finding runs under a project root. */
export interface RunQuery {
  scanRunResults(projectRoot: string): RunScanResult[];
  listRunRefs(projectRoot: string): RunRef[];
  findLatestRun(projectRoot: string): RunRef | null;
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
      const run = parseStoredRunJson(runJsonPath, parsed);
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

function sortRefsByUpdatedAt(refs: RunRef[]): RunRef[] {
  return refs.sort(
    (a, b) => new Date(b.run.updated_at).getTime() - new Date(a.run.updated_at).getTime(),
  );
}

export function listRunRefs(projectRoot: string): RunRef[] {
  const refs = scanRunResults(projectRoot)
    .filter((result) => result.valid)
    .map((result) => result.valid!);

  return sortRefsByUpdatedAt(refs);
}

export function findLatestRun(projectRoot: string): RunRef | null {
  const results = scanRunResults(projectRoot);
  const refs = sortRefsByUpdatedAt(
    results.filter((result) => result.valid).map((result) => result.valid!),
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

  const refs = sortRefsByUpdatedAt(
    results
      .filter((result) => result.valid && result.valid.run.status === 'paused')
      .map((result) => result.valid!),
  );

  if (runId) {
    return refs.find((ref) => ref.runId === runId) ?? null;
  }

  return refs[0] ?? null;
}

export function findLatestAwaitingApprovalRun(projectRoot: string, runId?: string): RunRef | null {
  const refs = listRunRefs(projectRoot).filter(
    (ref) => ref.run.status === 'awaiting_approval',
  );

  if (runId) {
    return refs.find((ref) => ref.runId === runId) ?? null;
  }

  return refs[0] ?? null;
}

export const fileRunQuery: RunQuery = {
  scanRunResults,
  listRunRefs,
  findLatestRun,
};
