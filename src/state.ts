import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function ensureFoundryStateDir(): string {
  const dir = process.env.FOUNDRY_HOME || join(homedir(), '.foundry');
  mkdirSync(dir, { recursive: true });
  return dir;
}
