import { spawn } from 'node:child_process';
import type { NotifyPayload, NotifyPort } from './port.js';

export interface MacosNotifier {
  notify(title: string, body: string): void;
}

/** Escape text for AppleScript double-quoted literals (osascript -e, no shell). */
export function escapeAppleScriptString(value: string): string {
  const flattened = value.replace(/\r/g, '').replace(/\n/g, ' ');
  const escaped = flattened.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function buildMacosNotificationScript(title: string, body: string): string {
  return `display notification ${escapeAppleScriptString(body)} with title ${escapeAppleScriptString(title)}`;
}

export function spawnMacosNotification(title: string, body: string): void {
  if (process.platform !== 'darwin') {
    return;
  }
  const child = spawn('osascript', ['-e', buildMacosNotificationScript(title, body)], {
    stdio: 'ignore',
    detached: true,
  });
  child.on('error', () => undefined);
  child.unref();
}

export function createMacosNotifyPort(notifier: MacosNotifier): NotifyPort {
  return {
    async send(payload: NotifyPayload) {
      notifier.notify(payload.title, payload.body);
    },
  };
}

export function createDefaultMacosNotifier(): MacosNotifier {
  return {
    notify(title: string, body: string) {
      spawnMacosNotification(title, body);
    },
  };
}

export function createMockMacosNotifier(): MacosNotifier & { calls: Array<{ title: string; body: string }> } {
  const calls: Array<{ title: string; body: string }> = [];
  return {
    calls,
    notify(title: string, body: string) {
      calls.push({ title, body });
    },
  };
}
