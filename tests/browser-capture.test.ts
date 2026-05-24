import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createMockBrowserCaptureAdapter } from '@foundry/adapters/browser-capture.js';

describe('browser capture adapter (#38)', () => {
  it('mock capture summarizes URL without raw HTML', async () => {
    const adapter = createMockBrowserCaptureAdapter({
      'https://example.com': 'Liquid-glass navigation with large tap targets.',
    });
    const result = await adapter.summarizeUrl('https://example.com');
    assert.strictEqual(result.ok, true);
    assert.match(result.summary, /Liquid-glass/);
    assert.ok(!result.summary.includes('<html'));
    assert.ok(!result.summary.includes('<!DOCTYPE'));
  });

  it('probe reports mock availability', () => {
    const adapter = createMockBrowserCaptureAdapter();
    assert.strictEqual(adapter.probe().ok, true);
  });
});
