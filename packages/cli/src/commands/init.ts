import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMonorepoRoot } from '@foundry/core/paths.js';
import { initProject } from '@foundry/core/state/run-writer.js';
import { TeamSpecValidationError } from '@foundry/core/team/spec.js';

const pkgPath = join(getMonorepoRoot(import.meta.url), 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

export function parseInitArgs(args: string[]): { teamPackPath?: string } {
  const options: { teamPackPath?: string } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--team') {
      const value = args[++i];
      if (!value) {
        console.error('Usage: foundry init [--team <team-pack.toml>]');
        process.exit(1);
      }
      options.teamPackPath = value;
    }
  }

  return options;
}

export function runInit(args: string[]): void {
  const { teamPackPath } = parseInitArgs(args);

  try {
    const result = initProject(process.cwd(), { teamPackPath });

    console.log(`Foundry v${pkg.version} — project initialized`);
    console.log(`  config: ${result.configPath}`);
    console.log(`  runs:   ${result.runsDir}`);
    if (result.teamLoaded) {
      console.log(`  team:   loaded from ${teamPackPath}`);
    }
    if (result.createdConfig) {
      console.log('  (created new config.toml)');
    } else {
      console.log('  (config.toml already exists — updated if team pack provided)');
    }
    process.exit(0);
  } catch (err) {
    if (err instanceof TeamSpecValidationError) {
      console.error('Team spec validation failed:');
      for (const issue of err.issues) {
        const line = err.line ? ` (line ${err.line})` : '';
        console.error(`  - ${issue}${line}`);
      }
      process.exit(1);
    }
    throw err;
  }
}
