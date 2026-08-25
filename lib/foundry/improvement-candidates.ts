// Improvement-candidate adapter for the multi-agent engineering system.
// Pure deterministic derivation: turns promoted learning records plus
// explicit operator proposal metadata into the evidence-backed
// ImprovementCandidate rows the recursive improvement policy consumes.
//
// A candidate is derived only when the proposal is linked to a promotion
// that itself links to a stored, authored, evidence-backed lesson that the
// promotion is consistent with (matching lesson id and stable key), the
// proposal's reviewer is identified, distinct from the lesson's author, and
// exactly the reviewer who approved the promotion, every proposal evidence
// ref is covered by the lesson's authoritative refs, the target stage/action
// are allowed, and the estimated cost is finite and positive. Approval is
// never inferred: the proposal must state it explicitly, and nothing here
// ever flips it to true. The function never mutates its inputs, never returns
// a mutable alias of an input array, and never performs effects; output is
// always a plain serializable derivation record.

import {
  FORBIDDEN_ACTIONS,
  IMPROVEMENT_STAGES,
  type ImprovementCandidate,
  type ImprovementStage,
} from "./improvement-loop";
import type { LearningRecord, LessonRecord, PromotionRecord } from "./learning";

/** Default candidate priority when a proposal omits one (lower wins). */
export const DEFAULT_CANDIDATE_PRIORITY = 10;

/** Explicit operator proposal metadata: the policy fields the operator owns.
 *  The linked promotion and its lesson supply the evidence, author, and
 *  aging timestamp; nothing here is guessed. */
export type ImprovementProposal = {
  /** Stable candidate id; the derivation identity for dedupe and ordering. */
  id: string;
  /** Id of the promotion record this proposal endorses. The promotion must
   *  exist and link to a stored lesson. */
  promotionId: string;
  /** Lower number = higher priority. Defaults to 10 when omitted. */
  priority?: number;
  /** ISO-8601 creation time; defaults to the promotion's approvedAt. */
  createdAt?: string;
  /** Target stage; must be one of IMPROVEMENT_STAGES. Validated here. */
  stage: string;
  /** Proposed action; must not be a FORBIDDEN_ACTIONS. Validated here. */
  action: string;
  /** Human-readable proposal; defaults to the lesson's retention rule. */
  proposal?: string;
  /** Extra evidence refs merged after the lesson's own refs. */
  evidenceRefs?: string[];
  /** Ids that must be available before the candidate can start. */
  dependsOn?: string[];
  /** Independent reviewer; must be identified and distinct from the lesson
   *  author. */
  reviewer: string;
  /** Explicit approval. Never inferred: the adapter copies this verbatim. */
  approved: boolean;
  /** Estimated USD cost; must be finite and positive. */
  estimatedCostUsd: number;
  /** True when this work requires a paid model or host. */
  requiresPaidWork?: boolean;
};

/** Why a proposal did not yield a candidate. */
export type CandidateExclusionReason =
  | "unidentified-proposal"
  | "unpromoted-lesson"
  | "orphan-promotion"
  | "authorless-lesson"
  | "inconsistent-promotion"
  | "unbacked-promotion"
  | "unidentified-reviewer"
  | "reviewer-mismatch"
  | "self-review"
  | "disallowed-stage"
  | "forbidden-action"
  | "non-finite-cost"
  | "forged-evidence"
  | "duplicate-candidate";

/** One excluded proposal and the single reason it was dropped. */
export type CandidateExclusion = {
  proposalId: string;
  reason: CandidateExclusionReason;
};

/** The pure derivation result: candidates plus one reason per exclusion. */
export type ImprovementCandidateDerivation = {
  /** Derived candidates in canonical order: priority, then age, then id. */
  candidates: ImprovementCandidate[];
  /** One exclusion per proposal that did not yield a candidate. */
  exclusions: CandidateExclusion[];
};

type ResolvedProposal = {
  proposalId: string;
  priority: number;
  createdAt: string;
  candidate?: ImprovementCandidate;
  exclusion?: CandidateExclusionReason;
};

/** Resolve one proposal to a candidate or a single exclusion reason. */
function resolveProposal(
  proposal: ImprovementProposal,
  lessons: ReadonlyMap<string, LessonRecord>,
  promotions: ReadonlyMap<string, PromotionRecord>,
): ResolvedProposal {
  const id = (proposal.id ?? "").trim();
  const priority = proposal.priority ?? DEFAULT_CANDIDATE_PRIORITY;
  if (!id) {
    return { proposalId: id, priority, createdAt: proposal.createdAt ?? "", exclusion: "unidentified-proposal" };
  }
  const promotion = promotions.get(proposal.promotionId);
  if (!promotion) {
    return { proposalId: id, priority, createdAt: proposal.createdAt ?? "", exclusion: "unpromoted-lesson" };
  }
  const lesson = lessons.get(promotion.lessonId);
  if (!lesson) {
    return { proposalId: id, priority, createdAt: proposal.createdAt ?? "", exclusion: "orphan-promotion" };
  }
  const createdAt = proposal.createdAt ?? promotion.approvedAt;
  const reviewer = (proposal.reviewer ?? "").trim();

  let exclusion: CandidateExclusionReason | undefined;
  if (!lesson.author) {
    exclusion = "authorless-lesson";
  } else if (promotion.lessonId !== lesson.id || promotion.key !== lesson.key) {
    exclusion = "inconsistent-promotion";
  } else if (lesson.refs.length === 0) {
    exclusion = "unbacked-promotion";
  } else if (!reviewer) {
    exclusion = "unidentified-reviewer";
  } else if (reviewer === lesson.author) {
    exclusion = "self-review";
  } else if (reviewer !== (promotion.reviewer ?? "").trim()) {
    exclusion = "reviewer-mismatch";
  } else if (!(IMPROVEMENT_STAGES as readonly string[]).includes(proposal.stage)) {
    exclusion = "disallowed-stage";
  } else if ((FORBIDDEN_ACTIONS as readonly string[]).includes((proposal.action ?? "").trim())) {
    exclusion = "forbidden-action";
  } else if (!Number.isFinite(proposal.estimatedCostUsd) || proposal.estimatedCostUsd <= 0) {
    exclusion = "non-finite-cost";
  } else if ((proposal.evidenceRefs ?? []).some((ref) => !lesson.refs.includes(ref))) {
    exclusion = "forged-evidence";
  }
  if (exclusion) {
    return { proposalId: id, priority, createdAt, exclusion };
  }

  return {
    proposalId: id,
    priority,
    createdAt,
    candidate: {
      id,
      priority,
      createdAt,
      stage: proposal.stage as ImprovementStage,
      action: proposal.action,
      proposal: (proposal.proposal ?? "").trim() || lesson.retentionRule,
      lessonIds: [lesson.id],
      // Every proposal ref is covered by lesson.refs, so the union is
      // lesson.refs plus covered duplicates; dedupe keeps it canonical and
      // the spread guarantees no aliasing back into either input array.
      evidenceRefs: [...new Set([...lesson.refs, ...(proposal.evidenceRefs ?? [])])],
      dependsOn: [...(proposal.dependsOn ?? [])],
      author: lesson.author ?? "",
      reviewer,
      approved: proposal.approved,
      estimatedCostUsd: proposal.estimatedCostUsd,
      requiresPaidWork: proposal.requiresPaidWork ?? false,
    },
  };
}

/**
 * Derive improvement candidates from promoted learning records plus explicit
 * proposal metadata. Pure and deterministic: identical inputs yield identical
 * output, inputs are never mutated, no returned array aliases an input array,
 * and no approval is inferred.
 *
 * Proposals are processed in canonical order (priority ascending, then
 * createdAt ascending, then id ascending) so the ordering and the dedupe
 * winner are independent of input order. A proposal whose id collides with an
 * already-derived candidate is surfaced as a duplicate-candidate exclusion.
 */
export function deriveImprovementCandidates(
  records: readonly LearningRecord[],
  proposals: readonly ImprovementProposal[],
): ImprovementCandidateDerivation {
  const lessons = new Map<string, LessonRecord>();
  const promotions = new Map<string, PromotionRecord>();
  for (const record of records) {
    if (record.kind === "lesson") lessons.set(record.id, record);
    else if (record.kind === "promotion") promotions.set(record.id, record);
  }

  const resolved = proposals.map((proposal) => resolveProposal(proposal, lessons, promotions));
  resolved.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
    return left.proposalId < right.proposalId ? -1 : left.proposalId > right.proposalId ? 1 : 0;
  });

  const candidates: ImprovementCandidate[] = [];
  const exclusions: CandidateExclusion[] = [];
  const seen = new Set<string>();
  for (const slot of resolved) {
    if (slot.candidate !== undefined) {
      if (seen.has(slot.candidate.id)) {
        exclusions.push({ proposalId: slot.candidate.id, reason: "duplicate-candidate" });
        continue;
      }
      seen.add(slot.candidate.id);
      candidates.push(slot.candidate);
    } else if (slot.exclusion !== undefined) {
      exclusions.push({ proposalId: slot.proposalId, reason: slot.exclusion });
    }
  }
  return { candidates, exclusions };
}
