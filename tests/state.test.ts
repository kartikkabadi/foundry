import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { ensureFoundryStateDir } from '../src/state.ts';

const TEST_ROOT = path.join(os.tmpdir(), 'FOUNDRY_TEST_' + process.pid + '_' + Date.now());

describe('ensureFoundryStateDir (Foundry Issue 1 bootstrap AC)', () => {
  beforeEach(() => {
    process.env.FOUNDRY_HOME = path.join(TEST_ROOT, 'foundry-home');
    fs.rmSync(process.env.FOUNDRY_HOME, { recursive: true, force: true });
  });

  afterEach(() => {
    if (process.env.FOUNDRY_HOME) {
      fs.rmSync(process.env.FOUNDRY_HOME, { recursive: true, force: true });
    }
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    delete process.env.FOUNDRY_HOME;
  });

  it('resolves and creates the state directory (respects FOUNDRY_HOME override, no real $HOME write)', () => {
    const dir = ensureFoundryStateDir();
    assert.ok(dir.includes('foundry-home'), 'should use override');
    assert.ok(fs.existsSync(dir), 'directory must be created');
    assert.ok(fs.statSync(dir).isDirectory(), 'must be a directory');
  });

  it('is safe and idempotent (can be called multiple times)', () => {
    const dir1 = ensureFoundryStateDir();
    const dir2 = ensureFoundryStateDir();
    assert.strictEqual(dir1, dir2);
    assert.ok(fs.existsSync(dir1));
  });
});
