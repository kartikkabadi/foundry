import { isOneshotWalking, type Issue, type IssueJob, type JobStatus, type RunMode, type StageId, type StageStatus } from "./types";
import { isPermanentFailure, isRetryScheduled } from "./retry";

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

export function nowWhat(
  stage: StageId,
  job: IssueJob | null,
  extras?: {
    unansweredTickets?: number;
    runMode?: RunMode;
    walkHold?: boolean;
    oneshotStopReason?: string | null;
  },
): string {
  if (extras?.oneshotStopReason) return extras.oneshotStopReason;
  if (extras?.runMode === "oneshot" && extras.walkHold) {
    return "One shot is paused. Resume to keep walking, or work this stage by hand.";
  }
  if (extras?.runMode === "oneshot" && job?.status === "running") {
    return `${jobVerb(stage)}. One shot will take the next gate from the worker recommendation.`;
  }
  if (job?.status === "running") return `${jobVerb(stage)}.`;
  if (job?.status === "failed") {
    if (isRetryScheduled(job)) {
      const waitMs = (job.nextRetryAt ? Date.parse(job.nextRetryAt) : 0) - Date.now();
      return waitMs > 0
        ? `${STAGE_LABEL[stage]} failed but will auto-retry in ${Math.ceil(waitMs / 1000)}s.`
        : `${STAGE_LABEL[stage]} failed and is retrying now.`;
    }
    return `${STAGE_LABEL[stage]} failed permanently after ${job.attempts} attempts. Retry it — the worker is not still working.`;
  }
  if (job?.status === "stale") {
    return `${STAGE_LABEL[stage]} stalled and will auto-retry.`;
  }
  if (extras?.runMode === "oneshot") {
    switch (stage) {
      case "grill":
        return "One shot will answer Decision tickets with the worker recommendation. You can override any ticket.";
      case "merge":
        return "One shot stops here. Foundry does not merge to GitHub yet.";
      case "intake":
      case "research":
      case "spec":
      case "improve":
      case "plan_pack":
      case "council":
      case "architecture":
      case "execute":
      case "evidence":
      case "hygiene":
        return "One shot is walking. Gates auto-resolve from worker recommendations.";
      default: {
        const _exhaustive: never = stage;
        return _exhaustive;
      }
    }
  }
  switch (stage) {
    case "intake":
      return "Saving your idea.";
    case "research":
      return "Read the brief when it lands, then continue. Foundry is not waiting on you yet.";
    case "grill": {
      const remaining = extras?.unansweredTickets ?? 0;
      if (remaining > 0) {
        return remaining === 1
          ? "Answer the remaining Decision ticket. Grill does not move until you do."
          : `Answer ${remaining} remaining Decision tickets. Grill does not move until you do.`;
      }
      return "Every ticket in this round is answered. The next round starts on its own, or finish grill now.";
    }
    case "spec":
      return "Read the spec. Continue when it is the plan you actually want.";
    case "improve":
      return "Read the tightened spec, then continue.";
    case "plan_pack":
      return "This is a gate. Read the plan pack, then continue when you accept it.";
    case "council":
      return "Read the council notes, then continue.";
    case "architecture":
      return "Read the architecture notes, then continue.";
    case "execute":
      return "This is a gate. Review the build, then continue when you want evidence collected.";
    case "evidence":
      return "This is a gate. Read the evidence, then continue when you will merge.";
    case "merge":
      return "Read the merge notes, then continue.";
    case "hygiene":
      return "Read the cleanup notes. This is the last stage.";
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

export function gateNowWhat(stage: StageId): string {
  switch (stage) {
    case "grill":
      return "Answer Decision tickets";
    case "plan_pack":
      return "Accept or reject the plan pack";
    case "execute":
      return "Review the build";
    case "evidence":
      return "Read the evidence before merge";
    case "intake":
    case "research":
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

export function issueListStatus(issue: Issue, job: IssueJob | null): string {
  if (issue.oneshotStopReason) return "One shot stopped";
  if (isOneshotWalking(issue)) {
    if (job?.status === "failed") return `${STAGE_LABEL[issue.currentStage]} failed`;
    if (job?.status === "stale") return `${STAGE_LABEL[issue.currentStage]} stalled`;
    return "One shot walking";
  }
  if (job?.status === "failed") {
    if (isRetryScheduled(job)) return `${STAGE_LABEL[issue.currentStage]} retrying`;
    return `${STAGE_LABEL[issue.currentStage]} failed`;
  }
  if (job?.status === "stale") return `${STAGE_LABEL[issue.currentStage]} stalled`;
  if (job?.status === "running") return jobVerb(issue.currentStage);
  switch (issue.currentStage) {
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
      return STAGE_LABEL[issue.currentStage];
    default: {
      const _exhaustive: never = issue.currentStage;
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
