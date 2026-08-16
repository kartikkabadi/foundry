import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Client } from "eve/client";
import { z } from "zod";
import { eveHost } from "./eve-host";
import { appendEvent } from "./log";
import {
  clearJob,
  completeActiveStage,
  failJob,
  getArtifact,
  getIssue,
  getJob,
  saveArtifact,
  tryClaimJob,
} from "./store";
import type { Issue, ResearchBrief } from "./types";

export const RESEARCH_KIND = "research_brief";

const researchBriefSchema = z.object({
  inPlainEnglish: z.string(),
  whatTheRepoIs: z.string(),
  whatThisIdeaWouldChange: z.string(),
  constraints: z.array(z.string()),
  risks: z.array(z.string()),
  questionsForYou: z.array(z.string()),
});

const SKIP_DIRS = new Set(["node_modules", ".next", "data", ".git", ".eve", "dist"]);

export function parseResearchBrief(body: string): ResearchBrief | null {
  try {
    return researchBriefSchema.parse(JSON.parse(body));
  } catch {
    return null;
  }
}

export function researchState(issueId: string): {
  brief: ResearchBrief | null;
  job: ReturnType<typeof getJob>;
} {
  const artifact = getArtifact(issueId, RESEARCH_KIND);
  return {
    brief: artifact ? parseResearchBrief(artifact.body) : null,
    job: getJob(issueId, "research"),
  };
}

const inflight = (globalThis as typeof globalThis & {
  __foundryResearch?: Map<string, Promise<void>>;
}).__foundryResearch ??= new Map();

export function researchInflight(issueId: string): boolean {
  return inflight.has(issueId);
}

export function startResearch(issueId: string): void {
  if (inflight.has(issueId)) return;
  const work = runResearch(issueId).finally(() => {
    inflight.delete(issueId);
  });
  inflight.set(issueId, work);
}

export async function runResearch(issueId: string): Promise<void> {
  const loaded = getIssue(issueId);
  if (!loaded || loaded.issue.currentStage !== "research") return;
  if (getArtifact(issueId, RESEARCH_KIND)) {
    completeActiveStage(issueId);
    return;
  }
  if (!tryClaimJob(issueId, "research")) return;
  appendEvent(issueId, "research.started", {});
  try {
    const brief = await requestBrief(loaded.issue);
    saveArtifact({
      issueId,
      kind: RESEARCH_KIND,
      stage: "research",
      body: JSON.stringify(brief),
    });
    clearJob(issueId, "research");
    completeActiveStage(issueId);
    appendEvent(issueId, "research.completed", {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research failed";
    failJob(issueId, "research", message);
    appendEvent(issueId, "research.failed", { error: message });
  }
}

async function requestBrief(issue: Issue): Promise<ResearchBrief> {
  const host = eveHost();
  const health = await fetch(`${host}/eve/v1/health`);
  if (!health.ok) throw new Error("Foundry worker is not reachable");
  const client = new Client({ host });
  const { response } = await client.sessions.create<ResearchBrief>({
    message: buildPrompt(issue),
    outputSchema: researchBriefSchema,
    signal: AbortSignal.timeout(180_000),
  });
  const result = await response.result();
  if (result.data) return researchBriefSchema.parse(result.data);
  if (result.message) {
    const parsed = parseResearchBrief(result.message);
    if (parsed) return parsed;
  }
  throw new Error("Research finished without a brief");
}

function buildPrompt(issue: Issue): string {
  return [
    "You are researching one Foundry Issue. Do not write code. Do not call tools.",
    "The files are already in this message. Ignore bash, read_file, and grep.",
    "Use only the files in this message. Return the output schema.",
    "",
    `Idea: ${issue.idea}`,
    `Target git URL: ${issue.targetUrl}`,
    `Size: ${issue.size}`,
    "",
    "Write for the operator. Short sentences. No factory jargon unless you explain it.",
    "questionsForYou: 3 to 6 concrete questions the operator must answer before any code is written.",
    "",
    gatherRepoContext(),
  ].join("\n");
}

function gatherRepoContext(): string {
  const root = process.cwd();
  const chunks = ["Repo files from the operator machine:"];
  for (const name of ["CONTEXT.md", "README.md", "package.json"]) {
    chunks.push(`--- ${name} ---`, readCapped(join(root, name), 8_000));
  }
  chunks.push("--- file list ---", listSourceFiles(root).join("\n") || "(empty)");
  return chunks.join("\n");
}

function readCapped(path: string, max: number): string {
  try {
    const text = readFileSync(path, "utf8");
    return text.length > max ? `${text.slice(0, max)}\n…` : text;
  } catch {
    return "(missing)";
  }
}

function listSourceFiles(root: string): string[] {
  const acc: string[] = [];
  for (const dir of ["app", "lib/foundry", "agent"]) {
    walk(root, join(root, dir), acc, 80);
  }
  return acc;
}

function walk(root: string, dir: string, acc: string[], max: number): void {
  if (acc.length >= max) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(root, full, acc, max);
    } else {
      acc.push(relative(root, full));
    }
    if (acc.length >= max) return;
  }
}
