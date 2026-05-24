import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMonorepoRoot } from '@foundry/core/paths.js';

export function runUpdate(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const pkgPath = join(getMonorepoRoot(import.meta.url), 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string; name: string };

  if (dryRun) {
    console.log(
      JSON.stringify({
        package: pkg.name,
        currentVersion: pkg.version,
        registryCheck: 'npm view foundry version',
        note: 'Self-update delegates to npm when published',
      }),
    );
    process.exit(0);
  }

  console.error('Run `npm update -g foundry` when installed from npm registry.');
  process.exit(1);
}
