/**
 * Bounded one-pass runtime adapter over `planAutomation`.
 *
 * `planAutomation` is the pure decision layer: given an injected
 * `AutomationInput` it returns ordered, bounded intents and never touches the
 * world. This driver is the thin effect boundary that turns one plan into
 * exactly one pass of sequential, deterministic effects.
 *
 * Design:
 * - The planner is called exactly once per pass. It defaults to
 *   `planAutomation` and may be overridden (`AutomationDriverOptions.planner`)
 *   so callers can supply a custom planner of the same contract.
 * - Start intents are applied strictly in plan order, one at a time, awaiting
 *   each effect before the next. Identical input always yields identical
 *   ordering of effect calls and audit events.
 * - Every intent produces one recorded outcome (`AutomationIntentOutcome`)
 *   with a per-intent success/failure verdict. A throwing start effect fails
 *   only its own intent; the pass continues with the remaining intents. A
 *   start intent whose effect was not injected fails closed as that intent's
 *   failure.
 * - `wait` and `stop` are audit-only: no start effect is ever invoked for
 *   them; the driver records the outcome and forwards it to the audit sink.
 * - The audit sink is best-effort and never aborts the pass; the authoritative
 *   record is the returned `results` array.
 * - The pass fails closed before any effect: a plan with duplicate
 *   `start-issue` ids or more than `UNATTENDED_LIMIT_CAP` (20) `start-issue`
 *   intents throws `AutomationDriverError` with zero mutation.
 * - Inputs are never mutated; the driver reads the already-derived
 *   `AutomationInput` and hands it to the planner untouched.
 *
 * The driver never answers a gate, never self-approves, never mutates state,
 * and never proposes merge, cleanup, publish, deploy, or self-approval — it
 * only applies the decisions the planner already made.
 */

import {
  planAutomation,
  type AutomationInput,
  type AutomationIntent,
  type AutomationPlan,
} from "./automation";
import { UNATTENDED_LIMIT_CAP } from "./unattended";

/** Per-intent outcome for one pass; also the audit-sink event shape. */
export type AutomationIntentOutcome =
  | { kind: "start-issue"; issueId: string; status: "succeeded" | "failed"; error?: string }
  | { kind: "start-improvement"; candidateId: string; status: "succeeded" | "failed"; error?: string }
  | { kind: "wait"; reason: string }
  | { kind: "stop"; reason: string };

/** Thrown when a fencing check fails: the lease the caller must still hold is
 *  no longer owned by them (released, expired, or taken over). The pass
 *  aborts and the tick records a truthful failure, never success. */
export class LeaseFenceError extends Error {
  constructor(leaseId: string) {
    super(`lease ${leaseId} lost during pass`);
    this.name = "LeaseFenceError";
  }
}

/** Lease-guarded mutation capability handed to mutation-capable effects.
 *  `run` is the ONLY mutation path a supervised effect may use: it executes
 *  `mutate` inside a lease-guarded critical section (same SQLite
 *  connection/transaction) and throws `LeaseFenceError` when the lease is no
 *  longer live — released, expired, or taken over — so the mutation never
 *  runs stale. The effect may do async work before `run`, but the mutation
 *  itself must be synchronous: a transaction cannot span awaits. */
export type LeaseGuard = {
  leaseId: string;
  owner: string;
  run: <T>(mutate: () => T) => T;
};

/** A pass with no lease (standalone runtime): the guard admits every
 *  mutation. The supervisor never uses this — it builds a real guard tied to
 *  its lease. */
export function noLeaseGuard(): LeaseGuard {
  return { leaseId: "", owner: "", run: <T>(mutate: () => T): T => mutate() };
}

/** Start one unattended issue. Receives the lease guard and must perform any
 *  durable mutation through `guard.run` (never directly); throwing marks that
 *  intent failed, and a `LeaseFenceError` aborts the whole pass. */
export type StartIssueEffect = (issueId: string, guard: LeaseGuard) => void | Promise<void>;

/** Start the recursive-improvement candidate. Same guarded-mutation contract
 *  as `StartIssueEffect`. */
export type StartImprovementEffect = (candidateId: string, guard: LeaseGuard) => void | Promise<void>;

/** Audit sink; receives one outcome per intent, in plan order. Best-effort. */
export type AuditEffect = (outcome: AutomationIntentOutcome) => void | Promise<void>;

export type AutomationDriverEffects = {
  /** Issue automation. Optional: a run without it fails start-issue intents closed. */
  startIssue?: StartIssueEffect;
  /** Improvement automation. Optional: a run without it fails start-improvement intents closed. */
  startImprovement?: StartImprovementEffect;
  /** Required outcome sink. */
  audit: AuditEffect;
};

export type AutomationDriverOptions = {
  /** Planner override; defaults to planAutomation. Called exactly once. */
  planner?: (input: AutomationInput) => AutomationPlan;
};

export type AutomationDriverResult = {
  /** The plan the driver applied, as produced by the planner. */
  plan: AutomationPlan;
  /** Per-intent outcomes in exact plan order. */
  results: AutomationIntentOutcome[];
  /** Issue ids whose start succeeded, in plan order. */
  startedIssueIds: string[];
  /** Candidate id whose start succeeded, or null when none did. */
  startedCandidateId: string | null;
  /** Number of start intents that failed (throwing effect or missing effect). */
  failedStarts: number;
};

/** Thrown when a plan violates the driver's hard invariants; nothing ran. */
export class AutomationDriverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationDriverError";
  }
}

/** Fail closed before any effect: no duplicate issue ids, at most 20 issue starts. */
function assertBoundedPlan(plan: AutomationPlan): void {
  const seenIssueIds = new Set<string>();
  let issueStarts = 0;
  for (const intent of plan.intents) {
    if (intent.kind !== "start-issue") {
      continue;
    }
    issueStarts += 1;
    if (issueStarts > UNATTENDED_LIMIT_CAP) {
      throw new AutomationDriverError(
        `plan exceeds the ${UNATTENDED_LIMIT_CAP} start-issue bound (${issueStarts} start-issue intents)`,
      );
    }
    if (seenIssueIds.has(intent.issueId)) {
      throw new AutomationDriverError(`duplicate start-issue intent for ${intent.issueId}`);
    }
    seenIssueIds.add(intent.issueId);
  }
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run one bounded automation pass. Builds the plan once, applies start intents
 * sequentially in plan order, and records one outcome per intent. `wait` and
 * `stop` only reach the audit sink. Validation errors throw before any effect.
 *
 * `guard` is the lease guard handed to each start effect: the effect performs
 * its durable mutation through `guard.run`, which is the supervisor's atomic
 * admission boundary (lease-live check and mutation on the same
 * connection/transaction). A `LeaseFenceError` from `guard.run` is rethrown,
 * never folded into a per-intent failure, so a lost lease aborts the pass and
 * the tick records a truthful failure. A lease-less pass passes `noLeaseGuard()`.
 */
export async function runAutomationDriver(
  input: AutomationInput,
  effects: AutomationDriverEffects,
  guard: LeaseGuard,
  options: AutomationDriverOptions = {},
): Promise<AutomationDriverResult> {
  const planner = options.planner ?? planAutomation;
  const plan = planner(input);
  assertBoundedPlan(plan);

  const results: AutomationIntentOutcome[] = [];
  const startedIssueIds: string[] = [];
  let startedCandidateId: string | null = null;
  let failedStarts = 0;

  for (const intent of plan.intents) {
    const outcome = await applyIntent(intent, effects, guard);
    results.push(outcome);
    if (outcome.kind === "start-issue" && outcome.status === "succeeded") {
      startedIssueIds.push(outcome.issueId);
    } else if (outcome.kind === "start-improvement" && outcome.status === "succeeded") {
      startedCandidateId = outcome.candidateId;
    }
    if (outcome.kind === "start-issue" || outcome.kind === "start-improvement") {
      if (outcome.status === "failed") {
        failedStarts += 1;
      }
    }
    try {
      await effects.audit(outcome);
    } catch (error) {
      // The audit sink is a side channel; the outcome is already in `results`.
      // A throwing sink never aborts the pass or hides the recorded outcome.
      void error;
    }
  }

  return { plan, results, startedIssueIds, startedCandidateId, failedStarts };
}

/** Apply one intent: start effects for start intents, audit-only otherwise. */
async function applyIntent(
  intent: AutomationIntent,
  effects: AutomationDriverEffects,
  guard: LeaseGuard,
): Promise<AutomationIntentOutcome> {
  if (intent.kind === "wait") {
    return { kind: "wait", reason: intent.reason };
  }
  if (intent.kind === "stop") {
    return { kind: "stop", reason: intent.reason };
  }
  if (intent.kind === "start-issue") {
    const start = effects.startIssue;
    if (start === undefined) {
      return {
        kind: "start-issue",
        issueId: intent.issueId,
        status: "failed",
        error: "no startIssue effect injected",
      };
    }
    try {
      await start(intent.issueId, guard);
      return { kind: "start-issue", issueId: intent.issueId, status: "succeeded" };
    } catch (error) {
      if (error instanceof LeaseFenceError) {
        throw error;
      }
      return {
        kind: "start-issue",
        issueId: intent.issueId,
        status: "failed",
        error: failureMessage(error),
      };
    }
  }
  const start = effects.startImprovement;
  if (start === undefined) {
    return {
      kind: "start-improvement",
      candidateId: intent.candidateId,
      status: "failed",
      error: "no startImprovement effect injected",
    };
  }
  try {
    await start(intent.candidateId, guard);
    return { kind: "start-improvement", candidateId: intent.candidateId, status: "succeeded" };
  } catch (error) {
    if (error instanceof LeaseFenceError) {
      throw error;
    }
    return {
      kind: "start-improvement",
      candidateId: intent.candidateId,
      status: "failed",
      error: failureMessage(error),
    };
  }
}
