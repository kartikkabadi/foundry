import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_CONFIG = `# Foundry project config (v1)
version = 1

[autonomy]
default = "productive"
`;

export type RunStateErrorCode =
  | 'NOT_INITIALIZED'
  | 'NO_RUNS'
  | 'NO_ACTIVE_RUN'
  | 'NO_PAUSED_RUN'
  | 'MALFORMED'
  | 'NOT_FOUND';

export class RunStateError extends Error {
  readonly code: RunStateErrorCode;

  constructor(code: RunStateErrorCode, message: string) {
    super(message);
    this.name = 'RunStateError';
    this.code = code;
  }
}

export interface InitProjectResult {
  configPath: string;
  runsDir: string;
  createdConfig: boolean;
}

export function getProjectFoundryDir(projectRoot: string): string {
  return join(projectRoot, '.foundry');
}

export function getRunsDir(projectRoot: string): string {
  return join(getProjectFoundryDir(projectRoot), 'runs');
}

export function assertProjectInitialized(projectRoot: string): void {
  const configPath = join(getProjectFoundryDir(projectRoot), 'config.toml');
  if (!existsSync(configPath)) {
    throw new RunStateError(
      'NOT_INITIALIZED',
      'Foundry is not initialized in this repo. Run `foundry init` first.',
    );
  }
}

export function initProject(projectRoot: string): InitProjectResult {
  const foundryDir = getProjectFoundryDir(projectRoot);
  const runsDir = getRunsDir(projectRoot);
  const configPath = join(foundryDir, 'config.toml');

  mkdirSync(runsDir, { recursive: true });

  let createdConfig = false;
  if (!existsSync(configPath)) {
    writeFileSync(configPath, DEFAULT_CONFIG, 'utf8');
    createdConfig = true;
  }

  return { configPath, runsDir, createdConfig };
}
