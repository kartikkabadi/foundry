import { describe, expect, it } from "vitest";
import { BACKOFF_CAP_MS, backoffMs, isPermanentFailure, isRetryScheduled, isTransientError, nextRetryAt } from "../lib/foundry/retry";

describe("retry classification", () => {
  it("classifies timeouts as transient", () => {
    expect(isTransientError(new Error("The operation was aborted due to timeout"))).toBe(true);
  });

  it("classifies 429 statusCode as transient", () => {
    const error = new Error("rate limit");
    Object.assign(error, { statusCode: 429 });
    expect(isTransientError(error)).toBe(true);
  });

  it("classifies rate_limit_exceeded as transient", () => {
    expect(isTransientError(new Error("error 429: rate_limit_exceeded from gateway"))).toBe(true);
  });

  it("classifies eve empty output as transient (recoverable)", () => {
    expect(isTransientError(new Error("Worker finished without output"))).toBe(true);
  });

  it("classifies worker unreachable as transient", () => {
    expect(isTransientError(new Error("Foundry worker is not reachable"))).toBe(true);
  });

  it("classifies fetch failed as transient", () => {
    expect(isTransientError(new TypeError("fetch failed"))).toBe(true);
  });

  it("classifies eve session creation failure as transient", () => {
    expect(isTransientError(new Error("Failed to create the session."))).toBe(true);
  });

  it("classifies socket hang up as transient", () => {
    expect(isTransientError(new Error("socket hang up"))).toBe(true);
  });

  it("classifies terminated eve sandbox as transient", () => {
    expect(isTransientError(new Error("terminated"))).toBe(true);
  });

  it("classifies grill empty-not-done as transient", () => {
    expect(isTransientError(new Error("Grill returned no tickets and did not set done. Re-run this round."))).toBe(
      true,
    );
  });

  it("classifies missing spec as permanent", () => {
    expect(isTransientError(new Error("No spec artifact found for execute stage"))).toBe(false);
  });

  it("classifies invalid worker output as permanent", () => {
    expect(isTransientError(new Error("Worker finished without valid output"))).toBe(false);
  });

  it("classifies PR creation failure as permanent", () => {
    expect(isTransientError(new Error("Failed to create PR: git push failed"))).toBe(false);
  });

  it("classifies unknown errors as not transient", () => {
    expect(isTransientError(new Error("Some random zod error"))).toBe(false);
  });
});

describe("backoff", () => {
  it("grows exponentially with attempt", () => {
    const first = backoffMs(1);
    const second = backoffMs(2);
    const third = backoffMs(3);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("caps at BACKOFF_CAP_MS plus jitter", () => {
    const delay = backoffMs(12);
    expect(delay).toBeLessThanOrEqual(BACKOFF_CAP_MS + 250);
    expect(delay).toBeGreaterThanOrEqual(BACKOFF_CAP_MS);
  });

  it("produces an ISO next-retry timestamp after now", () => {
    const now = Date.UTC(2026, 7, 18, 12, 0, 0);
    const at = nextRetryAt(1, now);
    expect(Date.parse(at)).toBeGreaterThan(now);
  });
});

describe("retry helpers", () => {
  it("detects a scheduled retry", () => {
    expect(isRetryScheduled({ status: "failed", nextRetryAt: "2026-01-01", retryable: true })).toBe(true);
    expect(isRetryScheduled({ status: "failed", nextRetryAt: null, retryable: true })).toBe(false);
    expect(isRetryScheduled({ status: "running", nextRetryAt: "2026-01-01", retryable: true })).toBe(false);
  });

  it("detects a permanent failure", () => {
    expect(isPermanentFailure({ status: "failed", retryable: false })).toBe(true);
    expect(isPermanentFailure({ status: "failed", retryable: true })).toBe(false);
    expect(isPermanentFailure({ status: "running", retryable: false })).toBe(false);
  });
});
