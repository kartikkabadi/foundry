import { loadNotificationsConfig } from '@foundry/core/config/notifications.js';
import { createMacosNotifyPort } from './macos.js';
import { createWebhookNotifyPort } from './webhook.js';
import type { NotifyPayload } from './port.js';

const noopPost = async () => {};

export async function dispatchRunNotification(
  payload: NotifyPayload,
  options: {
    macosNotifier?: { notify(title: string, body: string): void };
    post?: (url: string, body: Record<string, unknown>) => Promise<void>;
  } = {},
): Promise<void> {
  const config = loadNotificationsConfig();

  if (config.macos.enabled && options.macosNotifier) {
    await createMacosNotifyPort(options.macosNotifier).send(payload);
  }

  if (config.webhook.enabled) {
    await createWebhookNotifyPort(
      { url: config.webhook.url, channel: config.webhook.channel },
      options.post ?? noopPost,
    ).send(payload);
  }
}
