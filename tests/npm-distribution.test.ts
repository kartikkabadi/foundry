import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('npm distribution (#48)', () => {
  it('root package.json includes bin entry for foundry', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8'),
    ) as { bin?: Record<string, string> };
    assert.ok(pkg.bin?.foundry);
    assert.ok(pkg.bin.foundry.includes('packages/cli/bin/foundry.js'));
  });

  it('install.sh mentions npm install path when FOUNDRY_INSTALL_VIA_NPM=1', () => {
    const script = readFileSync(path.join(import.meta.dirname, '../scripts/install.sh'), 'utf8');
    assert.match(script, /npm install -g foundry/);
  });
});
