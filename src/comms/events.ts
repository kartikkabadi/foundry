import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEventRecord } from '../schema/events.js';
import type { FoundryEventInput, FoundryEventRecord } from '../types/events.js';
import { EVENTS_SCHEMA_VERSION } from '../types/events.js';

const TRANSCRIPT_PATH_PATTERN = /transcript/i;

export function getCommsPaths(runDir: string): {
  commsDir: string;
  eventsPath: string;
  threadsDir: string;
} {
  const commsDir = join(runDir, 'comms');
  return {
    commsDir,
    eventsPath: join(commsDir, 'events.jsonl'),
    threadsDir: join(commsDir, 'threads'),
  };
}

export function assertArtifactPathAllowed(relativePath: string): void {
  if (TRANSCRIPT_PATH_PATTERN.test(relativePath)) {
    throw new Error(
      `Raw transcript paths are not allowed in git-tracked artifacts: ${relativePath}`,
    );
  }
}

function ensureCommsLayout(runDir: string): ReturnType<typeof getCommsPaths> {
  const paths = getCommsPaths(runDir);
  mkdirSync(paths.threadsDir, { recursive: true });
  return paths;
}

export function appendEvent(runDir: string, input: FoundryEventInput): FoundryEventRecord {
  const { eventsPath } = ensureCommsLayout(runDir);
  const record: FoundryEventRecord = {
    schema_version: EVENTS_SCHEMA_VERSION,
    ts: new Date().toISOString(),
    ...input,
  };
  parseEventRecord(record);
  appendFileSync(eventsPath, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export function readEvents(runDir: string): FoundryEventRecord[] {
  const { eventsPath } = getCommsPaths(runDir);
  if (!existsSync(eventsPath)) {
    return [];
  }

  return readFileSync(eventsPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseEventRecord(JSON.parse(line)));
}

export function latestEventSummary(runDir: string): string | undefined {
  const events = readEvents(runDir);
  const latest = events.at(-1);
  return latest ? `${latest.type}: ${latest.summary}` : undefined;
}

export function writeThreadSummary(
  runDir: string,
  threadName: string,
  markdown: string,
): string {
  assertArtifactPathAllowed(`comms/threads/${threadName}`);
  const { threadsDir } = ensureCommsLayout(runDir);
  const threadPath = join(threadsDir, threadName);
  writeFileSync(threadPath, `${markdown.trim()}\n`, 'utf8');
  return threadPath;
}

export function appendThreadHandoff(
  runDir: string,
  threadName: string,
  heading: string,
  body: string,
): void {
  assertArtifactPathAllowed(`comms/threads/${threadName}`);
  const { threadsDir } = ensureCommsLayout(runDir);
  const threadPath = join(threadsDir, threadName);
  const block = `\n\n## ${heading}\n\n${body.trim()}\n`;
  if (existsSync(threadPath)) {
    appendFileSync(threadPath, block, 'utf8');
  } else {
    writeFileSync(threadPath, `# Plan comms thread\n${block}`, 'utf8');
  }
}
