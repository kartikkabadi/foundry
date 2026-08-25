// Execute-stage learning adapter: harvests terminal execute evidence into the
// shared LearningLedger and returns the promotion decision. This module is a
// thin, explicit seam — it never writes prompts, source, config, skills,
// gates, or deployment state; output is a plain decision plus the store's
// records. Durable wiring (createLearningStore from store.ts, appendEvent from
// log.ts) is injected by the caller:
//
//   new ExecuteLearning(createLearningStore(), {
//     onAudit: (event) => appendEvent(event.issueId, event.kind, {
//       id: event.record.id,
//       key: event.record.key,
//     }),
//   })
//
// The store adapter makes every operation replay-safe: re-submitting the same
// run converges to the same records and emits no duplicate audit events.

import {
  EXECUTE_STAGE,
  LearningLedger,
  LESSON_PROMOTE_THRESHOLD,
  type HarvestResult,
  type LearningAuditEvent,
  type LearningRecord,
  type LearningStoreAdapter,
  type LessonEvidence,
  type LessonReview,
  type PromotionResult,
  type TaskOutcome,
} from "./learning";

/** One terminal execute run and the evidence it produced. */
export type ExecuteRunEvidence = {
  issueId: string;
  /** The task being executed; drives the durable lesson id. */
  taskId: string;
  /** The specific run/attempt; recorded as the first evidence ref. */
  runId: string;
  outcome: TaskOutcome;
  /** The recurring behavior the task revealed, described concretely. */
  pattern: string;
  /** Event-log span, verifier evidence, and artifact ids. */
  refs: string[];
  /** Candidate rule that would have caught the failure or made the success cheaper. */
  retentionRule?: string;
  /** Agent that produced the task; used to enforce reviewer independence. */
  author?: string;
};

/** Everything the adapter needs to make one harvest-and-promotion decision. */
export type ExecuteLearningInput = {
  evidence: ExecuteRunEvidence;
  /** Explicit independent reviewer decision; promotion never happens without approval. */
  review: LessonReview;
  /** Explicit operator approval; per policy it may skip recurrence, never the review. */
  operatorApproved: boolean;
  /** Injectable clock for deterministic replay. */
  now?: () => string;
};

export type ExecuteLearningOptions = {
  /** Distinct-issue recurrence required before promotion (default LESSON_PROMOTE_THRESHOLD). */
  threshold?: number;
  /** Fired exactly once per record actually appended; replay emits nothing. */
  onAudit?: (event: LearningAuditEvent) => void;
};

export type ExecuteLearningResult = {
  harvest: HarvestResult;
  promotion: PromotionResult;
  records: readonly LearningRecord[];
};

/** A finalized terminal execute outcome, ready for learning evidence. */
export type ExecuteFinalizeEvidence = {
  issueId: string;
  taskId: string;
  runId: string;
  outcome: TaskOutcome;
  error: string | null;
  evidence: readonly string[];
};

/**
 * Maps a finalized terminal execute outcome onto run evidence. Verifier/event
 * refs are preserved when present; an empty evidence list falls back to the
 * issue ref so the evidence minimum is still met. The run reference itself is
 * prepended by the shared canonicalization (`toLessonEvidence`), never here.
 */
export function executeLearningEvidence(
  finalize: ExecuteFinalizeEvidence,
  options: { pattern: string; author?: string },
): ExecuteRunEvidence {
  return {
    issueId: finalize.issueId,
    taskId: finalize.taskId,
    runId: finalize.runId,
    outcome: finalize.outcome,
    pattern: options.pattern,
    refs: finalize.evidence.length > 0 ? [...finalize.evidence] : [`issue/${finalize.issueId}`],
    author: options.author,
  };
}

/**
 * Optional explicit runtime learning policy. When an orchestration runtime
 * carries one, the finalize path submits the terminal execute evidence to the
 * shared learning adapter exactly once per run. The policy never installs
 * rules or mutates source/config/prompts — it only shapes the learning
 * decision (pattern, author, reviewer, operator approval) and the durable
 * wiring (store, audit callback, threshold, clock).
 */
export type ExecuteLearningPolicy = {
  /** Recurring behavior the execute run revealed; drives the lesson pattern and key. */
  pattern: string;
  /** Agent that produced the task; enforces reviewer independence. */
  author?: string;
  /** Explicit independent reviewer decision; promotion never happens without approval. */
  review: LessonReview;
  /** Explicit operator approval; may skip the recurrence threshold, never the review. */
  operatorApproved: boolean;
  /** Durable learning store; defaults to the shared SQLite adapter (createLearningStore). */
  store?: LearningStoreAdapter;
  /** Audit callback per appended record; defaults to routing through the runtime appendEvent. */
  onAudit?: (event: LearningAuditEvent) => void;
  /** Distinct-issue recurrence required before promotion (default LESSON_PROMOTE_THRESHOLD). */
  threshold?: number;
  /** Injectable clock for deterministic replay; defaults to the runtime clock. */
  now?: () => string;
};

/**
 * Replay-safe execute-learning adapter over the shared LearningLedger. A
 * submit() call harvests the run's terminal evidence, then — only with an
 * explicit approved independent review — attempts promotion. Self-review,
 * policy relaxation, and weak evidence stay rejected by the existing policy.
 */
export class ExecuteLearning {
  constructor(
    private readonly store: LearningStoreAdapter,
    private readonly options: ExecuteLearningOptions = {},
  ) {}

  submit(input: ExecuteLearningInput): ExecuteLearningResult {
    const ledger = new LearningLedger(this.store, {
      threshold: this.options.threshold ?? LESSON_PROMOTE_THRESHOLD,
      now: input.now,
      operatorApproved: input.operatorApproved,
      onAudit: this.options.onAudit,
    });

    const harvest = ledger.harvest(toLessonEvidence(input.evidence));
    if (!harvest.ok) {
      return {
        harvest,
        promotion: { ok: false, reason: "Evidence rejected; no promotion attempted" },
        records: this.store.load(),
      };
    }

    if (input.review.verdict !== "approved") {
      return {
        harvest,
        promotion: { ok: false, reason: "Independent review did not approve the lesson" },
        records: this.store.load(),
      };
    }

    const promotion = ledger.promote(harvest.lesson.id, input.review);
    return { harvest, promotion, records: this.store.load() };
  }
}

/** Maps a run's evidence onto the shared LessonEvidence shape, recording the
 *  run reference when explicit evidence exists so the run is part of the span. */
function toLessonEvidence(evidence: ExecuteRunEvidence): LessonEvidence {
  const runRef = evidence.runId.trim();
  // The run reference is supplementary context, never a substitute for the
  // caller's explicit evidence refs — empty refs must stay empty so the
  // evidence minimum still rejects the lesson. The refs array is always cloned
  // so the LessonEvidence never aliases the caller's ExecuteRunEvidence.
  const refs =
    runRef && evidence.refs.length > 0
      ? [`run/${runRef}`, ...evidence.refs]
      : [...evidence.refs];
  return {
    taskId: evidence.taskId,
    issueId: evidence.issueId,
    stage: EXECUTE_STAGE,
    outcome: evidence.outcome,
    pattern: evidence.pattern,
    refs,
    retentionRule: evidence.retentionRule,
    author: evidence.author,
  };
}
