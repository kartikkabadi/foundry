import { grillInflight, saveGrillSummary, startGrill } from "./grill";
import { appendEvent } from "./log";
import { researchInflight, startResearch } from "./research";
import { specInflight, startSpec } from "./spec";
import { startWalkStage, walkInflight } from "./walk";
import { startExecute, executeInflight } from "./execute";
import {
  answerDecisionTicket,
  completeActiveStage,
  currentGrillRound,
  getArtifact,
  getIssue,
  getJob,
  isGrillHeld,
  listDecisionTickets,
  setOneshotStopReason,
  unansweredTicketCount,
} from "./store";
import {
  artifactKindFor,
  isOneshotWalking,
  type Issue,
  type StageId,
} from "./types";

export const ONESHOT_MERGE_STOP =
  "One shot stopped before merge. Foundry does not open or merge a GitHub pull request yet — there is no evidence/CI merge policy. Open this Issue to continue by hand when that path exists.";

export const ONESHOT_GRILL_MAX_ROUNDS = 4;

export type OneshotTick =
  | { action: "skip" }
  | { action: "wait_job"; stage: StageId }
  | { action: "start_worker"; stage: StageId }
  | { action: "auto_answer"; count: number }
  | { action: "auto_advance"; stage: StageId }
  | { action: "stop"; reason: string };

const inflight = (globalThis as typeof globalThis & {
  __foundryOneshot?: Map<string, Promise<void>>;
}).__foundryOneshot ??= new Map();

export function startOneshotWalk(issueId: string): void {
  if (inflight.has(issueId)) return;
  const work = runOneshotWalk(issueId).finally(() => {
    inflight.delete(issueId);
  });
  inflight.set(issueId, work);
}

export function oneshotInflight(issueId: string): boolean {
  return inflight.has(issueId);
}

export async function runOneshotWalk(issueId: string): Promise<void> {
  while (true) {
    const tick = tickOneshot(issueId);
    switch (tick.action) {
      case "skip":
      case "stop":
        return;
      case "wait_job":
        await sleep(1_000);
        break;
      case "start_worker":
        await sleep(400);
        break;
      case "auto_answer":
      case "auto_advance":
        await sleep(200);
        break;
      default: {
        const _exhaustive: never = tick;
        return _exhaustive;
      }
    }
  }
}

export function tickOneshot(issueId: string): OneshotTick {
  const loaded = getIssue(issueId);
  if (!loaded) return { action: "skip" };
  const { issue } = loaded;
  if (issue.runMode !== "oneshot") return { action: "skip" };
  if (issue.walkHold) return { action: "skip" };
  if (issue.oneshotStopReason) return { action: "stop", reason: issue.oneshotStopReason };
  return tickStage(issue);
}

export function autoAnswerGrillTickets(issueId: string): number {
  const loaded = getIssue(issueId);
  if (!loaded || !isOneshotWalking(loaded.issue)) return 0;
  let count = 0;
  for (const ticket of listDecisionTickets(issueId)) {
    if (ticket.answer) continue;
    const answer = ticket.recommendation.trim();
    if (!answer) continue;
    answerDecisionTicket(ticket.id, answer);
    appendEvent(
      issueId,
      "gate.auto",
      {
        stage: "grill",
        action: "answer_ticket",
        ticketId: ticket.id,
        recommendation: ticket.recommendation,
      },
      { source: "system", reason: "oneshot" },
    );
    count += 1;
  }
  return count;
}

function tickStage(issue: Issue): OneshotTick {
  const stage = issue.currentStage;
  switch (stage) {
    case "intake":
      return { action: "skip" };
    case "research":
      return tickResearch(issue.id);
    case "grill":
      return tickGrill(issue.id);
    case "spec":
    case "improve":
    case "plan_pack":
    case "council":
    case "architecture":
    case "evidence":
    case "hygiene":
      return tickDocumentStage(issue.id, stage);
    case "execute":
      return tickExecuteStage(issue.id);
    case "merge":
      return stopOneshot(issue.id, ONESHOT_MERGE_STOP, "merge-not-real");
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

function tickResearch(issueId: string): OneshotTick {
  const failed = jobFailure(issueId, "research");
  if (failed) return failed;
  if (getJob(issueId, "research")?.status === "running" || researchInflight(issueId)) {
    return { action: "wait_job", stage: "research" };
  }
  if (getArtifact(issueId, "research_brief")) {
    return autoAdvance(issueId, "research", "research_brief");
  }
  startResearch(issueId);
  return { action: "start_worker", stage: "research" };
}

function tickGrill(issueId: string): OneshotTick {
  if (isGrillHeld(issueId)) return { action: "skip" };
  const failed = jobFailure(issueId, "grill");
  if (failed) return failed;
  if (getJob(issueId, "grill")?.status === "running" || grillInflight(issueId)) {
    return { action: "wait_job", stage: "grill" };
  }
  const unanswered = unansweredTicketCount(issueId);
  if (unanswered > 0) {
    const count = autoAnswerGrillTickets(issueId);
    if (count === 0) return { action: "skip" };
    return { action: "auto_answer", count };
  }
  if (currentGrillRound(issueId) >= ONESHOT_GRILL_MAX_ROUNDS) {
    saveGrillSummary(issueId);
    appendEvent(
      issueId,
      "gate.auto",
      { stage: "grill", action: "advance", reason: "grill_round_cap", rounds: ONESHOT_GRILL_MAX_ROUNDS },
      { source: "system", reason: "oneshot" },
    );
    completeActiveStage(issueId, { source: "system", reason: "oneshot" });
    startSpec(issueId);
    return { action: "auto_advance", stage: "grill" };
  }
  startGrill(issueId);
  return { action: "start_worker", stage: "grill" };
}

function tickDocumentStage(issueId: string, stage: StageId): OneshotTick {
  const failed = jobFailure(issueId, stage);
  if (failed) return failed;
  const running =
    getJob(issueId, stage)?.status === "running" ||
    (stage === "spec" ? specInflight(issueId) : walkInflight(issueId));
  if (running) {
    return { action: "wait_job", stage };
  }
  const kind = artifactKindFor(stage);
  if (kind && getArtifact(issueId, kind)) {
    return autoAdvance(issueId, stage, kind);
  }
  startStageWorker(issueId, stage);
  return { action: "start_worker", stage };
}

function tickExecuteStage(issueId: string): OneshotTick {
  const failed = jobFailure(issueId, "execute");
  if (failed) return failed;
  const running =
    getJob(issueId, "execute")?.status === "running" || executeInflight(issueId);
  if (running) {
    return { action: "wait_job", stage: "execute" };
  }
  const kind = artifactKindFor("execute");
  if (kind && getArtifact(issueId, kind)) {
    return autoAdvance(issueId, "execute", kind);
  }
  startStageWorker(issueId, "execute");
  return { action: "start_worker", stage: "execute" };
}

function autoAdvance(issueId: string, stage: StageId, kind: string): OneshotTick {
  appendEvent(
    issueId,
    "gate.auto",
    { stage, action: "advance", kind },
    { source: "system", reason: "oneshot" },
  );
  completeActiveStage(issueId, { source: "system", reason: "oneshot" });
  return { action: "auto_advance", stage };
}

function jobFailure(issueId: string, stage: StageId): OneshotTick | null {
  const job = getJob(issueId, stage);
  if (job?.status !== "failed" && job?.status !== "stale") return null;
  const reason = `${stage} worker ${job.status}${job.error ? `: ${job.error}` : ""}`;
  return stopOneshot(issueId, reason, "oneshot");
}

function stopOneshot(
  issueId: string,
  reason: string,
  eventReason: "oneshot" | "merge-not-real",
): OneshotTick {
  setOneshotStopReason(issueId, reason);
  appendEvent(issueId, "oneshot.stopped", { reason }, { source: "system", reason: eventReason });
  return { action: "stop", reason };
}

function startStageWorker(issueId: string, stage: StageId): void {
  switch (stage) {
    case "research":
      startResearch(issueId);
      return;
    case "grill":
      startGrill(issueId);
      return;
    case "spec":
      startSpec(issueId);
      return;
    case "improve":
    case "plan_pack":
    case "council":
    case "architecture":
    case "evidence":
    case "hygiene":
      startWalkStage(issueId);
      return;
    case "execute":
      startExecute(issueId);
      return;
    case "intake":
    case "merge":
      return;
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
