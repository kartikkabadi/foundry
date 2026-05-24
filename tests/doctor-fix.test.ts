import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyDoctorFix } from '../src/doctor/fix.ts';
import type { DoctorDeps } from '../src/doctor/deps.ts';

function mockDeps(cwd: string, env: NodeJS.ProcessEnv = {}): DoctorDeps {
  return {
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: 'v22.0.0',
    cwd,
    env,
    foundryRoot: cwd,
    piAuthPath: path.join(cwd, 'missing-auth.json'),
    exec() {
      return { ok: false, stdout: '', stderr: '' };
    },
    fileExists(p: string) {
      return fs.existsSync(p);
    },
    resolveModule() {
      return false;
    },
    cursorAdapter: {
      async smokeComposerStandard() {
        return { ok: false, message: 'mock' };
      },
    },
  };
}

describe('doctor --fix (Foundry-owned state only)', () => {
  it('creates FOUNDRY_HOME and project .foundry layout', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-fix-'));
    const foundryHome = path.join(tmp, 'machine-state');

    const result = applyDoctorFix(
      mockDeps(path.join(tmp, 'project'), { FOUNDRY_HOME: foundryHome }),
    );

    assert.ok(result.fixed.some((f) => f.includes('FOUNDRY_HOME') || f.includes('machine state')));
    assert.ok(fs.existsSync(foundryHome));
    assert.ok(fs.existsSync(path.join(tmp, 'project', '.foundry', 'config.toml')));
    assert.ok(fs.existsSync(path.join(tmp, 'project', '.foundry', 'runs')));
    assert.ok(result.skipped.length > 0);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('is idempotent when state already exists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-fix-idem-'));
    const project = path.join(tmp, 'project');
    const foundryHome = path.join(tmp, 'home');
    fs.mkdirSync(foundryHome, { recursive: true });
    fs.mkdirSync(path.join(project, '.foundry', 'runs'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foundry', 'config.toml'), 'version = 1\n', 'utf8');

    const result = applyDoctorFix(mockDeps(project, { FOUNDRY_HOME: foundryHome }));
    assert.strictEqual(result.fixed.length, 0);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
