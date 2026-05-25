import type { NotifyDryRunResult, NotifyPayload, NotifyPort } from './port.js';

export interface WebhookConfig {
  url: string;
  channel: 'slack' | 'telegram' | 'http';
}

export function buildWebhookBody(config: WebhookConfig, payload: NotifyPayload): Record<string, unknown> {
  if (config.channel === 'slack') {
    return { text: `${payload.title}: ${payload.body}` };
  }
  if (config.channel === 'telegram') {
    return { text: `${payload.title}\n${payload.body}` };
  }
  return { event: payload.event, title: payload.title, body: payload.body };
}

export function dryRunWebhook(config: WebhookConfig, payload: NotifyPayload): NotifyDryRunResult {
  const body = buildWebhookBody(config, payload);
  return {
    channel: config.channel,
    payload,
    valid: typeof body === 'object' && Boolean(config.url),
  };
}

export function createWebhookNotifyPort(
  config: WebhookConfig,
  post: (url: string, body: Record<string, unknown>) => Promise<void>,
): NotifyPort {
  return {
    async send(payload: NotifyPayload) {
      await post(config.url, buildWebhookBody(config, payload));
    },
  };
}
