import type { IssueJob, JobStatus, StageId, StageStatus } from "./types";

export const STAGE_LABEL: Record<StageId, string> = {
  intake: "Intake",
  research: "Research",
  grill: "Grill",
  spec: "Spec",
  improve: "Improve",
  plan_pack: "Plan pack",
  council: "Council",
  architecture: "Architecture",
  execute: "Build",
  evidence: "Evidence",
  merge: "Merge",
  hygiene: "Cleanup",
};

export function jobVerb(stage: StageId): string {
  switch (stage) {
    case "intake":
      return "Saving your idea";
    case "research":
      return "Reading the repo";
    case "grill":
      return "Writing questions";
    case "spec":
      return "Writing the spec";
    case "improve":
      return "Tightening the spec";
    case "plan_pack":
      return "Packing the plan";
    case "council":
      return "Running council";
    case "architecture":
      return "Writing architecture";
    case "execute":
      return "Building";
    case "evidence":
      return "Collecting evidence";
    case "merge":
      return "Opening the pull request";
    case "hygiene":
      return "Cleaning up";
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

export function jobStatusLabel(status: JobStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "failed":
      return "Failed";
    case "stale":
      return "Stalled";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function issueListStatus(stage: StageId, job: IssueJob | null): string {
  if (job?.status === "failed") return `${STAGE_LABEL[stage]} failed`;
  if (job?.status === "stale") return `${STAGE_LABEL[stage]} stalled`;
  if (job?.status === "running") return jobVerb(stage);
  switch (stage) {
    case "grill":
    case "plan_pack":
    case "execute":
    case "evidence":
      return "Waiting on you";
    case "intake":
      return "Saving your idea";
    case "research":
      return jobVerb("research");
    case "spec":
    case "improve":
    case "council":
    case "architecture":
    case "merge":
    case "hygiene":
      return STAGE_LABEL[stage];
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

export function stageTone(status: StageStatus): string {
  switch (status) {
    case "done":
      return "text-neutral-400";
    case "active":
      return "text-neutral-50";
    case "blocked":
      return "text-amber-200";
    case "skipped":
      return "text-neutral-600";
    case "pending":
      return "text-neutral-600";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
