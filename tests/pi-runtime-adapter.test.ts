import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createExecPiRuntimeAdapter,
  createMockPiRuntimeAdapter,
} from '@foundry/adapters/pi-runtime.js';

describe('pi runtime adapter (#40)', () => {
  it('mock invoke returns success', async () => {
    const adapter = createMockPiRuntimeAdapter('9.9.9');
    const probe = adapter.probe();
    assert.strictEqual(probe.ok, true);
    const smoke = await adapter.invokeSmoke(process.cwd());
    assert.strictEqual(smoke.ok, true);
  });

  it('exec adapter surfaces failure when pi missing', () => {
    const adapter = createExecPiRuntimeAdapter(() => ({
      ok: false,
      stdout: '',
      stderr: 'not found',
    }));
    const probe = adapter.probe();
    assert.strictEqual(probe.ok, false);
  });

  it('exec adapter passes when pi run --version succeeds', async () => {
    const adapter = createExecPiRuntimeAdapter((cmd, args) => {
      if (cmd === 'pi' && args[0] === 'run') {
        return { ok: true, stdout: 'pi 1.0.0', stderr: '' };
      }
      return { ok: false, stdout: '', stderr: '' };
    });
    assert.strictEqual(adapter.probe().ok, true);
    assert.strictEqual((await adapter.invokeSmoke('/tmp')).ok, true);
  });
});
