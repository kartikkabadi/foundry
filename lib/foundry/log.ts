import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { logPath } from "./paths";

export type EventSource = "system" | "operator";

export type EventReason =
  | "auto-advance"
  | "auto-complete"
  | "force-finish"
  | "hold"
  | "reopen"
  | "manual-advance"
  | "manual-complete"
  | "retry"
  | "re-run";

export type EventActor = {
  source: EventSource;
  reason?: EventReason;
};

export type FoundryEvent = {
  ts: string;
  issueId: string;
  kind: string;
  payload: Record<string, unknown>;
};

export function appendEvent(
  issueId: string,
  kind: string,
  payload: Record<string, unknown> = {},
  actor: EventActor = { source: "system" },
): FoundryEvent {
  const event: FoundryEvent = {
    ts: new Date().toISOString(),
    issueId,
    kind,
    payload: {
      ...payload,
      source: actor.source,
      reason: actor.reason ?? null,
    },
  };
  const path = logPath(issueId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
  return event;
}

export function readEvents(issueId: string): FoundryEvent[] {
  try {
    const raw = readFileSync(logPath(issueId), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FoundryEvent);
  } catch {
    return [];
  }
}
