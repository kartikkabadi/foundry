import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createMacosNotifyPort,
  createMockMacosNotifier,
} from '@foundry/adapters/notify/macos.js';

describe('macOS notifications (#43)', () => {
  it('mock notifier called on approval_waiting event', async () => {
    const mock = createMockMacosNotifier();
    const port = createMacosNotifyPort(mock);
    await port.send({
      event: 'approval_waiting',
      title: 'Foundry',
      body: 'Plan awaiting approval',
    });
    assert.strictEqual(mock.calls.length, 1);
    assert.match(mock.calls[0]?.body ?? '', /approval/i);
  });

  it('mock notifier called on rate_limit_pause event', async () => {
    const mock = createMockMacosNotifier();
    const port = createMacosNotifyPort(mock);
    await port.send({
      event: 'rate_limit_pause',
      title: 'Foundry',
      body: 'Composer rate limited',
    });
    assert.strictEqual(mock.calls.length, 1);
  });
});
