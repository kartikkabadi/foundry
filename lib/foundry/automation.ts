/**
 * Autonomous policy driver for the multi-agent engineering system.
 *
 * Composes the two existing pure decision layers — the unattended issue
 * selector (`selectUnattended`) and the recursive improvement policy
 * (`decideImprovement`) — into one deterministic, bounded plan. Every input
 * is injected; identical input always yields identical output, and inputs are
 * never mutated.
 *
 * The plan returns decisions only: selected issue ids, per-issue exclusions,
 * the single improvement decision, and ordered action intents the caller may
 * apply. It never answers a gate, never mutates state, never invokes a
 * worker, never relaxes policy, and never proposes merge, cleanup, publish,
 * deploy, or self-approval. The caller owns every effect and every human
 * authorization.
 */

import {
  decideImprovement,
  type ImprovementCandidate,
  type ImprovementDecision,
  type ImprovementPolicyState,
} from "./improvement-loop";
import {
  selectUnattended,
  type UnattendedExclusion,
  type UnattendedExclusionReason,
  type UnattendedSnapshot,
} from "./unattended";

/** Exclusion reasons that may clear later; the plan waits rather than stops. */
const WAIT_EXCLUSION_REASONS: Partial<Record<UnattendedExclusionReason, true>> = {
  "pending-human-gate": true,
  "walk-held": true,
  "grill-held": true,
  "unresolved-dependencies": true,
};

/** One action the caller may take from the plan; a decision, never an effect. */
export type AutomationIntent =
  | { kind: "start-issue"; issueId: string }
  | { kind: "start-improvement"; candidateId: string }
  | { kind: "wait"; reason: string }
  | { kind: "stop"; reason: string };

/** Everything the driver needs to know; all state is injected, never read. */
export type AutomationInput = {
  /** Candidate issues with derived runtime booleans. */
  snapshots: UnattendedSnapshot[];
  /** Issue selection limit; hard-capped at UNATTENDED_LIMIT_CAP (20). */
  unattendedLimit: number;
  /** Evidence-backed recursive-improvement candidates. */
  candidates: ImprovementCandidate[];
  /** Loop budget, approval, and gate state. */
  policy: ImprovementPolicyState;
};

/** The composed plan: decisions only, no effects. */
export type AutomationPlan = {
  /** Selected issue ids, oldest-first then by id, at most 20. */
  selected: string[];
  /** One reason per excluded issue, in the same deterministic order. */
  exclusions: UnattendedExclusion[];
  /** The single recursive-improvement decision. */
  improvement: ImprovementDecision;
  /** Ordered action intents: start-issue, then start-improvement, then a
   *  single wait/stop when nothing is startable. */
  intents: AutomationIntent[];
};

/** The single terminal intent when nothing is startable: wait on whatever
 *  blocks work, otherwise stop. */
function terminalIntentFor(
  improvement: ImprovementDecision,
  exclusions: UnattendedExclusion[],
): AutomationIntent {
  if (improvement.kind === "wait") {
    return { kind: "wait", reason: improvement.reason };
  }
  const blocked = exclusions.find((exclusion) => WAIT_EXCLUSION_REASONS[exclusion.reason] === true);
  if (blocked !== undefined) {
    return { kind: "wait", reason: `waiting on issue ${blocked.issueId} (${blocked.reason})` };
  }
  return { kind: "stop", reason: improvement.reason };
}

/**
 * Build the bounded automation plan for one driver pass.
 *
 * Issue selection is delegated to `selectUnattended` (bounded, oldest-first,
 * inputs never mutated) and the improvement decision to `decideImprovement`
 * (pure, never self-authorizing). Intents are derived in a fixed order: one
 * `start-issue` per selected id, then one `start-improvement` when the loop
 * starts a candidate. When nothing is startable the plan carries exactly one
 * terminal intent: `wait` when the improvement loop is blocked or an issue is
 * held behind a gate, walk/grill hold, or unresolved dependency, otherwise
 * `stop`. A blocked improvement never suppresses startable issue work.
 */
export function planAutomation(input: AutomationInput): AutomationPlan {
  const selection = selectUnattended(input.snapshots, input.unattendedLimit);
  const improvement = decideImprovement(input.candidates, input.policy);

  const intents: AutomationIntent[] = [];
  for (const issueId of selection.selected) {
    intents.push({ kind: "start-issue", issueId });
  }
  if (improvement.kind === "start") {
    intents.push({ kind: "start-improvement", candidateId: improvement.candidateId });
  }
  if (intents.length === 0) {
    intents.push(terminalIntentFor(improvement, selection.exclusions));
  }

  return {
    selected: selection.selected,
    exclusions: selection.exclusions,
    improvement,
    intents,
  };
}
