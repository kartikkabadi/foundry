import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fetchNpmRegistryVersion } from '../packages/cli/src/commands/update-registry.js';

describe('npm distribution (#48)', () => {
  it('root package.json includes bin entry for foundry', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8'),
    ) as { bin?: Record<string, string> };
    assert.ok(pkg.bin?.foundry);
    assert.ok(pkg.bin.foundry.includes('packages/cli/bin/foundry.js'));
  });

  it('npm pack includes CLI bin', () => {
    const out = execSync('npm pack --dry-run 2>&1', {
      cwd: path.join(import.meta.dirname, '..'),
      encoding: 'utf8',
    });
    assert.match(out, /foundry/);
    assert.match(out, /packages\/cli\/bin\/foundry\.js/);
  });

  it('fetchNpmRegistryVersion handles mock fetch', async () => {
    const result = await fetchNpmRegistryVersion('foundry', async () =>
      new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 }),
    );
    assert.strictEqual(result.latest, '9.9.9');
  });

  it('install.sh mentions npm install path when FOUNDRY_INSTALL_VIA_NPM=1', () => {
    const script = readFileSync(path.join(import.meta.dirname, '../scripts/install.sh'), 'utf8');
    assert.match(script, /npm install -g foundry/);
  });
});
