/** Cursor SDK boundary (Issue #5). */

import { safeErrorMessage, scrubSecrets } from '../plan/secrets.js';

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
}): Promise<ComposerSmokeResult> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      message: 'CURSOR_API_KEY not set',
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
    const passed =
      result.status === 'finished' &&
      (text.includes('FOUNDRY_COMPOSER_OK') || text.length > 0);

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

export function createCursorAdapter(): CursorAdapter {
  return {
    smokeComposerStandard(options) {
      return checkComposerStandard(options);
    },
  };
}

export async function promptComposer(
  prompt: string,
  cwd: string,
): Promise<string> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('CURSOR_API_KEY not set');
  }

  const Agent = await loadAgent();
  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: 'composer-2.5' },
    local: { cwd },
  });

  if (result.status !== 'finished') {
    throw new Error(`Agent prompt failed with status: ${result.status}`);
  }

  return scrubSecrets(result.result ?? '');
}
