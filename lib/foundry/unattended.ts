/**
 * Pure, deterministic, bounded selector for unattended Foundry work.
 *
 * Given snapshots of candidate issues — each an `Issue` plus derived booleans
 * describing live runtime state — this module picks the subset that is safe to
 * drive unattended. Selection is oldest-first (createdAt), with id as the tie
 * breaker, and is capped by a caller-supplied limit.
 *
 * The selector is data-only. It never reads or writes the store, never answers
 * a gate, and never starts a worker: every input is injected, so identical
 * input always yields identical output. Persistence and effects belong to the
 * caller. An issue blocked by a safety check is reported with exactly one
 * reason, chosen by the fixed priority documented on `unattendedExclusionFor`.
 * Eligible issues that only fall outside the limit are simply not selected and
 * are not reported as excluded.
 */

import type { Issue, StageId } from "./types";

/** Stages an unattended runner may drive on its own. */
export const UNATTENDED_ELIGIBLE_STAGES: readonly StageId[] = [
  "research",
  "improve",
  "plan_pack",
  "council",
  "architecture",
  "execute",
  "evidence",
];

/**
 * Stages the unattended runner never selects: intake (needs a human to shape
 * the idea), grill (needs a human), spec (needs the operator), merge (no
 * auto-merge policy), and hygiene (post-merge cleanup the operator drives).
 */
export const UNATTENDED_EXCLUDED_STAGES: readonly StageId[] = [
  "intake",
  "grill",
  "spec",
  "merge",
  "hygiene",
];

/** Hard ceiling on how many issues a single unattended pass may select. */
export const UNATTENDED_LIMIT_CAP = 20;

/** Why a snapshot was not selected for unattended work. */
export type UnattendedExclusionReason =
  | "disallowed-stage"
  | "disallowed-target"
  | "pending-human-gate"
  | "active-job"
  | "oneshot-walking"
  | "walk-held"
  | "grill-held"
  | "unresolved-dependencies";

/**
 * Snapshot of one candidate issue plus the derived runtime booleans the
 * selector needs. Every field is injected by the caller (typically from the
 * store); the selector reads only these values and never re-derives state.
 */
export type UnattendedSnapshot = {
  issue: Issue;
  /** A job is claimed or running for the issue's current stage. */
  activeJob: boolean;
  /** The issue is a oneshot that a walk loop is currently driving. */
  oneshotWalking: boolean;
  /** The issue's walk is paused by a walk hold. */
  walkHold: boolean;
  /** The issue is held pending a human grill review. */
  grillHold: boolean;
  /** Inputs required by the current stage (artifacts/jobs) are not all present. */
  unresolvedDependencies: boolean;
  /** A gate for the current stage is pending human input. */
  humanGate: boolean;
  /** The issue's project/repository is within the allowed set. */
  allowedTarget: boolean;
};

/** One excluded issue and the single reason it was not selected. */
export type UnattendedExclusion = {
  issueId: string;
  reason: UnattendedExclusionReason;
};

export type UnattendedSelection = {
  /** Selected issue ids, oldest-first then by id. */
  selected: string[];
  /** One reason per excluded issue, in the same deterministic order. */
  exclusions: UnattendedExclusion[];
};

/**
 * Pure per-issue eligibility check. Returns the first applicable exclusion
 * reason in fixed priority, or null when the issue is safe to select:
 *
 *   1. disallowed-stage        stage is not in UNATTENDED_ELIGIBLE_STAGES
 *   2. disallowed-target       project/repository outside the allowed set
 *   3. pending-human-gate      a gate is waiting on a human (never auto-answered)
 *   4. active-job              a job is already running for this stage
 *   5. oneshot-walking         a oneshot walk loop is already driving the issue
 *   6. walk-held               the issue's walk is paused
 *   7. grill-held              held pending human grill review
 *   8. unresolved-dependencies required stage inputs are missing
 */
export function unattendedExclusionFor(snapshot: UnattendedSnapshot): UnattendedExclusionReason | null {
  if (!UNATTENDED_ELIGIBLE_STAGES.includes(snapshot.issue.currentStage)) return "disallowed-stage";
  if (!snapshot.allowedTarget) return "disallowed-target";
  if (snapshot.humanGate) return "pending-human-gate";
  if (snapshot.activeJob) return "active-job";
  if (snapshot.oneshotWalking) return "oneshot-walking";
  if (snapshot.walkHold) return "walk-held";
  if (snapshot.grillHold) return "grill-held";
  if (snapshot.unresolvedDependencies) return "unresolved-dependencies";
  return null;
}

function validateLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(
      `selectUnattended: limit must be a finite positive integer, received ${String(limit)}`,
    );
  }
  return Math.min(limit, UNATTENDED_LIMIT_CAP);
}

/**
 * Select the safe subset of candidate issues to run unattended.
 *
 * Requires a finite positive integer `limit`, hard-capped at
 * UNATTENDED_LIMIT_CAP. Candidates are evaluated oldest-first (createdAt, then
 * id). An excluded issue is reported once in `exclusions`; eligible issues
 * beyond the limit are not selected and are not reported.
 */
export function selectUnattended(snapshots: UnattendedSnapshot[], limit: number): UnattendedSelection {
  const capped = validateLimit(limit);
  const ordered = [...snapshots].sort((a, b) => {
    if (a.issue.createdAt < b.issue.createdAt) return -1;
    if (a.issue.createdAt > b.issue.createdAt) return 1;
    if (a.issue.id < b.issue.id) return -1;
    if (a.issue.id > b.issue.id) return 1;
    return 0;
  });
  const selected: string[] = [];
  const exclusions: UnattendedExclusion[] = [];
  for (const snapshot of ordered) {
    const reason = unattendedExclusionFor(snapshot);
    if (reason !== null) {
      exclusions.push({ issueId: snapshot.issue.id, reason });
      continue;
    }
    if (selected.length >= capped) continue;
    selected.push(snapshot.issue.id);
  }
  return { selected, exclusions };
}
