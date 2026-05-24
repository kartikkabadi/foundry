import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '@foundry/core/state/run-writer.js';
import type { DoctorDeps } from './deps.js';

export interface DoctorFixResult {
  fixed: string[];
  skipped: string[];
}

/**
 * Repairs Foundry-owned local state only.
 * Does not install packages, edit Pi/Cursor config, or change permissions.
 */
export function applyDoctorFix(deps: DoctorDeps): DoctorFixResult {
  const fixed: string[] = [];
  const skipped: string[] = [];

  const foundryHome = deps.env.FOUNDRY_HOME?.trim() || join(homedir(), '.foundry');
  if (!deps.fileExists(foundryHome)) {
    mkdirSync(foundryHome, { recursive: true });
    fixed.push(`Created machine state directory: ${foundryHome}`);
  }

  const configPath = join(deps.cwd, '.foundry', 'config.toml');
  if (!deps.fileExists(configPath)) {
    initProject(deps.cwd);
    fixed.push('Created .foundry/config.toml and runs/ (foundry init)');
  } else {
    const runsDir = join(deps.cwd, '.foundry', 'runs');
    if (!deps.fileExists(runsDir)) {
      mkdirSync(runsDir, { recursive: true });
      fixed.push('Created .foundry/runs/ directory');
    }
  }

  skipped.push(
    'pi-cli, cursor-sdk, composer-2.5-standard — configure manually (see docs/TROUBLESHOOTING.md)',
  );
  skipped.push('node-package-manager, git-github — install/configure outside Foundry');

  return { fixed, skipped };
}
