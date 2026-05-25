import type { NotifyPayload, NotifyPort } from './port.js';

export interface MacosNotifier {
  notify(title: string, body: string): void;
}

export function createMacosNotifyPort(notifier: MacosNotifier): NotifyPort {
  return {
    async send(payload: NotifyPayload) {
      notifier.notify(payload.title, payload.body);
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
