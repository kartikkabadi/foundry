/** Cursor SDK boundary (Issue #5). */

import {
  COMPOSER_MODEL_FAST,
  COMPOSER_MODEL_STANDARD,
  COMPOSER_SMOKE_MARKER,
  createFoundryAgent,
  FoundryAgentClient,
  type ComposerSmokeResult,
} from './foundry-agent.js';

export {
  COMPOSER_MODEL_FAST,
  COMPOSER_MODEL_STANDARD,
  COMPOSER_SMOKE_MARKER,
  FoundryAgentClient,
  createFoundryAgent,
};

export type { ComposerSmokeResult };

export interface CursorAdapter {
  smokeComposerStandard(options: { timeoutMs: number }): Promise<ComposerSmokeResult>;
  smokeComposerFast(options: { timeoutMs: number }): Promise<ComposerSmokeResult>;
}

export class CursorAdapterNotImplementedError extends Error {
  constructor(message = 'Cursor adapter not implemented (Issue #5)') {
    super(message);
    this.name = 'CursorAdapterNotImplementedError';
  }
}

export async function checkComposerFast(options: {
  timeoutMs: number;
  cwd?: string;
  apiKey?: string;
}): Promise<ComposerSmokeResult> {
  return createFoundryAgent(options.apiKey).smokeComposerFast({
    timeoutMs: options.timeoutMs,
    cwd: options.cwd,
  });
}

export async function checkComposerStandard(options: {
  timeoutMs: number;
  cwd?: string;
  apiKey?: string;
}): Promise<ComposerSmokeResult> {
  return createFoundryAgent(options.apiKey).smokeComposerStandard({
    timeoutMs: options.timeoutMs,
    cwd: options.cwd,
  });
}

export function createCursorAdapter(apiKey?: string): CursorAdapter {
  const client = createFoundryAgent(apiKey);
  return {
    smokeComposerStandard(options) {
      return client.smokeComposerStandard(options);
    },
    smokeComposerFast(options) {
      return client.smokeComposerFast(options);
    },
  };
}

export async function promptComposer(
  prompt: string,
  cwd: string,
  apiKey?: string,
): Promise<string> {
  return createFoundryAgent(apiKey).prompt(prompt, cwd, COMPOSER_MODEL_STANDARD);
}
