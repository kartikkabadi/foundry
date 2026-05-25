import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTeamSpecFromFile, teamSpecToConfigSection } from '../team/spec.js';

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
  teamLoaded?: boolean;
}

export interface InitProjectOptions {
  teamPackPath?: string;
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

export function initProject(
  projectRoot: string,
  options: InitProjectOptions = {},
): InitProjectResult {
  const foundryDir = getProjectFoundryDir(projectRoot);
  const runsDir = getRunsDir(projectRoot);
  const configPath = join(foundryDir, 'config.toml');

  mkdirSync(runsDir, { recursive: true });

  let createdConfig = false;
  let teamLoaded = false;
  let configBody = existsSync(configPath)
    ? readFileSync(configPath, 'utf8')
    : DEFAULT_CONFIG;

  if (!existsSync(configPath)) {
    createdConfig = true;
  }

  if (options.teamPackPath) {
    const spec = loadTeamSpecFromFile(options.teamPackPath);
    const teamSection = teamSpecToConfigSection(spec);
    if (!configBody.includes('[team]')) {
      configBody = `${configBody.trimEnd()}\n${teamSection}`;
      teamLoaded = true;
    }
  }

  writeFileSync(configPath, configBody, 'utf8');

  return { configPath, runsDir, createdConfig, teamLoaded };
}
