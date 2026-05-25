import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildWebhookBody, dryRunWebhook } from '@foundry/adapters/notify/webhook.js';

describe('webhook notifications (#44)', () => {
  it('dry-run payload matches slack shape', () => {
    const result = dryRunWebhook(
      { url: 'https://hooks.slack.com/test', channel: 'slack' },
      { event: 'approval_waiting', title: 'Foundry', body: 'Waiting' },
    );
    assert.strictEqual(result.valid, true);
    const body = buildWebhookBody(
      { url: 'https://hooks.slack.com/test', channel: 'slack' },
      result.payload,
    );
    assert.ok('text' in body);
    assert.match(String(body.text), /Foundry/);
  });

  it('dry-run validates generic http webhook shape', () => {
    const result = dryRunWebhook(
      { url: 'https://example.com/hook', channel: 'http' },
      {
        event: 'build_complete',
        title: 'Foundry',
        body: 'Build finished',
      },
    );
    const body = buildWebhookBody(
      { url: 'https://example.com/hook', channel: 'http' },
      result.payload,
    );
    assert.strictEqual(body.event, 'build_complete');
    assert.strictEqual(result.valid, true);
  });
});
