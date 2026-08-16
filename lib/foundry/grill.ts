import { z } from "zod";
import "eve/client";
import { runStructured } from "./eve-session";
import { appendEvent } from "./log";
import { parseResearchBrief } from "./research";
import {
  clearJob,
  currentGrillRound,
  failJob,
  getArtifact,
  getIssue,
  listDecisionTickets,
  saveDecisionTickets,
  tryClaimJob,
  unansweredTicketCount,
} from "./store";

export const GRILL_INFLIGHT = (globalThis as typeof globalThis & {
  __foundryGrill?: Map<string, Promise<void>>;
}).__foundryGrill ??= new Map();

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

export function grillFrontierEmpty(issueId: string): boolean {
  const tickets = listDecisionTickets(issueId);
  return tickets.length > 0 && unansweredTicketCount(issueId) === 0;
}

export function startGrill(issueId: string): void {
  if (GRILL_INFLIGHT.has(issueId)) return;
  const work = runGrill(issueId).finally(() => {
    GRILL_INFLIGHT.delete(issueId);
  });
  GRILL_INFLIGHT.set(issueId, work);
}

export async function runGrill(issueId: string): Promise<void> {
  const loaded = getIssue(issueId);
  if (!loaded || loaded.issue.currentStage !== "grill") return;
  if (unansweredTicketCount(issueId) > 0) return;
  if (!tryClaimJob(issueId, "grill")) return;
  const round = currentGrillRound(issueId) + 1;
  appendEvent(issueId, "grill.started", { round });
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
        "",
        `Idea: ${loaded.issue.idea}`,
        `Target: ${loaded.issue.targetUrl}`,
        `Size: ${loaded.issue.size}`,
        parsed ? `Brief: ${JSON.stringify(parsed)}` : "No research brief.",
        answered ? `Answered:\n${answered}` : "No answers yet. First round.",
      ].join("\n"),
    );
    if (!result.done && result.tickets.length > 0) {
      saveDecisionTickets(issueId, result.tickets, round);
    }
    clearJob(issueId, "grill");
    appendEvent(issueId, "grill.round", { round, done: result.done, count: result.tickets.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Grill failed";
    failJob(issueId, "grill", message);
    appendEvent(issueId, "grill.failed", { error: message });
  }
}
