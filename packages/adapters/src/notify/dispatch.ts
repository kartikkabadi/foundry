import { loadNotificationsConfig } from '@foundry/core/config/notifications.js';
import { createMacosNotifyPort } from './macos.js';
import { createWebhookNotifyPort } from './webhook.js';
import type { NotifyPayload } from './port.js';
import { exec } from 'node:child_process';

const defaultPost = async (url: string, body: Record<string, unknown>) => {
  const f = (globalThis as any).fetch;
  if (typeof f !== 'function') return;
  try {
    await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {}
};

const defaultMacosNotifier = {
  notify(title: string, body: string) {
    if (process.platform !== 'darwin') return;
    const t = title.replace(/["\\]/g, '\\$&');
    const b = body.replace(/["\\]/g, '\\$&');
    exec(`osascript -e 'display notification "${b}" with title "${t}"'`, { stdio: 'ignore' });
  },
};

export async function dispatchRunNotification(
  payload: NotifyPayload,
  options: {
    macosNotifier?: { notify(title: string, body: string): void };
    post?: (url: string, body: Record<string, unknown>) => Promise<void>;
  } = {},
): Promise<void> {
  const config = loadNotificationsConfig();

  const macosNotifier = options.macosNotifier ?? (config.macos.enabled ? defaultMacosNotifier : undefined);
  if (config.macos.enabled && macosNotifier) {
    await createMacosNotifyPort(macosNotifier).send(payload);
  }

  if (config.webhook.enabled) {
    await createWebhookNotifyPort(
      { url: config.webhook.url, channel: config.webhook.channel },
      options.post ?? defaultPost,
    ).send(payload);
  }
}
