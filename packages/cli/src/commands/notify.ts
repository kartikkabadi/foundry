import { dryRunWebhook } from '@foundry/adapters/notify/webhook.js';
import type { NotifyEvent } from '@foundry/adapters/notify/port.js';

export function parseNotifyArgs(args: string[]): {
  dryRun: boolean;
  event: NotifyEvent;
  url?: string;
  channel: 'slack' | 'telegram' | 'http';
} {
  let dryRun = false;
  let event: NotifyEvent = 'approval_waiting';
  let url: string | undefined;
  let channel: 'slack' | 'telegram' | 'http' = 'http';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--event') {
      event = args[++i] as NotifyEvent;
      continue;
    }
    if (arg === '--url') {
      url = args[++i];
      continue;
    }
    if (arg === '--channel') {
      channel = args[++i] as 'slack' | 'telegram' | 'http';
    }
  }

  return { dryRun, event, url, channel };
}

export function runNotify(args: string[]): void {
  const { dryRun, event, url, channel } = parseNotifyArgs(args);

  if (!dryRun) {
    console.error('Usage: foundry notify --dry-run --event approval_waiting [--url URL] [--channel slack|telegram|http]');
    process.exit(1);
  }

  const result = dryRunWebhook(
    { url: url ?? 'https://example.com/hook', channel },
    {
      event,
      title: 'Foundry',
      body: `Event: ${event}`,
    },
  );

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 1);
}
