import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initProject } from '../state/run-writer.js';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

export function runInit(_args: string[]): void {
  const result = initProject(process.cwd());

  console.log(`Foundry v${pkg.version} — project initialized`);
  console.log(`  config: ${result.configPath}`);
  console.log(`  runs:   ${result.runsDir}`);
  if (result.createdConfig) {
    console.log('  (created new config.toml)');
  } else {
    console.log('  (config.toml already exists — left unchanged)');
  }
  process.exit(0);
}
