import { z } from "zod";
import "eve/client";
import { runStructured } from "./eve-session";
import { appendEvent } from "./log";
import { parseResearchBrief } from "./research";
import { startSpec } from "./spec";
import {
  clearJob,
  completeActiveStage,
  currentGrillRound,
  failJob,
  getArtifact,
  getIssue,
  isGrillHeld,
  listDecisionTickets,
  saveArtifact,
  saveDecisionTickets,
  tryClaimJob,
  unansweredTicketCount,
} from "./store";
import { ARTIFACT_KIND } from "./types";

export const GRILL_INFLIGHT = (globalThis as typeof globalThis & {
  __foundryGrill?: Map<string, Promise<void>>;
}).__foundryGrill ??= new Map();

export const GRILL_EMPTY_NOT_DONE =
  "Grill returned no tickets and did not set done. Re-run this round.";

export const GRILL_SUMMARY_KIND = ARTIFACT_KIND.grillSummary;

const grillSchema = z.object({
  done: z.boolean(),
  tickets: z.array(
    z.object({
      prompt: z.string(),
      recommendation: z.string(),
      priorMatch: z.string().nullable(),
    }),
  ),
});

export type GrillRoundOutcome = "save_tickets" | "auto_complete" | "empty_not_done";

export function grillRoundOutcome(done: boolean, ticketCount: number): GrillRoundOutcome {
  if (ticketCount > 0) return "save_tickets";
  if (done) return "auto_complete";
  return "empty_not_done";
}

export function grillFrontierEmpty(issueId: string): boolean {
  const tickets = listDecisionTickets(issueId);
  return tickets.length > 0 && unansweredTicketCount(issueId) === 0;
}

export function grillInflight(issueId: string): boolean {
  return GRILL_INFLIGHT.has(issueId);
}

export function startGrill(issueId: string): void {
  if (GRILL_INFLIGHT.has(issueId)) return;
  if (isGrillHeld(issueId)) return;
  const work = runGrill(issueId).finally(() => {
    GRILL_INFLIGHT.delete(issueId);
  });
  GRILL_INFLIGHT.set(issueId, work);
}

export async function runGrill(issueId: string): Promise<void> {
  const loaded = getIssue(issueId);
  if (!loaded || loaded.issue.currentStage !== "grill") return;
  if (isGrillHeld(issueId)) return;
  if (unansweredTicketCount(issueId) > 0) return;
  if (!tryClaimJob(issueId, "grill")) return;
  const round = currentGrillRound(issueId) + 1;
  appendEvent(issueId, "grill.started", { round }, { source: "system", reason: "auto-advance" });
  try {
    const brief = getArtifact(issueId, "research_brief");
    const parsed = brief ? parseResearchBrief(brief.body) : null;
    const answered = listDecisionTickets(issueId)
      .filter((ticket) => ticket.answer)
      .map(
        (ticket) =>
          `Q: ${ticket.prompt}\nRecommendation: ${ticket.recommendation}\nAnswer: ${ticket.answer}`,
      )
      .join("\n\n");
    const result = await runStructured(
      grillSchema,
      [
        "You are grilling the operator of a software factory. Do not write code.",
        "Produce Decision tickets: questions whose answers are decisions, not implementation slices.",
        "Each ticket needs a prompt, a recommendation, and priorMatch (null if none).",
        "If the operator's answers are enough to write a spec, set done=true and tickets=[].",
        "Otherwise set done=false and 2 to 5 new tickets. Do not repeat answered questions.",
        "Never set done=true while also returning tickets. A non-empty ticket list means the round continues.",
        "",
        `Idea: ${loaded.issue.idea}`,
        `Target: ${loaded.issue.targetUrl}`,
        `Size: ${loaded.issue.size}`,
        parsed ? `Brief: ${JSON.stringify(parsed)}` : "No research brief.",
        answered ? `Answered:\n${answered}` : "No answers yet. First round.",
      ].join("\n"),
    );
    const outcome = grillRoundOutcome(result.done, result.tickets.length);
    switch (outcome) {
      case "save_tickets":
        saveDecisionTickets(issueId, result.tickets, round);
        clearJob(issueId, "grill");
        appendEvent(issueId, "grill.round", { round, done: false, count: result.tickets.length });
        return;
      case "auto_complete":
        saveGrillSummary(issueId);
        clearJob(issueId, "grill");
        appendEvent(issueId, "grill.round", { round, done: true, count: 0 });
        completeActiveStage(issueId, { source: "system", reason: "auto-complete" });
        startSpec(issueId);
        return;
      case "empty_not_done":
        failJob(issueId, "grill", GRILL_EMPTY_NOT_DONE);
        appendEvent(issueId, "grill.hold", { round, condition: "empty-not-done" });
        return;
      default: {
        const _exhaustive: never = outcome;
        return _exhaustive;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Grill failed";
    failJob(issueId, "grill", message);
    appendEvent(issueId, "grill.failed", { error: message });
  }
}

export function saveGrillSummary(issueId: string): void {
  const tickets = listDecisionTickets(issueId).map((ticket) => ({
    round: ticket.round,
    prompt: ticket.prompt,
    answer: ticket.answer,
  }));
  saveArtifact({
    issueId,
    kind: GRILL_SUMMARY_KIND,
    stage: "grill",
    body: JSON.stringify({ title: "Grill summary", tickets }),
  });
}

export function parseGrillSummary(body: string): {
  title: string;
  tickets: Array<{ round: number; prompt: string; answer: string | null }>;
} | null {
  try {
    const parsed = JSON.parse(body) as {
      title?: unknown;
      tickets?: unknown;
    };
    if (typeof parsed.title !== "string" || !Array.isArray(parsed.tickets)) return null;
    return {
      title: parsed.title,
      tickets: parsed.tickets.map((item) => {
        const row = item as { round?: unknown; prompt?: unknown; answer?: unknown };
        return {
          round: typeof row.round === "number" ? row.round : 0,
          prompt: typeof row.prompt === "string" ? row.prompt : "",
          answer: typeof row.answer === "string" ? row.answer : null,
        };
      }),
    };
  } catch {
    return null;
  }
}
