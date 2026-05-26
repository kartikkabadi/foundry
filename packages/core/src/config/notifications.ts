import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import TOML from 'smol-toml';

function getFoundryHome(): string {
  return process.env.FOUNDRY_HOME?.trim() || join(homedir(), '.foundry');
}

export interface NotificationsConfig {
  macos: { enabled: boolean };
  webhook: { enabled: boolean; url: string; channel: 'slack' | 'telegram' | 'http' };
}

const DEFAULT_CONFIG: NotificationsConfig = {
  macos: { enabled: false },
  webhook: { enabled: false, url: '', channel: 'http' },
};

export function notificationsConfigPath(): string {
  return join(getFoundryHome(), 'notifications.toml');
}

export function loadNotificationsConfig(): NotificationsConfig {
  const path = notificationsConfigPath();
  if (!existsSync(path)) {
    return structuredClone(DEFAULT_CONFIG);
  }

  try {
    const parsed = TOML.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const macos = (parsed.macos as Record<string, unknown> | undefined) ?? {};
    const webhook = (parsed.webhook as Record<string, unknown> | undefined) ?? {};
    const channel = webhook.channel;
    return {
      macos: { enabled: macos.enabled === true },
      webhook: {
        enabled: webhook.enabled === true && typeof webhook.url === 'string' && webhook.url.length > 0,
        url: typeof webhook.url === 'string' ? webhook.url : '',
        channel:
          channel === 'slack' || channel === 'telegram' || channel === 'http' ? channel : 'http',
      },
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveNotificationsConfig(config: NotificationsConfig): void {
  const path = notificationsConfigPath();
  mkdirSync(getFoundryHome(), { recursive: true });
  const body = TOML.stringify({
    macos: { enabled: config.macos.enabled },
    webhook: {
      enabled: config.webhook.enabled,
      url: config.webhook.url,
      channel: config.webhook.channel,
    },
  });
  writeFileSync(path, body, 'utf8');
}
