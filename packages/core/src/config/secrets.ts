/** Scrub secrets from text before writing artifacts or logging. */

const SECRET_PATTERNS: RegExp[] = [
  /(?:CURSOR_API_KEY|cursor_api_key)\s*[=:]\s*\S+/gi,
  /\bsk-[a-zA-Z0-9_-]{20,}\b/g,
  /\bkey_[a-zA-Z0-9_-]{20,}\b/g,
];

export function scrubSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

export function safeErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return scrubSecrets(message);
}
