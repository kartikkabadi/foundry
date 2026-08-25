// Recursive improvement loop for the multi-agent engineering system.
// Pure policy: given evidence-backed improvement candidates (derived from
// promoted lesson IDs and evidence refs) and the loop's current budget,
// approval, and gate state, deterministically decide whether to start the
// top-priority candidate, wait for a pending gate or approval, or stop.
// The policy never executes effects, never mutates state, and never
// authorizes itself: paid work requires explicit paid authorization, and
// every candidate must carry an approved review by a reviewer distinct from
// its author. Output is always a plain serializable decision record.

import { relaxesPolicy } from "./learning";

/** Stages a recursive-loop candidate may target. merge, hygiene, gates, and
 *  host configuration are permanently out of scope for loop candidates. */
export const IMPROVEMENT_STAGES = [
  "research",
  "improve",
  "plan_pack",
  "council",
  "architecture",
  "execute",
  "evidence",
] as const;

export type ImprovementStage = (typeof IMPROVEMENT_STAGES)[number];

/** Operator-only actions a loop candidate must never propose. */
export const FORBIDDEN_ACTIONS = [
  "merge",
  "hygiene",
  "gates",
  "host_configuration",
] as const;

export type ForbiddenAction = (typeof FORBIDDEN_ACTIONS)[number];

/** One proposed improvement, backed by promoted lesson IDs and evidence refs. */
export type ImprovementCandidate = {
  /** Stable id; the start decision carries exactly this and nothing more. */
  id: string;
  /** Lower number = higher priority. Ties break on createdAt, then id. */
  priority: number;
  /** ISO-8601 creation time; earlier candidates age first. */
  createdAt: string;
  /** Target stage; must be one of IMPROVEMENT_STAGES. */
  stage: ImprovementStage;
  /** What the candidate proposes to do; must not be a FORBIDDEN_ACTIONS. */
  action: string;
  /** Human-readable proposal; scanned for policy-relaxation markers. */
  proposal: string;
  /** Promoted lesson IDs the improvement derives from. */
  lessonIds: string[];
  /** Supporting evidence refs (event spans, verifier evidence, artifacts). */
  evidenceRefs: string[];
  /** IDs that must be available before this candidate can start. */
  dependsOn: string[];
  /** Authoring agent; the reviewer must be a different agent. */
  author: string;
  /** Independent reviewer; must be set, approved, and distinct from author. */
  reviewer: string | null;
  /** True once the independent reviewer approved the candidate. */
  approved: boolean;
  /** Estimated USD cost; must be finite and positive. */
  estimatedCostUsd: number;
  /** True when this work requires a paid model or host. */
  requiresPaidWork: boolean;
};

/** Current loop budget, approval, and gate state. Every field is a durable
 *  fact owned by the caller; the policy only reads it. */
export type ImprovementPolicyState = {
  /** Loop iteration cap; finite and nonnegative. */
  maxIterations: number;
  /** Iterations already consumed by the loop. */
  iterationsUsed: number;
  /** Total spend cap in USD; finite and nonnegative. */
  maxCostUsd: number;
  /** USD already spent by the loop. */
  spentCostUsd: number;
  /** Per-candidate cost ceiling in USD; finite and nonnegative. */
  perCandidateCeilingUsd: number;
  /** Paid candidates may start only under explicit paid authorization. */
  paidAuthorization: boolean;
  /** True while a human gate is open; the loop must wait. */
  humanGatePending: boolean;
  /** Refs currently available: promoted lesson IDs, evidence refs, done
   *  candidate ids. */
  availableRefs: ReadonlySet<string> | readonly string[];
};

export type ImprovementDecision =
  | { kind: "start"; candidateId: string; reason: string }
  | { kind: "wait"; reason: string }
  | { kind: "stop"; reason: string };

/** Convenience base state for tests and callers; overrides win field-wise. */
export function defaultImprovementState(
  overrides: Partial<ImprovementPolicyState> = {},
): ImprovementPolicyState {
  return {
    maxIterations: 10,
    iterationsUsed: 0,
    maxCostUsd: 1,
    spentCostUsd: 0,
    perCandidateCeilingUsd: 0.5,
    paidAuthorization: false,
    humanGatePending: false,
    availableRefs: new Set<string>(),
    ...overrides,
  };
}

/** Loop-budget/state validation invariant shared by five state fields. */
function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Deterministic selection order: priority ascending, then age (earlier
 * createdAt first; ISO-8601 compares lexicographically), then id ascending.
 * Returns the single top candidate.
 */
function topCandidate(candidates: readonly ImprovementCandidate[]): ImprovementCandidate {
  return [...candidates].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    if (left.createdAt !== right.createdAt) {
      return left.createdAt < right.createdAt ? -1 : 1;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  })[0];
}

function evaluateCandidate(
  candidate: ImprovementCandidate,
  state: ImprovementPolicyState,
  available: ReadonlySet<string>,
): ImprovementDecision {
  if (!Number.isFinite(candidate.estimatedCostUsd) || candidate.estimatedCostUsd <= 0) {
    return { kind: "stop", reason: `candidate ${candidate.id} has no finite positive estimated cost` };
  }
  if (!(IMPROVEMENT_STAGES as readonly string[]).includes(candidate.stage)) {
    return { kind: "stop", reason: `candidate ${candidate.id} targets forbidden stage ${candidate.stage}` };
  }
  const action = candidate.action.trim();
  if ((FORBIDDEN_ACTIONS as readonly string[]).includes(action)) {
    return { kind: "stop", reason: `candidate ${candidate.id} proposes forbidden action ${action}` };
  }
  if (relaxesPolicy(candidate.proposal)) {
    return { kind: "stop", reason: `candidate ${candidate.id} would relax policy` };
  }
  if (candidate.reviewer === candidate.author) {
    return { kind: "stop", reason: `candidate ${candidate.id} is reviewed by its author` };
  }
  if (
    !candidate.lessonIds.some((id) => id.trim().length > 0) &&
    !candidate.evidenceRefs.some((ref) => ref.trim().length > 0)
  ) {
    return { kind: "stop", reason: `candidate ${candidate.id} is not evidence-backed` };
  }
  if (!candidate.reviewer || !candidate.approved) {
    return { kind: "wait", reason: `candidate ${candidate.id} awaits independent approval` };
  }
  if (candidate.requiresPaidWork && !state.paidAuthorization) {
    return { kind: "wait", reason: `candidate ${candidate.id} requires paid work that is not authorized` };
  }
  if (candidate.estimatedCostUsd > state.perCandidateCeilingUsd) {
    return {
      kind: "stop",
      reason: `candidate ${candidate.id} exceeds the per-candidate ceiling (${candidate.estimatedCostUsd} > ${state.perCandidateCeilingUsd} USD)`,
    };
  }
  if (state.spentCostUsd + candidate.estimatedCostUsd > state.maxCostUsd) {
    return {
      kind: "stop",
      reason: `candidate ${candidate.id} would exceed the remaining budget (${state.maxCostUsd - state.spentCostUsd} USD left, ${candidate.estimatedCostUsd} USD requested)`,
    };
  }
  const missing = candidate.dependsOn.find((ref) => !available.has(ref));
  if (missing !== undefined) {
    return { kind: "wait", reason: `candidate ${candidate.id} depends on unavailable ${missing}` };
  }
  return { kind: "start", candidateId: candidate.id, reason: `selected candidate ${candidate.id}` };
}

/**
 * Decide what the recursive improvement loop should do next. Pure and
 * deterministic: no effects, no mutation, no self-authorization. The top
 * candidate (priority, then age, then id) is the only one ever selected;
 * if it cannot start, the loop waits or stops rather than jumping to a
 * lower-priority candidate.
 */
export function decideImprovement(
  candidates: readonly ImprovementCandidate[],
  state: ImprovementPolicyState,
): ImprovementDecision {
  if (!isFiniteNonnegative(state.maxIterations)) {
    return { kind: "stop", reason: "maxIterations must be finite and nonnegative" };
  }
  if (!isFiniteNonnegative(state.iterationsUsed)) {
    return { kind: "stop", reason: "iterationsUsed must be finite and nonnegative" };
  }
  if (!isFiniteNonnegative(state.maxCostUsd)) {
    return { kind: "stop", reason: "maxCostUsd must be finite and nonnegative" };
  }
  if (!isFiniteNonnegative(state.spentCostUsd)) {
    return { kind: "stop", reason: "spentCostUsd must be finite and nonnegative" };
  }
  if (!isFiniteNonnegative(state.perCandidateCeilingUsd)) {
    return { kind: "stop", reason: "perCandidateCeilingUsd must be finite and nonnegative" };
  }
  if (state.iterationsUsed >= state.maxIterations) {
    return {
      kind: "stop",
      reason: `iteration bound reached (${state.iterationsUsed} of ${state.maxIterations})`,
    };
  }
  if (candidates.length === 0) {
    return { kind: "stop", reason: "no improvement candidates" };
  }
  if (state.spentCostUsd >= state.maxCostUsd) {
    return {
      kind: "stop",
      reason: `budget exhausted (${state.spentCostUsd} USD spent of ${state.maxCostUsd} USD)`,
    };
  }
  if (state.humanGatePending) {
    return { kind: "wait", reason: "human gate pending" };
  }
  return evaluateCandidate(topCandidate(candidates), state, new Set(state.availableRefs));
}
