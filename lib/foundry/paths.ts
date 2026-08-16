import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function dataDir(): string {
  const dir = process.env.FOUNDRY_DATA ?? join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return join(dataDir(), "foundry.sqlite");
}

export function logPath(issueId: string): string {
  return join(dataDir(), "logs", `${issueId}.jsonl`);
}
