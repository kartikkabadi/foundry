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
    process.env.FOUNDRY_PI_MOCK = '1';
    process.env.FOUNDRY_BROWSER_MOCK = '1';
    process.env.FOUNDRY_CUADRIVER_MOCK = '1';
    process.env.FOUNDRY_BUILD_MOCK = '1';
  });

  afterEach(() => {
    delete process.env.FOUNDRY_HOME;
    delete process.env.FOUNDRY_PI_MOCK;
    delete process.env.FOUNDRY_BROWSER_MOCK;
    delete process.env.FOUNDRY_CUADRIVER_MOCK;
    delete process.env.FOUNDRY_BUILD_MOCK;
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

  it('defaultPost rejects network errors and non-2xx webhook responses', async () => {
    saveNotificationsConfig({
      macos: { enabled: false },
      webhook: { enabled: true, url: 'https://example.com/hook', channel: 'http' },
    });
    const globalWithFetch = globalThis as { fetch?: typeof fetch };
    const originalFetch = globalWithFetch.fetch;
    try {
      globalWithFetch.fetch = async () => {
        throw new Error('network down');
      };
      await assert.rejects(
        () =>
          dispatchRunNotification({
            event: 'approval_waiting',
            title: 'Foundry',
            body: 'waiting',
          }),
        /network down/,
      );

      globalWithFetch.fetch = async () =>
        ({
          ok: false,
          status: 503,
          text: async () => 'unavailable',
        }) as Response;
      await assert.rejects(
        () =>
          dispatchRunNotification({
            event: 'approval_waiting',
            title: 'Foundry',
            body: 'waiting',
          }),
        /webhook POST failed \(503\)/,
      );
    } finally {
      globalWithFetch.fetch = originalFetch;
    }
  });

  it('dispatch posts to webhook when enabled', async () => {
    saveNotificationsConfig({
      macos: { enabled: false },
      webhook: { enabled: true, url: 'https://example.com/hook', channel: 'http' },
    });
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    await dispatchRunNotification(
      { event: 'approval_waiting', title: 'Foundry', body: 'waiting' },
      {
        post: async (url, body) => {
          posts.push({ url, body });
        },
      },
    );
    assert.strictEqual(posts.length, 1);
    assert.strictEqual(posts[0]?.url, 'https://example.com/hook');
    assert.strictEqual(posts[0]?.body.event, 'approval_waiting');
    assert.strictEqual(posts[0]?.body.title, 'Foundry');
  });
});
