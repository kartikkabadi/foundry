/** Unified Cursor SDK seam for doctor, plan, and build. */

import { resolveCursorApiKey } from '@foundry/core/config/cursor-auth.js';
import { safeErrorMessage, scrubSecrets } from '@foundry/core/config/secrets.js';
import { assertComposerOnlyModel, FoundryRateLimitError, mapAgentPromptError } from './agent-errors.js';
export const COMPOSER_MODEL_STANDARD = 'composer-2.5';
export const COMPOSER_MODEL_FAST = 'composer-2.5-fast';
export const COMPOSER_SMOKE_MARKER = 'FOUNDRY_COMPOSER_OK';

export interface ComposerSmokeResult {
  ok: boolean;
  message: string;
}

const SMOKE_PROMPT = `Reply with exactly one line: ${COMPOSER_SMOKE_MARKER}. No other text.`;

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

export class FoundryAgentClient {
  constructor(private readonly apiKey?: string) {}

  resolveApiKey(): string | undefined {
    return this.apiKey ?? resolveCursorApiKey().apiKey;
  }

  async prompt(
    prompt: string,
    cwd: string,
    modelId: string = COMPOSER_MODEL_STANDARD,
  ): Promise<string> {
    assertComposerOnlyModel(modelId);

    if (process.env.FOUNDRY_AGENT_RATE_LIMIT === '1') {
      throw new FoundryRateLimitError('Simulated Composer rate limit (FOUNDRY_AGENT_RATE_LIMIT=1)');
    }

    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new Error('Cursor API key not configured (set CURSOR_API_KEY or Pi cursor auth)');
    }

    try {
      const Agent = await loadAgent();
      const result = await Agent.prompt(prompt, {
        apiKey,
        model: { id: modelId },
        local: { cwd },
      });

      if (result.status !== 'finished') {
        throw new Error(`Agent prompt failed with status: ${result.status}`);
      }

      return scrubSecrets(result.result ?? '');
    } catch (err) {
      throw mapAgentPromptError(err, modelId);
    }
  }

  async smoke(
    modelId: string,
    options: { timeoutMs: number; cwd?: string },
    label: string,
  ): Promise<ComposerSmokeResult> {
    const apiKey = this.resolveApiKey();
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
          model: { id: modelId },
          local: { cwd: options.cwd ?? process.cwd() },
        }),
        options.timeoutMs,
        label,
      );

      const text = scrubSecrets(result.result ?? '');
      const passed = result.status === 'finished' && text.includes(COMPOSER_SMOKE_MARKER);

      if (passed) {
        return { ok: true, message: `${label} passed` };
      }

      return {
        ok: false,
        message: `${label} finished with status: ${result.status}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: safeErrorMessage(err),
      };
    }
  }

  smokeComposerStandard(options: { timeoutMs: number; cwd?: string }): Promise<ComposerSmokeResult> {
    return this.smoke(COMPOSER_MODEL_STANDARD, options, 'Composer 2.5 Standard smoke');
  }

  smokeComposerFast(options: { timeoutMs: number; cwd?: string }): Promise<ComposerSmokeResult> {
    return this.smoke(COMPOSER_MODEL_FAST, options, 'Composer 2.5 Fast smoke');
  }
}

export function createFoundryAgent(apiKey?: string): FoundryAgentClient {
  return new FoundryAgentClient(apiKey);
}
