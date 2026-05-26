import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMonorepoRoot } from '@foundry/core/paths.js';
import { fetchNpmRegistryVersion } from './update-registry.js';

export function runUpdate(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const pkgPath = join(getMonorepoRoot(import.meta.url), 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string; name: string };

  if (dryRun) {
    void (async () => {
      const registry = await fetchNpmRegistryVersion(pkg.name);
      console.log(
        JSON.stringify({
          package: pkg.name,
          currentVersion: pkg.version,
          registryLatest: registry.latest,
          registryError: registry.error,
          updateCommand: 'npm update -g foundry',
        }),
      );
      process.exit(0);
    })();
    return;
  }

  console.error('Run `npm update -g foundry` when installed from npm registry.');
  process.exit(1);
}
