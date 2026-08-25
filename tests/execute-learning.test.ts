import { describe, expect, it } from "vitest";
import {
  ExecuteLearning,
  executeLearningEvidence,
  type ExecuteLearningInput,
  type ExecuteLearningOptions,
  type ExecuteRunEvidence,
} from "../lib/foundry/execute-learning";
import {
  stableLessonKey,
  type LearningAuditEvent,
  type LearningRecord,
  type LearningStoreAdapter,
  type LessonRecord,
  type LessonReview,
  type PromotionRecord,
} from "../lib/foundry/learning";

const NOW = () => "2026-08-25T00:00:00.000Z";

const STRONG_PATTERN =
  "Always verify that a released change passes the package tests before merge";

function evidence(overrides: Partial<ExecuteRunEvidence> = {}): ExecuteRunEvidence {
  return {
    issueId: "issue-1",
    taskId: "task-1",
    runId: "run-abc",
    outcome: "succeeded",
    pattern: STRONG_PATTERN,
    refs: ["evidence:verified"],
    author: "agent-a",
    ...overrides,
  };
}

function approvedReview(reviewer = "agent-b"): LessonReview {
  return { reviewer, verdict: "approved" };
}

function input(overrides: Partial<ExecuteLearningInput> = {}): ExecuteLearningInput {
  return {
    evidence: evidence(),
    review: approvedReview(),
    operatorApproved: false,
    now: NOW,
    ...overrides,
  };
}

function memoryStore(): { store: LearningStoreAdapter; rows: LearningRecord[] } {
  const rows: LearningRecord[] = [];
  return {
    rows,
    store: {
      load: () => rows,
      append: (record) => {
        rows.push(record);
      },
    },
  };
}

function makeAdapter(options: ExecuteLearningOptions = {}) {
  const { store, rows } = memoryStore();
  const adapter = new ExecuteLearning(store, options);
  return { adapter, store, rows };
}

describe("ExecuteLearning — harvest", () => {
  it("harvests strong terminal execute evidence into the store", () => {
    const { adapter, rows } = makeAdapter();
    const result = adapter.submit(input());
    expect(result.harvest.ok).toBe(true);
    if (!result.harvest.ok) return;
    const lesson = result.harvest.lesson;
    expect(lesson.kind).toBe("lesson");
    expect(lesson.id).toBe("lesson:task-1");
    expect(lesson.key).toBe(stableLessonKey(STRONG_PATTERN));
    expect(lesson.taskId).toBe("task-1");
    expect(lesson.issueId).toBe("issue-1");
    expect(lesson.stage).toBe("execute");
    expect(lesson.outcome).toBe("succeeded");
    expect(lesson.pattern).toBe(STRONG_PATTERN);
    expect(lesson.author).toBe("agent-a");
    expect(lesson.proposedAt).toBe(NOW());
    expect(rows).toEqual([lesson]);
    expect(result.records).toEqual([lesson]);
  });

  it("records the run reference as the first evidence ref", () => {
    const { adapter } = makeAdapter();
    const result = adapter.submit(input());
    expect(result.harvest.ok).toBe(true);
    if (!result.harvest.ok) return;
    expect(result.harvest.lesson.refs).toEqual(["run/run-abc", "evidence:verified"]);
  });

  it("clones the caller's refs instead of aliasing them into stored or returned records", () => {
    const { adapter, rows } = makeAdapter();
    const callerRefs = ["evidence:verified"];
    const result = adapter.submit(input({ evidence: evidence({ refs: callerRefs }) }));
    expect(result.harvest.ok).toBe(true);
    if (!result.harvest.ok) return;
    const stored = rows.find((row): row is LessonRecord => row.kind === "lesson");
    expect(stored).toBeDefined();
    expect(result.harvest.lesson.refs).not.toBe(callerRefs);
    expect(stored?.refs).not.toBe(callerRefs);
    callerRefs.push("poisoned");
    expect(result.harvest.lesson.refs).toEqual(["run/run-abc", "evidence:verified"]);
    expect(stored?.refs).toEqual(["run/run-abc", "evidence:verified"]);
  });

  it("still clones refs when the run reference is absent", () => {
    const { adapter } = makeAdapter();
    const callerRefs = ["evidence:verified"];
    const result = adapter.submit(input({ evidence: evidence({ runId: "", refs: callerRefs }) }));
    expect(result.harvest.ok).toBe(true);
    if (!result.harvest.ok) return;
    expect(result.harvest.lesson.refs).toEqual(["evidence:verified"]);
    expect(result.harvest.lesson.refs).not.toBe(callerRefs);
    callerRefs.push("poisoned");
    expect(result.harvest.lesson.refs).toEqual(["evidence:verified"]);
  });

  it("rejects insufficient evidence without appending a row", () => {
    const { adapter, rows } = makeAdapter();
    const weakPattern = adapter.submit(input({ evidence: evidence({ pattern: "It failed" }) }));
    expect(weakPattern.harvest.ok).toBe(false);
    const noRefs = adapter.submit(input({ evidence: evidence({ refs: [] }) }));
    expect(noRefs.harvest.ok).toBe(false);
    expect(rows).toEqual([]);
  });

  it("rejects evidence missing a task or issue id", () => {
    const { adapter, rows } = makeAdapter();
    expect(adapter.submit(input({ evidence: evidence({ taskId: "  " }) })).harvest.ok).toBe(false);
    expect(adapter.submit(input({ evidence: evidence({ issueId: "" }) })).harvest.ok).toBe(false);
    expect(rows).toEqual([]);
  });

  it("rejects hollow failed evidence but harvests concrete failed evidence", () => {
    const { adapter, rows } = makeAdapter();
    const hollow = adapter.submit(input({ evidence: evidence({ outcome: "failed", pattern: "The task failed" }) }));
    expect(hollow.harvest.ok).toBe(false);
    expect(rows).toEqual([]);

    const concrete = adapter.submit(
      input({
        evidence: evidence({
          outcome: "failed",
          pattern: "Deploying without running the schema migration test first caused a runtime outage",
          refs: ["evidence:reproduced"],
        }),
      }),
    );
    expect(concrete.harvest.ok).toBe(true);
    if (!concrete.harvest.ok) return;
    expect(concrete.harvest.lesson.outcome).toBe("failed");
    expect(rows).toHaveLength(1);
  });
});

describe("ExecuteLearning — promotion gates", () => {
  it("never promotes without an approved independent review", () => {
    const { adapter, rows } = makeAdapter();
    const result = adapter.submit(input({ review: { reviewer: "agent-b", verdict: "rejected" } }));
    expect(result.harvest.ok).toBe(true);
    expect(result.promotion.ok).toBe(false);
    if (!result.promotion.ok) expect(result.promotion.reason).toMatch(/review/i);
    expect(rows.filter((row) => row.kind === "promotion")).toHaveLength(0);
  });

  it("rejects self-review even with operator approval", () => {
    const { adapter, rows } = makeAdapter();
    const result = adapter.submit(input({ review: approvedReview("agent-a"), operatorApproved: true }));
    expect(result.harvest.ok).toBe(true);
    expect(result.promotion.ok).toBe(false);
    if (!result.promotion.ok) expect(result.promotion.reason).toMatch(/independent/i);
    expect(rows.filter((row) => row.kind === "promotion")).toHaveLength(0);
  });

  it("rejects promotion of a lesson harvested without an author, even with operator approval", () => {
    const { adapter, rows } = makeAdapter();
    const result = adapter.submit(
      input({ evidence: evidence({ author: undefined }), operatorApproved: true }),
    );
    expect(result.harvest.ok).toBe(true);
    if (!result.harvest.ok) return;
    expect(result.harvest.lesson.author).toBeNull();
    expect(result.promotion.ok).toBe(false);
    if (!result.promotion.ok) expect(result.promotion.reason).toMatch(/author/i);
    expect(rows.filter((row) => row.kind === "promotion")).toHaveLength(0);
  });

  it("rejects policy-relaxing lessons even with operator approval", () => {
    const { adapter, rows } = makeAdapter();
    const result = adapter.submit(
      input({
        evidence: evidence({ retentionRule: "Skip the gate when the change is small to speed up delivery" }),
        operatorApproved: true,
      }),
    );
    expect(result.harvest.ok).toBe(true);
    expect(result.promotion.ok).toBe(false);
    if (!result.promotion.ok) expect(result.promotion.reason).toMatch(/relax/i);
    expect(rows.filter((row) => row.kind === "promotion")).toHaveLength(0);
  });

  it("enforces the recurrence requirement when the operator has not approved", () => {
    const { adapter, rows } = makeAdapter();
    const result = adapter.submit(input({ operatorApproved: false }));
    expect(result.harvest.ok).toBe(true);
    expect(result.promotion.ok).toBe(false);
    if (!result.promotion.ok) expect(result.promotion.reason).toMatch(/recurs across/i);
    expect(rows.filter((row) => row.kind === "promotion")).toHaveLength(0);
  });

  it("promotes with an independent approved review and explicit operator approval", () => {
    const { adapter, rows } = makeAdapter();
    const result = adapter.submit(input({ operatorApproved: true }));
    expect(result.harvest.ok).toBe(true);
    expect(result.promotion.ok).toBe(true);
    const harvest = result.harvest;
    const promotion = result.promotion;
    if (!harvest.ok || !promotion.ok) return;
    expect(promotion.promotion.kind).toBe("promotion");
    expect(promotion.promotion.reviewer).toBe("agent-b");
    expect(promotion.promotion.approvedAt).toBe(NOW());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(harvest.lesson);
    expect(rows[1]).toEqual(promotion.promotion);
  });

  it("promotes an approved review once the key recurs across distinct issues", () => {
    const { adapter } = makeAdapter();
    const first = adapter.submit(input({ evidence: evidence({ taskId: "task-1", issueId: "issue-1" }) }));
    const second = adapter.submit(input({ evidence: evidence({ taskId: "task-2", issueId: "issue-2" }) }));
    const third = adapter.submit(input({ evidence: evidence({ taskId: "task-3", issueId: "issue-3" }) }));
    expect(first.promotion.ok && second.promotion.ok).toBe(false);
    expect(third.promotion.ok).toBe(true);
  });
});

describe("ExecuteLearning — audit and replay", () => {
  it("emits exactly one audit event per first harvest/promotion and none on replay", () => {
    const audits: LearningAuditEvent[] = [];
    const { adapter } = makeAdapter({ onAudit: (event) => audits.push(event) });
    const first = adapter.submit(input({ operatorApproved: true }));
    expect(first.harvest.ok && first.promotion.ok).toBe(true);

    const harvested = audits.filter((event) => event.kind === "lesson.harvested");
    const promoted = audits.filter((event) => event.kind === "lesson.promoted");
    expect(harvested).toHaveLength(1);
    expect(promoted).toHaveLength(1);
    const harvest = first.harvest;
    const promotion = first.promotion;
    if (!harvest.ok || !promotion.ok) return;
    expect(harvested[0].issueId).toBe("issue-1");
    expect(harvested[0].record).toEqual(harvest.lesson);
    expect(promoted[0].issueId).toBe("issue-1");
    expect(promoted[0].record).toEqual(promotion.promotion);

    // Replaying the same input emits nothing new.
    adapter.submit(input({ operatorApproved: true }));
    expect(audits).toHaveLength(2);
  });

  it("is replay-safe across adapter restarts over the same store", () => {
    const { store, rows } = memoryStore();
    const options: ExecuteLearningOptions = { threshold: 1 };
    const first = new ExecuteLearning(store, options).submit(input({ operatorApproved: true }));
    const restarted = new ExecuteLearning(store, options).submit(input({ operatorApproved: true }));
    expect(restarted.records).toEqual(first.records);
    expect(rows.filter((row): row is LessonRecord => row.kind === "lesson")).toHaveLength(1);
    expect(rows.filter((row): row is PromotionRecord => row.kind === "promotion")).toHaveLength(1);
  });
});

describe("ExecuteLearning — runtime evidence", () => {
  it("builds runtime evidence with verifier refs, the policy pattern, and the author", () => {
    const { adapter, rows } = makeAdapter();
    const result = adapter.submit(
      input({
        evidence: executeLearningEvidence(
          {
            issueId: "issue-1",
            taskId: "task-1",
            runId: "run-abc",
            outcome: "succeeded",
            error: null,
            evidence: ["check-record:lint", "check-record:test"],
          },
          { pattern: STRONG_PATTERN, author: "agent-a" },
        ),
      }),
    );
    expect(result.harvest.ok).toBe(true);
    if (!result.harvest.ok) return;
    // The shared canonicalization prepends the run reference, never the builder.
    expect(result.harvest.lesson.refs).toEqual([
      "run/run-abc",
      "check-record:lint",
      "check-record:test",
    ]);
    expect(result.harvest.lesson.pattern).toBe(STRONG_PATTERN);
    expect(result.harvest.lesson.author).toBe("agent-a");
    expect(rows).toHaveLength(1);
  });

  it("falls back to the issue ref when the run produced no verifier evidence", () => {
    const { adapter } = makeAdapter();
    const result = adapter.submit(
      input({
        evidence: executeLearningEvidence(
          {
            issueId: "issue-1",
            taskId: "task-1",
            runId: "run-abc",
            outcome: "failed",
            error: "OMP exited 1",
            evidence: [],
          },
          { pattern: STRONG_PATTERN, author: "agent-a" },
        ),
      }),
    );
    expect(result.harvest.ok).toBe(true);
    if (!result.harvest.ok) return;
    expect(result.harvest.lesson.outcome).toBe("failed");
    expect(result.harvest.lesson.refs).toEqual(["run/run-abc", "issue/issue-1"]);
  });

  it("keeps a policy-shaped submit replay-idempotent over the same store", () => {
    const { store, rows } = memoryStore();
    const options: ExecuteLearningOptions = { threshold: 1 };
    const runtimeEvidence = (taskId: string, runId: string): ExecuteRunEvidence =>
      executeLearningEvidence(
        { issueId: "issue-1", taskId, runId, outcome: "succeeded", error: null, evidence: ["check-record"] },
        { pattern: STRONG_PATTERN, author: "agent-a" },
      );
    const first = new ExecuteLearning(store, options).submit(
      input({ evidence: runtimeEvidence("task-1", "run-abc"), operatorApproved: true }),
    );
    const replayed = new ExecuteLearning(store, options).submit(
      input({ evidence: runtimeEvidence("task-1", "run-abc"), operatorApproved: true }),
    );
    expect(replayed.records).toEqual(first.records);
    expect(rows.filter((row): row is LessonRecord => row.kind === "lesson")).toHaveLength(1);
    expect(rows.filter((row): row is PromotionRecord => row.kind === "promotion")).toHaveLength(1);
  });
});
