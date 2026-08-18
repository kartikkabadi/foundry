import { beforeEach, describe, expect, it } from "vitest";
import {
  createIssue,
  failJob,
  getJob,
  listDueRetries,
  resetJobAttempts,
  scheduleJobRetry,
  tryClaimJob,
} from "../lib/foundry/store";
import { decideRetry, drainRetries, scheduleRetry } from "../lib/foundry/queue";
import type { RetryDecision } from "../lib/foundry/retry";
import { MAX_ATTEMPTS } from "../lib/foundry/types";

process.env.FOUNDRY_DATA = `/tmp/foundry-test-store-${process.pid}`;

describe("store job lifecycle", () => {
  beforeEach(() => {
    process.env.FOUNDRY_DATA = `/tmp/foundry-test-store-${process.pid}-${Date.now()}`;
  });

  it("claims a fresh job and increments attempts on re-claim", () => {
    const issue = createIssue({
      idea: "Test claim",
      targetUrl: "https://github.com/kartikkabadi/foundry.git",
      size: "xs",
    });
    expect(tryClaimJob(issue.id, "research")).toBe(true);
    const first = getJob(issue.id, "research");
    expect(first?.status).toBe("running");
    expect(first?.attempts).toBe(1);
    expect(tryClaimJob(issue.id, "research")).toBe(false);
    const still = getJob(issue.id, "research");
    expect(still?.attempts).toBe(1);
    failJob(issue.id, "research", "boom");
    expect(tryClaimJob(issue.id, "research")).toBe(true);
    const retried = getJob(issue.id, "research");
    expect(retried?.status).toBe("running");
    expect(retried?.attempts).toBe(2);
    expect(retried?.nextRetryAt).toBeNull();
    expect(retried?.retryable).toBe(false);
  });

  it("tracks retry schedule on the job", () => {
    const issue = createIssue({
      idea: "Test retry schedule",
      targetUrl: "https://github.com/kartikkabadi/foundry.git",
      size: "xs",
    });
    tryClaimJob(issue.id, "research");
    failJob(issue.id, "research", "The operation was aborted due to timeout");
    scheduleJobRetry(issue.id, "research", "The operation was aborted due to timeout", "2026-08-18T12:00:00.000Z", true);
    const job = getJob(issue.id, "research");
    expect(job?.status).toBe("failed");
    expect(job?.retryable).toBe(true);
    expect(job?.nextRetryAt).toBe("2026-08-18T12:00:00.000Z");
    const due = listDueRetries("2026-08-18T12:00:01.000Z");
    expect(due.some((row) => row.issueId === issue.id && row.stage === "research")).toBe(true);
  });
});

describe("queue", () => {
  beforeEach(() => {
    process.env.FOUNDRY_DATA = `/tmp/foundry-test-queue-${process.pid}-${Date.now()}`;
  });

  it("schedules a retry for a transient error within max attempts", () => {
    const issue = createIssue({
      idea: "Queue retry",
      targetUrl: "https://github.com/kartikkabadi/foundry.git",
      size: "xs",
    });
    tryClaimJob(issue.id, "research");
    const decision = scheduleRetry(issue.id, "research", new Error("The operation was aborted due to timeout"));
    expect(decision.kind).toBe("retry");
    const job = getJob(issue.id, "research");
    expect(job?.retryable).toBe(true);
    expect(job?.nextRetryAt).not.toBeNull();
  });

  it("stops after max attempts", () => {
    const issue = createIssue({
      idea: "Queue permanent",
      targetUrl: "https://github.com/kartikkabadi/foundry.git",
      size: "xs",
    });
    // Drive attempts up to MAX_ATTEMPTS: each claim increments attempts, and
    // a transient failure schedules a retry until the cap is reached.
    let decision: RetryDecision | null = null;
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      tryClaimJob(issue.id, "research");
      decision = scheduleRetry(
        issue.id,
        "research",
        new Error("The operation was aborted due to timeout"),
        Date.now(),
      );
    }
    expect(decision?.kind).toBe("permanent");
    const job = getJob(issue.id, "research");
    expect(job?.attempts).toBe(MAX_ATTEMPTS);
    expect(job?.retryable).toBe(false);
    expect(job?.nextRetryAt).toBeNull();
  });

  it("does not retry permanent errors", () => {
    const issue = createIssue({
      idea: "Queue permanent error",
      targetUrl: "https://github.com/kartikkabadi/foundry.git",
      size: "xs",
    });
    tryClaimJob(issue.id, "research");
    const decision = scheduleRetry(issue.id, "research", new Error("No spec artifact found for execute stage"));
    expect(decision.kind).toBe("permanent");
    const job = getJob(issue.id, "research");
    expect(job?.retryable).toBe(false);
    expect(job?.nextRetryAt).toBeNull();
  });

  it("drains due retries and resets the schedule", () => {
    const issue = createIssue({
      idea: "Queue drain",
      targetUrl: "https://github.com/kartikkabadi/foundry.git",
      size: "xs",
    });
    tryClaimJob(issue.id, "research");
    scheduleJobRetry(issue.id, "research", "timeout", new Date(Date.now() - 1000).toISOString(), true);
    drainRetries(new Date().toISOString());
    const job = getJob(issue.id, "research");
    expect(job?.retryable).toBe(false);
    expect(job?.nextRetryAt).toBeNull();
    const due = listDueRetries(new Date().toISOString());
    expect(due.some((row) => row.issueId === issue.id)).toBe(false);
  });

  it("decides based on current attempts", () => {
    const issue = createIssue({
      idea: "Queue attempts",
      targetUrl: "https://github.com/kartikkabadi/foundry.git",
      size: "xs",
    });
    tryClaimJob(issue.id, "research");
    const decision = decideRetry(issue.id, "research", new Error("fetch failed"));
    expect(decision.kind).toBe("retry");
    resetJobAttempts(issue.id, "research");
    expect(getJob(issue.id, "research")?.attempts).toBe(1);
  });
});
