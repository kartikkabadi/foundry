import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  buildMacosNotificationScript,
  escapeAppleScriptString,
} from '@foundry/adapters/notify/macos.js';

describe('macos notify escaping', () => {
  beforeEach(() => {
    process.env.FOUNDRY_PI_MOCK = '1';
    process.env.FOUNDRY_BROWSER_MOCK = '1';
    process.env.FOUNDRY_CUADRIVER_MOCK = '1';
    process.env.FOUNDRY_BUILD_MOCK = '1';
  });

  afterEach(() => {
    delete process.env.FOUNDRY_PI_MOCK;
    delete process.env.FOUNDRY_BROWSER_MOCK;
    delete process.env.FOUNDRY_CUADRIVER_MOCK;
    delete process.env.FOUNDRY_BUILD_MOCK;
  });

  it('escapeAppleScriptString wraps quotes and backslashes', () => {
    assert.strictEqual(escapeAppleScriptString('a"b\\c'), '"a\\"b\\\\c"');
  });

  it('buildMacosNotificationScript keeps metacharacters inside quoted literals', () => {
    const script = buildMacosNotificationScript(
      '"; do shell script "rm"',
      'line1\nline2',
    );
    assert.strictEqual(
      script,
      'display notification "line1 line2" with title "\\"; do shell script \\"rm\\""',
    );
  });
});
