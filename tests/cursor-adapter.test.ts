import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  COMPOSER_MODEL_FAST,
  COMPOSER_MODEL_STANDARD,
  COMPOSER_SMOKE_MARKER,
  checkComposerFast,
  checkComposerStandard,
  createCursorAdapter,
} from '@foundry/adapters/cursor.js';
import { resolveCursorApiKey } from '@foundry/core/config/cursor-auth.js';

describe('cursor adapter (@foundry/adapters/cursor)', () => {
  it('exports Composer 2.5 model ids aligned with DECISIONS', () => {
    assert.strictEqual(COMPOSER_MODEL_STANDARD, 'composer-2.5');
    assert.strictEqual(COMPOSER_MODEL_FAST, 'composer-2.5-fast');
    assert.strictEqual(COMPOSER_SMOKE_MARKER, 'FOUNDRY_COMPOSER_OK');
  });

  it('checkComposerStandard fails closed without api key', async () => {
    const result = await checkComposerStandard({
      timeoutMs: 1_000,
      apiKey: '',
      cwd: process.cwd(),
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.message, /API key not configured/i);
  });

  it('checkComposerFast fails closed without api key', async () => {
    const result = await checkComposerFast({
      timeoutMs: 1_000,
      apiKey: '',
      cwd: process.cwd(),
    });
    assert.strictEqual(result.ok, false);
  });

  it('prefers env api key over Pi auth when resolving keys', () => {
    const tmpAuth = path.join(os.tmpdir(), `foundry-cursor-adapter-${Date.now()}.json`);
    fs.writeFileSync(
      tmpAuth,
      JSON.stringify({ cursor: { type: 'api_key', key: 'pi-key' } }),
      'utf8',
    );

    const resolution = resolveCursorApiKey({
      env: { CURSOR_API_KEY: 'env-wins' },
      piAuthPath: tmpAuth,
    });
    assert.strictEqual(resolution.source, 'env');
    assert.strictEqual(resolution.apiKey, 'env-wins');
    fs.unlinkSync(tmpAuth);
  });

  it('createCursorAdapter returns smoke result shape', async () => {
    const adapter = createCursorAdapter('injected-test-key');
    const result = await adapter.smokeComposerStandard({ timeoutMs: 1_000 });
    assert.strictEqual(typeof result.ok, 'boolean');
    assert.ok(result.message.length > 0);
  });
});
