import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const TEST_HOME = path.join(os.tmpdir(), 'FOUNDRY_CLI_TEST_' + process.pid + '_' + Date.now());

describe('foundry CLI bootstrap (Issue 1 ACs: --version, --help, state dir)', () => {
  beforeEach(() => {
    process.env.FOUNDRY_HOME = path.join(TEST_HOME, 'home');
    fs.rmSync(process.env.FOUNDRY_HOME, { recursive: true, force: true });
  });

  afterEach(() => {
    if (process.env.FOUNDRY_HOME) {
      fs.rmSync(process.env.FOUNDRY_HOME, { recursive: true, force: true });
    }
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    delete process.env.FOUNDRY_HOME;
  });

  it('--version prints the package version (0.1.0)', () => {
    const out = execSync('npx tsx src/cli.ts --version', {
      encoding: 'utf8',
      env: { ...process.env, FOUNDRY_HOME: process.env.FOUNDRY_HOME }
    }).trim();
    assert.strictEqual(out, '0.1.0');
  });

  it('--help lists the v1 commands', () => {
    const out = execSync('npx tsx src/cli.ts --help', {
      encoding: 'utf8',
      env: { ...process.env, FOUNDRY_HOME: process.env.FOUNDRY_HOME }
    });
    assert.ok(out.includes('doctor'));
    assert.ok(out.includes('setup'));
    assert.ok(out.includes('plan'));
    assert.ok(out.includes('status'));
    assert.ok(out.includes('pause'));
    assert.ok(out.includes('resume'));
    assert.ok(out.includes('build'));
  });
});
