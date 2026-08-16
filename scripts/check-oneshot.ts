import { tickOneshot } from "../lib/foundry/oneshot.ts";
import { readEvents } from "../lib/foundry/log.ts";
import {
  completeActiveStage,
  createIssue,
  getIssue,
  listDecisionTickets,
  saveDecisionTickets,
  setWalkHold,
  unansweredTicketCount,
} from "../lib/foundry/store.ts";

process.env.FOUNDRY_DATA = `/tmp/foundry-oneshot-${process.pid}`;

const oneshot = createIssue({
  idea: "One shot auto-answer",
  targetUrl: "https://github.com/kartikkabadi/foundry.git",
  size: "forced_l",
  runMode: "oneshot",
});
if (oneshot.runMode !== "oneshot") throw new Error("oneshot runMode not persisted");
if (oneshot.walkHold) throw new Error("oneshot should not start held");

completeActiveStage(oneshot.id);
saveDecisionTickets(
  oneshot.id,
  [{ prompt: "Ship One shot as an explicit intake mode?", recommendation: "Yes. Default remains HITL.", priorMatch: null }],
  1,
);
const answered = tickOneshot(oneshot.id);
if (answered.action !== "auto_answer") throw new Error(`expected auto_answer, got ${answered.action}`);
const tickets = listDecisionTickets(oneshot.id);
if (tickets[0]?.answer !== "Yes. Default remains HITL.") {
  throw new Error(`recommendation not recorded, got ${tickets[0]?.answer}`);
}
if (!readEvents(oneshot.id).some((event) => event.kind === "gate.auto")) {
  throw new Error("missing gate.auto event");
}

const hitl = createIssue({
  idea: "HITL must wait",
  targetUrl: "https://github.com/kartikkabadi/foundry.git",
  size: "forced_l",
  runMode: "hitl",
});
if (hitl.runMode !== "hitl") throw new Error("hitl default broken");
completeActiveStage(hitl.id);
saveDecisionTickets(
  hitl.id,
  [{ prompt: "Stay HITL?", recommendation: "Yes", priorMatch: null }],
  1,
);
const skipped = tickOneshot(hitl.id);
if (skipped.action !== "skip") throw new Error(`HITL tick must skip, got ${skipped.action}`);
if (unansweredTicketCount(hitl.id) !== 1) throw new Error("HITL tickets must stay unanswered");

const paused = createIssue({
  idea: "Paused oneshot",
  targetUrl: "https://github.com/kartikkabadi/foundry.git",
  size: "forced_l",
  runMode: "oneshot",
});
completeActiveStage(paused.id);
setWalkHold(paused.id, true);
saveDecisionTickets(
  paused.id,
  [{ prompt: "Pause must block auto-answer?", recommendation: "Yes", priorMatch: null }],
  1,
);
const held = tickOneshot(paused.id);
if (held.action !== "skip") throw new Error(`paused tick must skip, got ${held.action}`);
if (unansweredTicketCount(paused.id) !== 1) throw new Error("paused oneshot must not auto-answer");

const stopper = createIssue({
  idea: "Stop before fake merge",
  targetUrl: "https://github.com/kartikkabadi/foundry.git",
  size: "forced_l",
  runMode: "oneshot",
});
for (let i = 0; i < 20; i += 1) {
  const loaded = getIssue(stopper.id);
  if (!loaded) throw new Error("missing stopper");
  if (loaded.issue.currentStage === "merge") break;
  completeActiveStage(stopper.id);
}
const atMerge = getIssue(stopper.id);
if (atMerge?.issue.currentStage !== "merge") throw new Error("failed to reach merge");
const stopped = tickOneshot(stopper.id);
if (stopped.action !== "stop") throw new Error(`expected stop at merge, got ${stopped.action}`);
const after = getIssue(stopper.id);
if (!after?.issue.oneshotStopReason) throw new Error("merge stop reason missing");
if (after.issue.currentStage !== "merge") throw new Error("must remain on merge");

console.log("ONESHOT_OK", oneshot.id, hitl.id, paused.id, stopper.id);
