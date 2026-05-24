import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubSecrets, safeErrorMessage } from '@foundry/core/config/secrets.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('config secrets scrubbing', () => {
  it('scrubs CURSOR_API_KEY patterns', () => {
    const input = 'Error: CURSOR_API_KEY=sk-secret123 failed';
    const out = scrubSecrets(input);
    assert.ok(!out.includes('sk-secret123'));
    assert.ok(out.includes('[REDACTED]'));
  });

  it('scrubs sk- token patterns', () => {
    const input = 'token sk-abcdefghijklmnopqrstuvwxyz1234567890 leaked';
    const out = scrubSecrets(input);
    assert.ok(!out.includes('sk-abcdefghijklmnopqrstuvwxyz1234567890'));
    assert.ok(out.includes('[REDACTED]'));
  });

  it('scrubs key_ token patterns', () => {
    const input = 'bad key_abcdefghijklmnopqrstuvwxyz1234567890 here';
    const out = scrubSecrets(input);
    assert.ok(!out.includes('key_abcdefghijklmnopqrstuvwxyz1234567890'));
    assert.ok(out.includes('[REDACTED]'));
  });

  it('safeErrorMessage redacts secrets from Error messages', () => {
    const message = safeErrorMessage(new Error('CURSOR_API_KEY=sk-bad-key-12345678901234567890'));
    assert.ok(!message.includes('sk-bad-key'));
    assert.ok(message.includes('[REDACTED]'));
  });
});

describe('adapter config boundary', () => {
  it('cursor adapter does not import from plan/', () => {
    const cursorAdapterPath = path.join(repoRoot, 'packages/adapters/src/cursor.ts');
    const source = fs.readFileSync(cursorAdapterPath, 'utf8');
    assert.ok(
      !source.includes("from '../plan/") && !source.includes('from "../plan/'),
      'adapters/cursor.ts must not import from plan/',
    );
  });
});
