import { z } from "zod";
import "eve/client";
import { runStructured } from "./eve-session";
import { appendEvent } from "./log";
import { parseResearchBrief } from "./research";
import {
  clearJob,
  failJob,
  getArtifact,
  getIssue,
  listDecisionTickets,
  saveArtifact,
  tryClaimJob,
} from "./store";
import { ARTIFACT_KIND } from "./types";

export const SPEC_KIND = "spec_doc";
const specSchema = z.object({
  title: z.string(),
  spec: z.string(),
  acceptance: z.array(z.string()),
});

const inflight = (globalThis as typeof globalThis & {
  __foundrySpec?: Map<string, Promise<void>>;
}).__foundrySpec ??= new Map();

export function specInflight(issueId: string): boolean {
  return inflight.has(issueId);
}

export function startSpec(issueId: string): void {
  if (inflight.has(issueId)) return;
  const work = runSpec(issueId).finally(() => {
    inflight.delete(issueId);
  });
  inflight.set(issueId, work);
}

export async function runSpec(issueId: string): Promise<void> {
  const loaded = getIssue(issueId);
  if (!loaded || loaded.issue.currentStage !== "spec") return;
  if (getArtifact(issueId, SPEC_KIND)) return;
  if (!tryClaimJob(issueId, "spec")) return;
  appendEvent(issueId, "spec.started", {});
  try {
    const brief = getArtifact(issueId, ARTIFACT_KIND.research);
    const parsed = brief ? parseResearchBrief(brief.body) : null;
    const answers = listDecisionTickets(issueId)
      .map((ticket) => `Q: ${ticket.prompt}\nA: ${ticket.answer ?? "(unanswered)"}`)
      .join("\n");
    const doc = await runStructured(
      specSchema,
      [
        "Write a spec for this Foundry Issue. Do not write application code.",
        "The spec is the contract for later stages. Short sentences.",
        `Idea: ${loaded.issue.idea}`,
        `Target: ${loaded.issue.targetUrl}`,
        `Size: ${loaded.issue.size}`,
        parsed ? `Research: ${JSON.stringify(parsed)}` : "",
        answers ? `Grill answers:\n${answers}` : "",
      ].join("\n"),
      { issueId: issueId, stage: "spec" },
    );
    saveArtifact({
      issueId,
      kind: SPEC_KIND,
      stage: "spec",
      body: JSON.stringify(doc),
    });
    clearJob(issueId, "spec");
    appendEvent(issueId, "spec.completed", {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Spec failed";
    failJob(issueId, "spec", message);
    appendEvent(issueId, "spec.failed", { error: message });
  }
}

export function parseSpec(body: string): z.infer<typeof specSchema> | null {
  try {
    return specSchema.parse(JSON.parse(body));
  } catch {
    return null;
  }
}
