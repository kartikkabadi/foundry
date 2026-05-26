import { loadNotificationsConfig } from '@foundry/core/config/notifications.js';
import { createDefaultMacosNotifier, createMacosNotifyPort } from './macos.js';
import { createWebhookNotifyPort } from './webhook.js';
import type { NotifyPayload } from './port.js';

const defaultPost = async (url: string, body: Record<string, unknown>) => {
  const f = (globalThis as any).fetch;
  if (typeof f !== 'function') {
    throw new Error('fetch is not available for webhook delivery');
  }
  const res = await f(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const snippet = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
    const detail = snippet ? `: ${snippet.slice(0, 200)}` : '';
    throw new Error(`webhook POST failed (${res.status})${detail}`);
  }
};

export async function dispatchRunNotification(
  payload: NotifyPayload,
  options: {
    macosNotifier?: { notify(title: string, body: string): void };
    post?: (url: string, body: Record<string, unknown>) => Promise<void>;
  } = {},
): Promise<void> {
  const config = loadNotificationsConfig();

  const macosNotifier =
    options.macosNotifier ?? (config.macos.enabled ? createDefaultMacosNotifier() : undefined);
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
