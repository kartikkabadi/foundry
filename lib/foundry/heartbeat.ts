import { updateJobHeartbeat } from "./store";
import type { StageId } from "./types";

export const HEARTBEAT_MS = Number(process.env.FOUNDRY_HEARTBEAT_MS ?? 60_000);

export function withHeartbeat<T>(
  issueId: string | null,
  stage: StageId | null,
  promise: Promise<T>,
  intervalMs: number = HEARTBEAT_MS,
): Promise<T> {
  if (!issueId || !stage) return promise;
  const timer = setInterval(() => {
    try {
      updateJobHeartbeat(issueId, stage);
    } catch {
      // DB writes can fail transiently; the watchdog reconciles silence later.
    }
  }, intervalMs);
  const stop = () => clearInterval(timer);
  promise.then(stop, stop);
  return promise;
}
