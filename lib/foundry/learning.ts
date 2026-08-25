// Continual-learning core for the multi-agent engineering system.
// Pure policy: harvests terminal-task evidence into proposed lessons, then
// gates promotion on evidence quality, an independent approved review, and
// stable-key deduplication across distinct issues. Nothing here installs a
// skill, prompt, lint rule, gate, or config change; output is always a plain
// serializable record that durable store/event-log wiring can persist later.

import { createHash } from "node:crypto";

/** Learning harvests evidence only from tasks running in the execute stage. */
export const EXECUTE_STAGE = "execute";

export const DEFAULT_LESSON_PROMOTE_THRESHOLD = 3;

const parsedThreshold = Number(process.env.FOUNDRY_LESSON_PROMOTE_THRESHOLD);
export const LESSON_PROMOTE_THRESHOLD =
  Number.isFinite(parsedThreshold) && parsedThreshold >= 1
    ? parsedThreshold
    : DEFAULT_LESSON_PROMOTE_THRESHOLD;

/** Minimum a piece of task evidence must meet before a lesson may be proposed. */
export const LESSON_EVIDENCE_MIN = {
  patternLength: 20,
  minRefs: 1,
} as const;

export type TaskOutcome = "succeeded" | "failed";

export type LessonEvidence = {
  taskId: string;
  issueId: string;
  /** Orchestration runs link to issueId and stage=execute; learning only harvests here. */
  stage: typeof EXECUTE_STAGE;
  outcome: TaskOutcome;
  /** What the task did and the outcome — the recurring pattern. */
  pattern: string;
  /** Supporting refs: event-log span, verifier evidence, artifact ids. */
  refs: string[];
  /** Candidate rule (lint/gate/skill/prompt) that would have caught the failure
   *  or made the success cheaper. Defaults to the pattern when omitted. */
  retentionRule?: string;
  /** The agent that produced the task; used to enforce reviewer independence. */
  author?: string;
};

export type LessonReviewVerdict = "approved" | "rejected";

export type LessonReview = {
  reviewer: string;
  verdict: LessonReviewVerdict;
  note?: string;
};

/** A harvested lesson row. Every field is plain JSON. */
export type LessonRecord = {
  kind: "lesson";
  id: string;
  /** Stable dedup identity derived from the pattern. */
  key: string;
  taskId: string;
  issueId: string;
  stage: typeof EXECUTE_STAGE;
  outcome: TaskOutcome;
  pattern: string;
  retentionRule: string;
  refs: string[];
  author: string | null;
  proposedAt: string;
};

/** An operator-approved promotion row. Every field is plain JSON. */
export type PromotionRecord = {
  kind: "promotion";
  id: string;
  key: string;
  lessonId: string;
  issueId: string;
  reviewer: string;
  approvedAt: string;
};

/** A plain serializable row in the learning store. */
export type LearningRecord = LessonRecord | PromotionRecord;

/** Durable wiring (SQLite via store.ts, events via appendEvent) implements
 *  this seam later; the core never touches storage directly. */
export type LearningStoreAdapter = {
  load: () => readonly LearningRecord[];
  append: (record: LearningRecord) => void;
};

export type PromotionOptions = {
  /** Recurrences across distinct issues required (default FOUNDRY_LESSON_PROMOTE_THRESHOLD). */
  threshold?: number;
  /** Explicit operator promotion: skips the recurrence threshold, never the review. */
  operatorApproved?: boolean;
  /** Injectable clock for deterministic replay. */
  now?: () => string;
};

/** One audit event per newly persisted learning record; durable wiring (e.g.
 *  appendEvent) is injected by the caller so the pure core never touches I/O. */
export type LearningAuditEvent =
  | { kind: "lesson.harvested"; issueId: string; record: LessonRecord }
  | { kind: "lesson.promoted"; issueId: string; record: PromotionRecord };

export type LearningOptions = PromotionOptions & {
  /** Fired exactly once per record actually appended; replay of an existing
   *  id emits nothing. */
  onAudit?: (event: LearningAuditEvent) => void;
};

export type HarvestResult =
  | { ok: true; lesson: LessonRecord }
  | { ok: false; reason: string };

export type PromotionResult =
  | { ok: true; promotion: PromotionRecord }
  | { ok: false; reason: string };

/**
 * Stable, deterministic lesson key: identical patterns (up to whitespace)
 * collapse to one key; different patterns diverge. Keys are the dedup identity.
 */
export function stableLessonKey(pattern: string): string {
  const normalized = pattern.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 32);
}

// Anti-reward-hacking: a lesson that would relax a gate or budget is rejected
// by default (spec §22.3). Matching is deliberately conservative — rejection
// is the safe outcome.
const POLICY_RELAXATION_MARKERS = [
  "relax",
  "raise the budget",
  "raise budget",
  "increase the budget",
  "increase budget",
  "raise the ceiling",
  "increase the ceiling",
  "remove the cap",
  "drop the ceiling",
  "lower the gate",
  "lower the bar",
  "skip the gate",
  "skip review",
  "bypass the gate",
  "bypass the review",
  "bypass verification",
  "disable the gate",
  "disable the check",
  "turn off the gate",
  "ignore the gate",
  "no review required",
  "allow unverified",
  "allow auto-merge",
  "auto-merge without review",
];

export function relaxesPolicy(rule: string): boolean {
  const haystack = rule.toLowerCase();
  return POLICY_RELAXATION_MARKERS.some((marker) => haystack.includes(marker));
}

/**
 * Harvest: validates task evidence and produces a proposed lesson. Weak or
 * hollow evidence (below the minimum, or a failed task with no salvageable
 * signal) is rejected; a concrete terminal-failure lesson still passes.
 */
export function harvestLesson(
  evidence: LessonEvidence,
  options: { now?: () => string } = {},
): HarvestResult {
  const taskId = (evidence.taskId ?? "").trim();
  const issueId = (evidence.issueId ?? "").trim();
  if (!taskId || !issueId) return { ok: false, reason: "Evidence is missing a task or issue id" };
  if (evidence.stage !== EXECUTE_STAGE) {
    return { ok: false, reason: `Learning harvests only ${EXECUTE_STAGE}-stage tasks` };
  }
  if (evidence.outcome !== "succeeded" && evidence.outcome !== "failed") {
    return { ok: false, reason: "Task outcome is not terminal" };
  }
  const pattern = (evidence.pattern ?? "").trim();
  if (pattern.length < LESSON_EVIDENCE_MIN.patternLength) {
    return { ok: false, reason: "Evidence pattern is too weak to learn from" };
  }
  const refs = (evidence.refs ?? [])
    .map((ref) => (typeof ref === "string" ? ref.trim() : ""))
    .filter(Boolean);
  if (refs.length < LESSON_EVIDENCE_MIN.minRefs) {
    return { ok: false, reason: "Evidence needs at least one supporting ref" };
  }
  const retentionRule = (evidence.retentionRule ?? pattern).trim();
  if (!retentionRule) return { ok: false, reason: "Lesson has no retention rule" };
  const author = (evidence.author ?? "").trim();
  const lesson: LessonRecord = {
    kind: "lesson",
    id: `lesson:${taskId}`,
    key: stableLessonKey(pattern),
    taskId,
    issueId,
    stage: evidence.stage,
    outcome: evidence.outcome,
    pattern,
    retentionRule,
    refs,
    author: author || null,
    proposedAt: options.now?.() ?? new Date().toISOString(),
  };
  return { ok: true, lesson };
}

/**
 * Promotion: returns an approved promotion record only when the harvested
 * lesson identifies its author, carries evidence, an independent reviewer
 * approved it, it would not relax a gate or budget, its stable key is not
 * already promoted, and it has recurred across enough distinct issues (or the
 * operator promoted it explicitly). Never installs anything; the caller decides
 * what to do with the record. Automated approval (approval-policy.ts) composes
 * this gate: it synthesizes an independent review and passes operatorApproved,
 * so these guarantees are re-enforced, never bypassed.
 */
export function evaluatePromotion(
  lesson: LessonRecord,
  review: LessonReview,
  prior: readonly LearningRecord[],
  options: PromotionOptions = {},
): PromotionResult {
  if (lesson.kind !== "lesson" || !lesson.key || lesson.refs.length === 0) {
    return { ok: false, reason: "Not a harvested lesson with supporting evidence" };
  }
  // The author is required at the promotion boundary: without a recorded
  // author the reviewer-independence property cannot be checked, so a lesson
  // harvested without one (EvidenceInput author is optional for collection)
  // fails closed and can never be promoted, even by explicit operator approval.
  const author = (lesson.author ?? "").trim();
  if (!author) {
    return { ok: false, reason: "Lesson has no identifiable author" };
  }
  if (!review || review.verdict !== "approved") {
    return { ok: false, reason: "Independent review did not approve the lesson" };
  }
  const reviewer = (review.reviewer ?? "").trim();
  if (!reviewer) return { ok: false, reason: "Reviewer is not identified" };
  if (reviewer === author) {
    return { ok: false, reason: "Reviewer must be independent of the task author" };
  }
  if (relaxesPolicy(lesson.retentionRule)) {
    return { ok: false, reason: "Lesson would relax a gate or budget and is rejected by default" };
  }
  if (prior.some((record) => record.kind === "promotion" && record.key === lesson.key)) {
    return { ok: false, reason: `Lesson key ${lesson.key} is already promoted` };
  }
  const threshold = options.threshold ?? LESSON_PROMOTE_THRESHOLD;
  const issues = new Set<string>([lesson.issueId]);
  for (const record of prior) {
    if (record.kind === "lesson" && record.key === lesson.key) issues.add(record.issueId);
  }
  if (!options.operatorApproved && issues.size < threshold) {
    return {
      ok: false,
      reason: `Lesson recurs across ${issues.size} distinct issues (threshold ${threshold})`,
    };
  }
  return {
    ok: true,
    promotion: {
      kind: "promotion",
      id: `promotion:${lesson.id}`,
      key: lesson.key,
      lessonId: lesson.id,
      issueId: lesson.issueId,
      reviewer,
      approvedAt: options.now?.() ?? new Date().toISOString(),
    },
  };
}

/**
 * Replay-safe wrapper over a store adapter. Harvesting the same task twice or
 * promoting the same lesson twice is a no-op against the store, so re-running
 * an event sequence converges to the same records.
 */
export class LearningLedger {
  constructor(
    private readonly store: LearningStoreAdapter,
    private readonly options: LearningOptions = {},
  ) {}

  harvest(evidence: LessonEvidence): HarvestResult {
    const result = harvestLesson(evidence, { now: this.options.now });
    if (!result.ok) return result;
    const existing = this.store
      .load()
      .find((record): record is LessonRecord => record.kind === "lesson" && record.id === result.lesson.id);
    if (existing) return { ok: true, lesson: existing };
    this.store.append(result.lesson);
    this.options.onAudit?.({ kind: "lesson.harvested", issueId: result.lesson.issueId, record: result.lesson });
    return result;
  }

  promote(lessonId: string, review: LessonReview): PromotionResult {
    const records = this.store.load();
    const lesson = records.find(
      (record): record is LessonRecord => record.kind === "lesson" && record.id === lessonId,
    );
    if (!lesson) return { ok: false, reason: `No harvested lesson for ${lessonId}` };
    const existing = records.find(
      (record): record is PromotionRecord => record.kind === "promotion" && record.lessonId === lessonId,
    );
    if (existing) return { ok: true, promotion: existing };
    const result = evaluatePromotion(lesson, review, records, this.options);
    if (!result.ok) return result;
    this.store.append(result.promotion);
    this.options.onAudit?.({ kind: "lesson.promoted", issueId: result.promotion.issueId, record: result.promotion });
    return result;
  }

  records(): readonly LearningRecord[] {
    return this.store.load();
  }
}
