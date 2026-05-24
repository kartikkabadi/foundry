/** Cursor SDK boundary (Issue #5). */

import { resolveCursorApiKey } from '../config/cursor-auth.js';
import { safeErrorMessage, scrubSecrets } from '../config/secrets.js';

export interface ComposerSmokeResult {
  ok: boolean;
  message: string;
}

export interface CursorAdapter {
  smokeComposerStandard(options: { timeoutMs: number }): Promise<ComposerSmokeResult>;
}

export class CursorAdapterNotImplementedError extends Error {
  constructor(message = 'Cursor adapter not implemented (Issue #5)') {
    super(message);
    this.name = 'CursorAdapterNotImplementedError';
  }
}

const SMOKE_PROMPT =
  'Reply with exactly one line: FOUNDRY_COMPOSER_OK. No other text.';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

async function loadAgent() {
  const { Agent } = await import('@cursor/sdk');
  return Agent;
}

export async function checkComposerStandard(options: {
  timeoutMs: number;
  cwd?: string;
  apiKey?: string;
}): Promise<ComposerSmokeResult> {
  const apiKey = options.apiKey ?? resolveCursorApiKey().apiKey;
  if (!apiKey) {
    return {
      ok: false,
      message: 'Cursor API key not configured (set CURSOR_API_KEY or Pi cursor auth)',
    };
  }

  try {
    const Agent = await loadAgent();
    const result = await withTimeout(
      Agent.prompt(SMOKE_PROMPT, {
        apiKey,
        model: { id: 'composer-2.5' },
        local: { cwd: options.cwd ?? process.cwd() },
      }),
      options.timeoutMs,
      'Composer smoke',
    );

    const text = scrubSecrets(result.result ?? '');
    const passed = result.status === 'finished' && text.includes('FOUNDRY_COMPOSER_OK');

    if (passed) {
      return {
        ok: true,
        message: 'Composer 2.5 Standard smoke passed',
      };
    }

    return {
      ok: false,
      message: `Composer smoke finished with status: ${result.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      message: safeErrorMessage(err),
    };
  }
}

export function createCursorAdapter(apiKey?: string): CursorAdapter {
  const resolved = apiKey ?? resolveCursorApiKey().apiKey;
  return {
    smokeComposerStandard(options) {
      return checkComposerStandard({ ...options, apiKey: resolved });
    },
  };
}

export async function promptComposer(
  prompt: string,
  cwd: string,
  apiKey?: string,
): Promise<string> {
  const resolved = apiKey ?? resolveCursorApiKey().apiKey;
  if (!resolved) {
    throw new Error('Cursor API key not configured (set CURSOR_API_KEY or Pi cursor auth)');
  }

  const Agent = await loadAgent();
  const result = await Agent.prompt(prompt, {
    apiKey: resolved,
    model: { id: 'composer-2.5' },
    local: { cwd },
  });

  if (result.status !== 'finished') {
    throw new Error(`Agent prompt failed with status: ${result.status}`);
  }

  return scrubSecrets(result.result ?? '');
}
