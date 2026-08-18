import { startOneshotWalk } from "./oneshot";
import { drainRetries, scheduleRetry } from "./queue";
import { listIssues, listStaleJobs, reconcileStaleJobs } from "./store";
import { isOneshotWalking, STALE_JOB_MS } from "./types";

export const WATCHDOG_MS = Number(process.env.FOUNDRY_WATCHDOG_MS ?? 300_000);

export function reconcileStaleToRetry(maxAgeMs: number = STALE_JOB_MS): number {
  reconcileStaleJobs(maxAgeMs);
  let scheduled = 0;
  for (const job of listStaleJobs()) {
    scheduleRetry(job.issueId, job.stage, new Error(job.error ?? "Worker stopped reporting"));
    scheduled += 1;
  }
  return scheduled;
}

export function reKickWalks(): number {
  let kicked = 0;
  for (const issue of listIssues()) {
    if (isOneshotWalking(issue)) {
      startOneshotWalk(issue.id);
      kicked += 1;
    }
  }
  return kicked;
}

export function watchdogTick(): { stale: number; drained: number; kicked: number } {
  const stale = reconcileStaleToRetry();
  const drained = drainRetries();
  const kicked = reKickWalks();
  return { stale, drained, kicked };
}

let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

export function startWatchdog(intervalMs: number = WATCHDOG_MS): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      watchdogTick();
    } catch {
      // A failed tick must not kill the process; the next tick retries.
    }
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    started = false;
  }
}

export function ensureWatchdog(): void {
  if (started) return;
  started = true;
  reconcileStaleToRetry();
  startWatchdog();
  reKickWalks();
}