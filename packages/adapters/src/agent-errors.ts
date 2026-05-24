import { COMPOSER_MODEL_STANDARD } from './foundry-agent.js';

export class FoundryRateLimitError extends Error {
  readonly statusCode = 429;
  readonly modelId: string;

  constructor(message = 'Composer rate limited (HTTP 429)', modelId = COMPOSER_MODEL_STANDARD) {
    super(message);
    this.name = 'FoundryRateLimitError';
    this.modelId = modelId;
  }
}

export function isRateLimitError(err: unknown): err is FoundryRateLimitError {
  return err instanceof FoundryRateLimitError;
}

export function mapAgentPromptError(err: unknown, modelId: string): Error {
  if (err instanceof FoundryRateLimitError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  if (/429|rate.?limit/i.test(message)) {
    return new FoundryRateLimitError(message, modelId);
  }

  return err instanceof Error ? err : new Error(message);
}

/** Guard: adapters must not reference non-Composer model ids. */
export const FORBIDDEN_MODEL_PATTERNS = [
  /\bgpt-[\d.]/i,
  /\bclaude-/i,
  /\bopus\b/i,
  /\bsonnet\b/i,
  /\bgemini-/i,
] as const;

export function assertComposerOnlyModel(modelId: string): void {
  for (const pattern of FORBIDDEN_MODEL_PATTERNS) {
    if (pattern.test(modelId)) {
      throw new Error(`Non-Composer model not allowed: ${modelId}`);
    }
  }
  if (!modelId.startsWith('composer-')) {
    throw new Error(`Model must be Composer family: ${modelId}`);
  }
}
