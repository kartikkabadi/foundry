import { isTransientError, nextRetryAt, type RetryDecision } from "./retry";
import { getJob, listDueRetries, scheduleJobRetry } from "./store";
import { startStageWorker } from "./oneshot";
import { MAX_ATTEMPTS, type StageId } from "./types";

export function decideRetry(
  issueId: string,
  stage: StageId,
  error: unknown,
  now = Date.now(),
): RetryDecision {
  const attempts = getJob(issueId, stage)?.attempts ?? 1;
  if (attempts < MAX_ATTEMPTS && isTransientError(error)) {
    return { kind: "retry", attempts, nextRetryAt: nextRetryAt(attempts, now) };
  }
  return { kind: "permanent", attempts };
}

export function scheduleRetry(
  issueId: string,
  stage: StageId,
  error: unknown,
  now = Date.now(),
): RetryDecision {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const decision = decideRetry(issueId, stage, error, now);
  scheduleJobRetry(issueId, stage, message, decision.kind === "retry" ? decision.nextRetryAt : null, decision.kind === "retry");
  return decision;
}

export function drainRetries(now = new Date().toISOString()): number {
  const due = listDueRetries(now);
  let dispatched = 0;
  for (const job of due) {
    startStageWorker(job.issueId, job.stage);
    dispatched += 1;
  }
  return dispatched;
}
