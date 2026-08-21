import { z } from "zod";
import "eve/client";
import { runStructured } from "./eve-session";
import { parseExecuteArtifact } from "./execute";
import { createInflightMap } from "./inflight";
import { appendEvent } from "./log";
import {
  clearJob,
  failJob,
  getArtifact,
  getIssue,
  saveArtifact,
  tryClaimJob,
} from "./store";
import { ARTIFACT_KIND, artifactKindFor, type StageId } from "./types";

const walkDocSchema = z.object({
  title: z.string(),
  body: z.string(),
  nextActions: z.array(z.string()),
});

const EVIDENCE_BUILD_FIELD_CHAR_LIMIT = 8000;

const inflight = createInflightMap("walk", "__foundryWalk");

const WORKER_STAGES: StageId[] = [
  "improve",
  "plan_pack",
  "council",
  "architecture",
  "evidence",
  "merge",
  "hygiene",
];

export function isWalkWorkerStage(stage: StageId): boolean {
  return WORKER_STAGES.includes(stage);
}

export function walkInflight(issueId: string): boolean {
  return inflight.has(issueId);
}

export function startWalkStage(issueId: string): void {
  const key = issueId;
  if (inflight.has(key)) return;
  const work = runWalkStage(issueId).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, work);
}

export async function runWalkStage(issueId: string): Promise<void> {
  const loaded = getIssue(issueId);
  if (!loaded) return;
  const stage = loaded.issue.currentStage;
  if (!isWalkWorkerStage(stage)) return;
  const kind = artifactKindFor(stage);
  if (!kind) return;
  if (getArtifact(issueId, kind)) return;
  if (!tryClaimJob(issueId, stage)) return;
  appendEvent(issueId, `${stage}.started`, {});
  try {
    const spec = getArtifact(issueId, "spec_doc");

    const promptLines = [
      `You are the ${stage} stage of a HITL software factory. Do not write application code.`,
      "Produce a document the operator can read and accept.",
      `Idea: ${loaded.issue.idea}`,
      `Target: ${loaded.issue.targetUrl}`,
      `Size: ${loaded.issue.size}`,
      spec ? `Spec: ${spec.body}` : "No spec stored.",
    ];

    if (stage === "evidence") {
      const buildArtifact = getArtifact(issueId, ARTIFACT_KIND.execute);
      const build = buildArtifact ? parseExecuteArtifact(buildArtifact.body) : null;
      const buildOutput =
        build === null
          ? "Build output:\nNo build artifact available — evidence is reviewing from the spec only."
          : [
              "Build output:",
              `Build PR: ${build.prUrl}`,
              `Diff: ${capField(build.diff)}`,
              `Test results: ${capField(build.testResults)}`,
              `Files changed: ${build.filesChanged.join("\n")}`,
            ].join("\n");
      promptLines.push(
        "Review the Build output below as the primary material and verify it against the Spec. If the Build output says no build artifact is available, review from the spec only.",
        buildOutput,
      );
    }

    promptLines.push(`Write the ${stage} artifact.`);

    const doc = await runStructured(
      walkDocSchema,
      promptLines.join("\n"),
      { issueId: issueId, stage },
    );
    saveArtifact({
      issueId,
      kind,
      stage,
      body: JSON.stringify(doc),
    });
    clearJob(issueId, stage);
    appendEvent(issueId, `${stage}.completed`, {});
  } catch (error) {
    const message = error instanceof Error ? error.message : `${stage} failed`;
    failJob(issueId, stage, message);
    appendEvent(issueId, `${stage}.failed`, { error: message });
  }
}

function capField(value: string): string {
  if (value.length <= EVIDENCE_BUILD_FIELD_CHAR_LIMIT) return value;
  return `${value.slice(0, EVIDENCE_BUILD_FIELD_CHAR_LIMIT)}…(truncated)`;
}

export function parseWalkDoc(body: string): z.infer<typeof walkDocSchema> | null {
  try {
    return walkDocSchema.parse(JSON.parse(body));
  } catch {
    return null;
  }
}
