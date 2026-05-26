import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadNotificationsConfig,
  notificationsConfigPath,
  saveNotificationsConfig,
} from '@foundry/core/config/notifications.js';
import { dispatchRunNotification } from '@foundry/adapters/notify/dispatch.js';
import { createMockMacosNotifier } from '@foundry/adapters/notify/macos.js';

describe('notifications config (#43/#44)', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-notify-'));
    process.env.FOUNDRY_HOME = home;
  });

  afterEach(() => {
    delete process.env.FOUNDRY_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('persists macos and webhook settings', () => {
    saveNotificationsConfig({
      macos: { enabled: true },
      webhook: { enabled: true, url: 'https://example.com/hook', channel: 'slack' },
    });
    const loaded = loadNotificationsConfig();
    assert.strictEqual(loaded.macos.enabled, true);
    assert.strictEqual(loaded.webhook.enabled, true);
    assert.ok(fs.existsSync(notificationsConfigPath()));
  });

  it('dispatch respects macos notifier when enabled', async () => {
    saveNotificationsConfig({ macos: { enabled: true }, webhook: { enabled: false, url: '', channel: 'http' } });
    const mock = createMockMacosNotifier();
    await dispatchRunNotification(
      { event: 'approval_waiting', title: 'Foundry', body: 'waiting' },
      { macosNotifier: mock },
    );
    assert.strictEqual(mock.calls.length, 1);
  });

  it('does not notify when macos disabled', async () => {
    const mock = createMockMacosNotifier();
    await dispatchRunNotification(
      { event: 'approval_waiting', title: 'Foundry', body: 'waiting' },
      { macosNotifier: mock },
    );
    assert.strictEqual(mock.calls.length, 0);
  });
});
