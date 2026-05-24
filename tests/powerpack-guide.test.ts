import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { POWERPACK_GUIDE_URL } from '@foundry/core/constants/powerpack.js';
import { checkPiCli } from '@foundry/doctor/checks/pi-cli.js';

describe('powerpack guide (#49)', () => {
  it('doctor pi-cli repair includes guide link', () => {
    const check = checkPiCli({
      cwd: process.cwd(),
      exec: () => ({ ok: false, stdout: '', stderr: '' }),
    });
    assert.strictEqual(check.status, 'fail');
    assert.ok(check.repair?.includes(POWERPACK_GUIDE_URL));
  });

  it('setup mentions powerpack guide', () => {
    const setup = readFileSync(
      path.join(import.meta.dirname, '../packages/cli/src/commands/setup.ts'),
      'utf8',
    );
    assert.match(setup, /pi-composer-powerpack/);
  });
});
