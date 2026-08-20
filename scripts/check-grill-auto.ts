import { grillRoundOutcome } from "../lib/foundry/grill";
import { appendEvent, readEvents } from "../lib/foundry/log";
import { createIssue } from "../lib/foundry/store";

process.env.FOUNDRY_DATA = "/tmp/foundry-grill-auto";

if (grillRoundOutcome(false, 3) !== "save_tickets") throw new Error("tickets must win");
if (grillRoundOutcome(true, 2) !== "save_tickets") throw new Error("non-empty list beats done");
if (grillRoundOutcome(true, 0) !== "auto_complete") throw new Error("done+empty completes");
if (grillRoundOutcome(false, 0) !== "empty_not_done") throw new Error("empty without done is hold");

const issue = createIssue({
  idea: "Grill auto-complete",
  targetUrl: "https://github.com/kartikkabadi/foundry.git",
  size: "forced_l",
});
appendEvent(issue.id, "stage.completed", { stage: "grill", next: "spec" }, { source: "system", reason: "auto-complete" });
const events = readEvents(issue.id);
const last = events.at(-1);
if (!last || last.payload.source !== "system" || last.payload.reason !== "auto-complete") {
  throw new Error("actor missing on stage.completed");
}
console.log("GRILL_AUTO_OK", issue.id);
