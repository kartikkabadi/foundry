import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluatePromotion,
  harvestLesson,
  LESSON_EVIDENCE_MIN,
  LearningLedger,
  relaxesPolicy,
  stableLessonKey,
  type HarvestResult,
  type LearningAuditEvent,
  type LearningRecord,
  type LearningStoreAdapter,
  type LessonEvidence,
  type LessonRecord,
  type LessonReview,
  type PromotionRecord,
} from "../lib/foundry/learning";
import {
  approveLessonAutomatically,
  defaultApprovalPolicy,
  evaluateAutomatedApproval,
  type EvidenceRecord,
  type EvidenceResolver,
  type LessonRiskClassification,
} from "../lib/foundry/approval-policy";

const NOW = () => "2026-08-25T00:00:00.000Z";

const STRONG_PATTERN =
  "Always verify that a released change passes the package tests before merge";

function evidence(overrides: Partial<LessonEvidence> = {}): LessonEvidence {
  return {
    taskId: "task-1",
    issueId: "issue-1",
    stage: "execute",
    outcome: "succeeded",
    pattern: STRONG_PATTERN,
    refs: ["run/abc/attempt-1", "evidence:verified"],
    author: "agent-a",
    ...overrides,
  };
}

function approvedReview(reviewer = "agent-b"): LessonReview {
  return { reviewer, verdict: "approved" };
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

function recordOf(result: HarvestResult): LessonRecord {
  if (!result.ok) throw new Error(result.reason);
  return result.lesson;
}

describe("stableLessonKey", () => {
  it("is deterministic for the same pattern", () => {
    expect(stableLessonKey(STRONG_PATTERN)).toBe(stableLessonKey(STRONG_PATTERN));
  });

  it("collapses whitespace formatting to the same key", () => {
    expect(stableLessonKey("  Always   verify that a released change\npasses the package tests before merge ")).toBe(
      stableLessonKey(STRONG_PATTERN),
    );
  });

  it("diverges for different patterns", () => {
    expect(stableLessonKey(STRONG_PATTERN)).not.toBe(stableLessonKey("A completely different lesson pattern"));
  });

  it("emits a fixed-width hex key", () => {
    expect(stableLessonKey(STRONG_PATTERN)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("harvestLesson — evidence minimum", () => {
  it("accepts strong succeeded evidence and produces a lesson row", () => {
    const result = harvestLesson(evidence(), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lesson = result.lesson;
    expect(lesson.kind).toBe("lesson");
    expect(lesson.id).toBe("lesson:task-1");
    expect(lesson.key).toBe(stableLessonKey(STRONG_PATTERN));
    expect(lesson.taskId).toBe("task-1");
    expect(lesson.issueId).toBe("issue-1");
    expect(lesson.stage).toBe("execute");
    expect(lesson.outcome).toBe("succeeded");
    expect(lesson.refs).toEqual(["run/abc/attempt-1", "evidence:verified"]);
    expect(lesson.author).toBe("agent-a");
    expect(lesson.proposedAt).toBe(NOW());
  });

  it("rejects evidence missing a task or issue id", () => {
    expect(harvestLesson(evidence({ taskId: "  " })).ok).toBe(false);
    expect(harvestLesson(evidence({ issueId: "" })).ok).toBe(false);
  });

  it("rejects evidence from a stage other than execute", () => {
    // @ts-expect-error learning harvests only execute-stage tasks
    expect(harvestLesson(evidence({ stage: "evidence" })).ok).toBe(false);
  });

  it("rejects evidence with a non-terminal outcome", () => {
    // @ts-expect-error running tasks are not terminal
    expect(harvestLesson(evidence({ outcome: "running" })).ok).toBe(false);
  });

  it("rejects a pattern below the evidence minimum", () => {
    const result = harvestLesson(evidence({ pattern: "It failed" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/too weak/i);
  });

  it("rejects evidence with no supporting refs", () => {
    expect(harvestLesson(evidence({ refs: [] })).ok).toBe(false);
    expect(harvestLesson(evidence({ refs: ["  "] })).ok).toBe(false);
  });

  it("rejects hollow failed-task evidence", () => {
    const result = harvestLesson(evidence({ outcome: "failed", pattern: "The task failed" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/too weak/i);
  });

  it("accepts concrete terminal-failure evidence with a prevention rule", () => {
    const result = harvestLesson(
      evidence({
        outcome: "failed",
        pattern:
          "Deploying without running the schema migration test first caused a runtime outage",
        refs: ["evidence:reproduced"],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.outcome).toBe("failed");
  });

  it("defaults the retention rule to the pattern and honors an explicit one", () => {
    const lesson = recordOf(harvestLesson(evidence(), { now: NOW }));
    expect(lesson.retentionRule).toBe(STRONG_PATTERN);
    const explicit = recordOf(
      harvestLesson(evidence({ retentionRule: "Add a lint rule that rejects unverified merges" })),
    );
    expect(explicit.retentionRule).toBe("Add a lint rule that rejects unverified merges");
  });

  it("marks the minimums explicitly so the evidence gate is tunable", () => {
    expect(LESSON_EVIDENCE_MIN.minRefs).toBeGreaterThanOrEqual(1);
    expect(LESSON_EVIDENCE_MIN.patternLength).toBeGreaterThan(0);
  });

  it("clones the caller's refs instead of aliasing them into the lesson", () => {
    const input = evidence();
    const lesson = recordOf(harvestLesson(input, { now: NOW }));
    expect(lesson.refs).not.toBe(input.refs);
    lesson.refs.push("caller-visible");
    expect(input.refs).toEqual(["run/abc/attempt-1", "evidence:verified"]);
  });
});

describe("evaluatePromotion — independent reviewer requirement", () => {
  it("rejects a lesson the review did not approve", () => {
    const lesson = recordOf(harvestLesson(evidence()));
    const rejected = evaluatePromotion(lesson, { reviewer: "agent-b", verdict: "rejected" }, [lesson], {
      threshold: 1,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toMatch(/review/i);
  });

  it("rejects when the reviewer is the task author", () => {
    const lesson = recordOf(harvestLesson(evidence({ author: "agent-a" })));
    const result = evaluatePromotion(lesson, approvedReview("agent-a"), [lesson], { threshold: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/independent/i);
  });

  it("rejects when the reviewer is not identified", () => {
    const lesson = recordOf(harvestLesson(evidence()));
    expect(evaluatePromotion(lesson, approvedReview(" "), [lesson], { threshold: 1 }).ok).toBe(false);
  });

  it("approves only with an independent approved review", () => {
    const lesson = recordOf(harvestLesson(evidence({ author: "agent-a" })));
    const result = evaluatePromotion(lesson, approvedReview("agent-b"), [lesson], { threshold: 1, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.promotion.kind).toBe("promotion");
    expect(result.promotion.reviewer).toBe("agent-b");
    expect(result.promotion.approvedAt).toBe(NOW());
  });

  it("does not let operator approval bypass the independent review", () => {
    const lesson = recordOf(harvestLesson(evidence({ author: "agent-a" })));
    const result = evaluatePromotion(lesson, approvedReview("agent-a"), [lesson], {
      operatorApproved: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/independent/i);
  });

  it("rejects a lesson with no identifiable author, even with operator approval", () => {
    const lesson = recordOf(harvestLesson(evidence({ author: undefined })));
    expect(lesson.author).toBeNull();
    const result = evaluatePromotion(lesson, approvedReview("agent-b"), [lesson], {
      operatorApproved: true,
      threshold: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/author/i);
  });

  it("rejects a lesson whose author is blank", () => {
    const lesson = recordOf(harvestLesson(evidence({ author: "   " })));
    expect(lesson.author).toBeNull();
    const result = evaluatePromotion(lesson, approvedReview("agent-b"), [lesson], { threshold: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/author/i);
  });

  it("self-review cannot pass by omitting the author", () => {
    // Omitting the author must not let any reviewer sail through: with no
    // recorded author the independence property is uncheckable, so promotion
    // fails closed instead of treating the reviewer as independent.
    const lesson = recordOf(harvestLesson(evidence({ author: undefined })));
    const result = evaluatePromotion(lesson, approvedReview("agent-b"), [lesson], { threshold: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/author/i);
  });
});

describe("evaluatePromotion — rejection and threshold", () => {
  it("rejects a lesson that would relax a gate or budget by default", () => {
    const lesson = recordOf(
      harvestLesson(
        evidence({ retentionRule: "Skip the gate when the change is small to speed up delivery" }),
      ),
    );
    const result = evaluatePromotion(lesson, approvedReview(), [lesson], { threshold: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/relax/i);
  });

  it("flags policy-relaxing rules", () => {
    expect(relaxesPolicy("Relax the small-PR limit to 40 files")).toBe(true);
    expect(relaxesPolicy("Bypass the gate on Fridays")).toBe(true);
    expect(relaxesPolicy("Run the package tests before merging")).toBe(false);
  });

  it("rejects a lesson that has not recurred enough across distinct issues", () => {
    const lesson = recordOf(harvestLesson(evidence({ issueId: "issue-1" })));
    const second = recordOf(
      harvestLesson(evidence({ taskId: "task-2", issueId: "issue-2" })),
    );
    expect(second.key).toBe(lesson.key);
    const result = evaluatePromotion(lesson, approvedReview(), [lesson, second], {
      threshold: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/threshold/);
  });

  it("promotes once the key recurs across the threshold of distinct issues", () => {
    const lessons: LessonRecord[] = [];
    for (let index = 1; index <= 3; index += 1) {
      lessons.push(recordOf(harvestLesson(evidence({ taskId: `task-${index}`, issueId: `issue-${index}` }))));
    }
    expect(new Set(lessons.map((lesson) => lesson.key)).size).toBe(1);
    const result = evaluatePromotion(lessons[2], approvedReview(), lessons, { now: NOW });
    expect(result.ok).toBe(true);
  });

  it("allows operator promotion to skip the recurrence threshold", () => {
    const lesson = recordOf(harvestLesson(evidence()));
    const result = evaluatePromotion(lesson, approvedReview(), [lesson], { operatorApproved: true });
    expect(result.ok).toBe(true);
  });
});

describe("evaluatePromotion — duplicate promotion", () => {
  it("rejects a second promotion of the same stable key", () => {
    const first = recordOf(harvestLesson(evidence({ taskId: "task-1", issueId: "issue-1" })));
    const second = recordOf(harvestLesson(evidence({ taskId: "task-2", issueId: "issue-2" })));
    expect(second.key).toBe(first.key);
    const promoted = evaluatePromotion(first, approvedReview(), [first, second], { threshold: 1, now: NOW });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    const dup = evaluatePromotion(second, approvedReview(), [first, second, promoted.promotion], {
      threshold: 1,
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toMatch(/already promoted/i);
  });
});

describe("LearningLedger — replay and idempotency", () => {
  it("harvests and promotes through plain serializable records", () => {
    const { store, rows } = memoryStore();
    const ledger = new LearningLedger(store, { threshold: 1, now: NOW });
    const harvest = ledger.harvest(evidence());
    expect(harvest.ok).toBe(true);
    if (!harvest.ok) return;
    const promote = ledger.promote(harvest.lesson.id, approvedReview());
    expect(promote.ok).toBe(true);
    if (!promote.ok) return;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(harvest.lesson);
    expect(rows[1]).toEqual(promote.promotion);
    for (const row of rows) {
      expect(JSON.parse(JSON.stringify(row))).toEqual(row);
    }
  });

  it("harvesting the same task twice appends one lesson row", () => {
    const { store, rows } = memoryStore();
    const ledger = new LearningLedger(store, { threshold: 1, now: NOW });
    const first = ledger.harvest(evidence());
    const second = ledger.harvest(evidence());
    expect(first.ok && second.ok).toBe(true);
    if (!(first.ok && second.ok)) return;
    expect(second.lesson).toEqual(first.lesson);
    expect(rows.filter((row) => row.kind === "lesson")).toHaveLength(1);
  });

  it("promoting the same lesson twice appends one promotion row", () => {
    const { store, rows } = memoryStore();
    const ledger = new LearningLedger(store, { threshold: 1, now: NOW });
    const harvest = ledger.harvest(evidence());
    if (!harvest.ok) return;
    const first = ledger.promote(harvest.lesson.id, approvedReview());
    const second = ledger.promote(harvest.lesson.id, approvedReview());
    expect(first.ok && second.ok).toBe(true);
    if (!(first.ok && second.ok)) return;
    expect(second.promotion).toEqual(first.promotion);
    expect(rows.filter((row) => row.kind === "promotion")).toHaveLength(1);
  });

  it("never promotes a duplicate stable key through the ledger", () => {
    const { store, rows } = memoryStore();
    const ledger = new LearningLedger(store, { threshold: 1, now: NOW });
    const first = ledger.harvest(evidence({ taskId: "task-1", issueId: "issue-1" }));
    if (!first.ok) return;
    expect(ledger.promote(first.lesson.id, approvedReview()).ok).toBe(true);
    const second = ledger.harvest(evidence({ taskId: "task-2", issueId: "issue-2" }));
    if (!second.ok) return;
    const dup = ledger.promote(second.lesson.id, approvedReview());
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toMatch(/already promoted/i);
    expect(rows.filter((row) => row.kind === "promotion")).toHaveLength(1);
  });

  it("replaying a sequence on a fresh store yields identical records", () => {
    function run(): LearningRecord[] {
      const { store, rows } = memoryStore();
      const ledger = new LearningLedger(store, { threshold: 1, now: NOW });
      const harvest = ledger.harvest(evidence({ taskId: "task-1", issueId: "issue-1" }));
      if (!harvest.ok) throw new Error("harvest failed");
      const review = ledger.promote(harvest.lesson.id, approvedReview());
      if (!review.ok) throw new Error("promote failed");
      const second = ledger.harvest(evidence({ taskId: "task-2", issueId: "issue-1", pattern: STRONG_PATTERN }));
      if (!second.ok) throw new Error("second harvest failed");
      ledger.promote(second.lesson.id, { reviewer: "agent-c", verdict: "rejected" });
      return rows;
    }
    const first = run();
    const second = run();
    expect(second).toEqual(first);
    expect(first.filter((row): row is PromotionRecord => row.kind === "promotion")).toHaveLength(1);
  });

  it("rejects promoting an unknown lesson id", () => {
    const ledger = new LearningLedger(memoryStore().store);
    const result = ledger.promote("lesson:nope", approvedReview());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no harvested lesson/i);
  });
});

describe("durable learning store (SQLite)", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "foundry-learn-"));
    process.env.FOUNDRY_DATA = join(dataDir, "data");
    vi.resetModules();
  });

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  // Dynamic import is deliberate: store.ts holds a module-level SQLite `db`
  // singleton, so a fresh module instance is what simulates a new connection
  // and proves rows really persisted to disk rather than to a shared cache.
  async function loadStore(): Promise<LearningStoreAdapter> {
    const { createLearningStore } = await import("../lib/foundry/store");
    return createLearningStore();
  }

  async function loadLedger(): Promise<{
    store: LearningStoreAdapter;
    ledger: LearningLedger;
    audits: LearningAuditEvent[];
  }> {
    const { createLearningStore } = await import("../lib/foundry/store");
    const { LearningLedger: DurableLedger } = await import("../lib/foundry/learning");
    const store = createLearningStore();
    const audits: LearningAuditEvent[] = [];
    const ledger = new DurableLedger(store, {
      threshold: 1,
      now: NOW,
      onAudit: (event) => {
        audits.push(event);
      },
    });
    return { store, ledger, audits };
  }

  it("persists records across adapter instances and a fresh connection", async () => {
    const first = await loadStore();
    const lesson = recordOf(harvestLesson(evidence(), { now: NOW }));
    first.append(lesson);
    const promotion: PromotionRecord = {
      kind: "promotion",
      id: `promotion:${lesson.id}`,
      key: lesson.key,
      lessonId: lesson.id,
      issueId: lesson.issueId,
      reviewer: "agent-b",
      approvedAt: NOW(),
    };
    first.append(promotion);

    // A second adapter over the same database reads both rows.
    const second = await loadStore();
    expect(second.load()).toEqual([lesson, promotion]);

    // A truly fresh connection (new module) reads the same rows from disk.
    vi.resetModules();
    const fresh = await loadStore();
    expect(fresh.load()).toEqual([lesson, promotion]);
  });

  it("replaying a sequence on a fresh durable adapter appends no duplicates", async () => {
    async function run(): Promise<readonly LearningRecord[]> {
      const { store, ledger } = await loadLedger();
      const harvest = ledger.harvest(evidence({ taskId: "task-1", issueId: "issue-1" }));
      if (!harvest.ok) throw new Error("harvest failed");
      ledger.promote(harvest.lesson.id, approvedReview());
      const second = ledger.harvest(evidence({ taskId: "task-2", issueId: "issue-1" }));
      if (!second.ok) throw new Error("second harvest failed");
      ledger.promote(second.lesson.id, { reviewer: "agent-c", verdict: "rejected" });
      return store.load();
    }
    const first = await run();
    const second = await run();
    expect(second).toEqual(first);
    expect(first.filter((row): row is PromotionRecord => row.kind === "promotion")).toHaveLength(1);
  });

  it("persists only independent approved promotions and rejects self-review", async () => {
    const { store, ledger } = await loadLedger();
    const harvest = ledger.harvest(evidence({ author: "agent-a" }));
    if (!harvest.ok) throw new Error("harvest failed");

    const selfReview = ledger.promote(harvest.lesson.id, approvedReview("agent-a"));
    expect(selfReview.ok).toBe(false);
    expect(store.load().filter((row) => row.kind === "promotion")).toHaveLength(0);

    const approved = ledger.promote(harvest.lesson.id, approvedReview("agent-b"));
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error(approved.reason);
    const rows = store.load();
    expect(rows.filter((row) => row.kind === "promotion")).toHaveLength(1);
    expect(rows[rows.length - 1]).toEqual(approved.promotion);
  });

  it("persists recurrence across distinct issues and promotes at the threshold after restart", async () => {
    // Harvest the same pattern from three distinct issues; each lesson row
    // carries its own issue id so recurrence survives a restart.
    const { store, lessons } = await (async () => {
      const loaded = await loadLedger();
      const rows: LessonRecord[] = [];
      for (let index = 1; index <= 3; index += 1) {
        const result = loaded.ledger.harvest(
          evidence({ taskId: `task-r${index}`, issueId: `issue-r${index}` }),
        );
        if (!result.ok) throw new Error(result.reason);
        rows.push(result.lesson);
      }
      return { store: loaded.store, lessons: rows };
    })();
    expect(new Set(lessons.map((lesson) => lesson.key)).size).toBe(1);
    expect(store.load()).toHaveLength(3);

    // A truly fresh connection reads all recurrence issue ids from disk.
    vi.resetModules();
    const reopened = await loadStore();
    const onDisk = reopened.load();
    expect(onDisk.filter((row) => row.kind === "lesson")).toHaveLength(3);
    const issues = new Set(
      onDisk.filter((row): row is LessonRecord => row.kind === "lesson").map((row) => row.issueId),
    );
    expect(issues).toEqual(new Set(["issue-r1", "issue-r2", "issue-r3"]));

    // Promotion at the default threshold (3) succeeds from the persisted rows.
    const { LearningLedger: DurableLedger } = await import("../lib/foundry/learning");
    const ledger = new DurableLedger(reopened, { now: NOW });
    const review = ledger.promote(lessons[2].id, approvedReview("agent-b"));
    expect(review.ok).toBe(true);
    if (!review.ok) throw new Error(review.reason);
    const after = reopened.load();
    expect(after.filter((row) => row.kind === "promotion")).toHaveLength(1);
    expect(after[after.length - 1]).toEqual(review.promotion);
  });

  it("never persists a policy-relaxing promotion across restart", async () => {
    const { store, ledger } = await loadLedger();
    // Harvesting succeeds (the candidate lesson is persisted), but the
    // retention rule would relax a gate, so promotion is rejected.
    const harvest = ledger.harvest(
      evidence({ retentionRule: "Skip the gate when the change is small to speed up delivery" }),
    );
    expect(harvest.ok).toBe(true);
    if (!harvest.ok) throw new Error(harvest.reason);
    const rejected = ledger.promote(harvest.lesson.id, approvedReview("agent-b"));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toMatch(/relax/i);
    expect(store.load().filter((row) => row.kind === "promotion")).toHaveLength(0);

    // A fresh adapter over the same database still has no promotion row.
    vi.resetModules();
    const reopened = await loadStore();
    const rows = reopened.load();
    expect(rows.filter((row) => row.kind === "lesson")).toHaveLength(1);
    expect(rows.filter((row) => row.kind === "promotion")).toHaveLength(0);
  });

  it("rejects failed or weak evidence without appending a row", async () => {
    const { store, ledger } = await loadLedger();
    const hollow = ledger.harvest(evidence({ outcome: "failed", pattern: "The task failed" }));
    expect(hollow.ok).toBe(false);
    const missingRef = ledger.harvest(evidence({ refs: [] }));
    expect(missingRef.ok).toBe(false);
    const wrongStage = ledger.harvest(evidence({ stage: "evidence" as never }));
    expect(wrongStage.ok).toBe(false);
    expect(store.load()).toEqual([]);
  });

  it("emits exactly one audit event per first harvest/promotion and none on replay", async () => {
    const { ledger, audits } = await loadLedger();
    const first = ledger.harvest(evidence());
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.reason);
    expect(audits.filter((event) => event.kind === "lesson.harvested")).toHaveLength(1);

    // Replaying the same task emits nothing.
    ledger.harvest(evidence());
    expect(audits.filter((event) => event.kind === "lesson.harvested")).toHaveLength(1);

    const promoted = ledger.promote(first.lesson.id, approvedReview());
    expect(promoted.ok).toBe(true);
    expect(audits.filter((event) => event.kind === "lesson.promoted")).toHaveLength(1);

    // Replaying the same promotion emits nothing.
    ledger.promote(first.lesson.id, approvedReview());
    expect(audits.filter((event) => event.kind === "lesson.promoted")).toHaveLength(1);

    expect(audits).toHaveLength(2);
  });

  it("persists exactly one durable audit event per first harvest/promotion via appendEvent", async () => {
    const { createLearningStore } = await import("../lib/foundry/store");
    const { LearningLedger: DurableLedger } = await import("../lib/foundry/learning");
    const { appendEvent, readEvents } = await import("../lib/foundry/log");
    const store = createLearningStore();
    const ledger = new DurableLedger(store, {
      threshold: 1,
      now: NOW,
      onAudit: (event) => {
        appendEvent(event.issueId, event.kind, { id: event.record.id, key: event.record.key });
      },
    });
    const harvest = ledger.harvest(evidence({ issueId: "issue-9" }));
    if (!harvest.ok) throw new Error("harvest failed");
    ledger.harvest(evidence({ issueId: "issue-9" })); // replay: no event
    ledger.promote(harvest.lesson.id, approvedReview());
    ledger.promote(harvest.lesson.id, approvedReview()); // replay: no event
    const events = readEvents("issue-9");
    expect(events.filter((event) => event.kind === "lesson.harvested")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "lesson.promoted")).toHaveLength(1);
  });
});

describe("automated approval composes with evaluatePromotion without weakening it", () => {
  const enabledPolicy = defaultApprovalPolicy({
    enabled: true,
    approvedClassifiers: ["verifier-1"],
  });

  function classificationOf(lesson: LessonRecord): LessonRiskClassification {
    return {
      category: { kind: "factual" },
      issuedBy: "verifier-1",
      issuedAt: NOW(),
      lessonId: lesson.id,
      lessonKey: lesson.key,
    };
  }

  function boundResolver(lesson: LessonRecord): EvidenceResolver {
    const byRef = new Map<string, EvidenceRecord>();
    for (const ref of lesson.refs) {
      byRef.set(ref, { id: ref, kind: "run", lessonKey: lesson.key });
    }
    return (ref) => byRef.get(ref);
  }

  it("promotes an eligible factual lesson through the ledger with the synthesized review", () => {
    const { store, rows } = memoryStore();
    const ledger = new LearningLedger(store, { operatorApproved: true, now: NOW });
    const harvest = ledger.harvest(evidence({ author: "agent-a" }));
    expect(harvest.ok).toBe(true);
    if (!harvest.ok) throw new Error(harvest.reason);

    const decision = evaluateAutomatedApproval(
      harvest.lesson,
      classificationOf(harvest.lesson),
      enabledPolicy,
      [],
      { resolveEvidence: boundResolver(harvest.lesson), now: NOW },
    );
    expect(decision.kind).toBe("approved");
    if (decision.kind !== "approved") return;

    const promoted = ledger.promote(harvest.lesson.id, decision.review);
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) throw new Error(promoted.reason);
    expect(promoted.promotion.reviewer).toBe(enabledPolicy.authority);
    expect(rows.filter((row) => row.kind === "promotion")).toHaveLength(1);
  });

  it("approveLessonAutomatically promotes and returns the same promotion shape", () => {
    const lesson = recordOf(harvestLesson(evidence({ author: "agent-a" })));
    const result = approveLessonAutomatically(lesson, classificationOf(lesson), enabledPolicy, [], {
      resolveEvidence: boundResolver(lesson),
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.promotion).toMatchObject({
      kind: "promotion",
      key: lesson.key,
      lessonId: lesson.id,
      reviewer: enabledPolicy.authority,
      approvedAt: NOW(),
    });
  });

  it("rejects a forbidden class through the composed helper", () => {
    const lesson = recordOf(
      harvestLesson(
        evidence({
          pattern: "Merge the pull request when tests pass to reduce review lag",
          retentionRule: "Merge the pull request when tests pass to reduce review lag",
        }),
      ),
    );
    const result = approveLessonAutomatically(lesson, classificationOf(lesson), enabledPolicy, [], {
      resolveEvidence: boundResolver(lesson),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/merge/i);
  });
});
