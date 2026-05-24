import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createCuadriverAdapter,
  createMockCuadriverAdapter,
} from '@foundry/adapters/cuadriver.js';

describe('cuadriver adapter (#39)', () => {
  it('missing driver warns not fails by default', () => {
    const prev = process.env.FOUNDRY_CUADRIVER_MISSING;
    process.env.FOUNDRY_CUADRIVER_MISSING = '1';
    try {
      const probe = createMockCuadriverAdapter().probe(false);
      assert.strictEqual(probe.status, 'warn');
      assert.strictEqual(probe.ok, false);
    } finally {
      if (prev === undefined) {
        delete process.env.FOUNDRY_CUADRIVER_MISSING;
      } else {
        process.env.FOUNDRY_CUADRIVER_MISSING = prev;
      }
    }
  });

  it('available driver passes probe', () => {
    const probe = createMockCuadriverAdapter('/opt/cuadriver').probe(false);
    assert.strictEqual(probe.status, 'pass');
    assert.strictEqual(probe.ok, true);
  });

  it('exec adapter uses which cuadriver', () => {
    const adapter = createCuadriverAdapter((cmd, args) => {
      if (cmd === 'which' && args[0] === 'cuadriver') {
        return { ok: true, stdout: '/usr/local/bin/cuadriver' };
      }
      return { ok: false, stdout: '' };
    });
    assert.strictEqual(adapter.probe(false).status, 'pass');
  });
});
