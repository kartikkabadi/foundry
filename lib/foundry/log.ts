import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { logPath } from "./paths";

export type FoundryEvent = {
  ts: string;
  issueId: string;
  kind: string;
  payload: Record<string, unknown>;
};

export function appendEvent(issueId: string, kind: string, payload: Record<string, unknown> = {}): FoundryEvent {
  const event: FoundryEvent = {
    ts: new Date().toISOString(),
    issueId,
    kind,
    payload,
  };
  const path = logPath(issueId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
  return event;
}
