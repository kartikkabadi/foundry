export const GRILL_EMPTY_NOT_DONE =
  "Grill returned no tickets and did not set done. Re-run this round.";

const PERMANENT_MARKERS = [
  "No spec artifact found",
  "Worker finished without valid output",
  "Failed to create PR",
  "invalid stage",
];

const TRANSIENT_MARKERS = [
  "The operation was aborted due to timeout",
  "rate_limit_exceeded",
  "GatewayRateLimitError",
  "Worker finished without output",
  "Foundry worker is not reachable",
  "Worker stopped reporting",
  "fetch failed",
  "Failed to create the session.",
  "socket hang up",
  "terminated",
];

export function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const status =
    error instanceof Error && "statusCode" in error ? String((error as { statusCode?: unknown }).statusCode ?? "") : "";
  if (code === "429" || status === "429") return true;
  if (message === GRILL_EMPTY_NOT_DONE) return true;
  if (PERMANENT_MARKERS.some((marker) => message.includes(marker))) return false;
  return TRANSIENT_MARKERS.some((marker) => message.includes(marker));
}

export const BACKOFF_CAP_MS = 600_000;

export function backoffMs(attempt: number): number {
  const base = 500 * Math.pow(2, Math.max(attempt - 1, 0));
  const delay = Math.min(base, BACKOFF_CAP_MS);
  return delay + Math.floor(Math.random() * 250);
}

export function nextRetryAt(attempt: number, now = Date.now()): string {
  return new Date(now + backoffMs(attempt)).toISOString();
}

export function isRetryScheduled(job: { status: string; nextRetryAt: string | null; retryable: boolean }): boolean {
  return job.status === "failed" && Boolean(job.nextRetryAt) && job.retryable;
}

export function isPermanentFailure(job: { status: string; retryable: boolean }): boolean {
  return job.status === "failed" && !job.retryable;
}

export type RetryDecision =
  | { kind: "retry"; attempts: number; nextRetryAt: string }
  | { kind: "permanent"; attempts: number };
