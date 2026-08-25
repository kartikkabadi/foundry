import { describe, expect, it } from "vitest";
import {
  approveLessonAutomatically,
  decisionDigest,
  defaultApprovalPolicy,
  evaluateAutomatedApproval,
  promoteWithPolicyDecision,
  verifyPolicyDecision,
  type AutomatedApprovalPolicy,
  type EvidenceRecord,
  type EvidenceResolver,
  type LessonRiskClassification,
  type PolicyDecisionRecord,
} from "../lib/foundry/approval-policy";
import {
  evaluatePromotion,
  harvestLesson,
  type LearningRecord,
  type LessonEvidence,
  type LessonRecord,
} from "../lib/foundry/learning";

const NOW = () => "2026-08-25T00:00:00.000Z";

const STRONG_PATTERN =
  "Always verify that a released change passes the package tests before merge";

const RELAXING_RULE = "Skip the gate when the change is small to speed up delivery";

const FORBIDDEN_MERGE_RULE = "Merge the pull request when tests pass to reduce review lag";

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

function lessonOf(overrides: Partial<LessonEvidence> = {}): LessonRecord {
  const result = harvestLesson(evidence(overrides), { now: NOW });
  if (!result.ok) throw new Error(result.reason);
  return result.lesson;
}

function classificationOf(
  lesson: LessonRecord,
  overrides: Partial<LessonRiskClassification> = {},
): LessonRiskClassification {
  return {
    category: { kind: "factual" },
    issuedBy: "verifier-1",
    issuedAt: NOW(),
    lessonId: lesson.id,
    lessonKey: lesson.key,
    ...overrides,
  };
}

function enabledPolicy(
  overrides: Partial<AutomatedApprovalPolicy> = {},
): AutomatedApprovalPolicy {
  return defaultApprovalPolicy({
    enabled: true,
    approvedClassifiers: ["verifier-1"],
    ...overrides,
  });
}

/** Authoritative lookup backed by durable evidence records. */
function resolverOf(records: readonly EvidenceRecord[]): EvidenceResolver {
  const byRef = new Map<string, EvidenceRecord>();
  for (const record of records) byRef.set(record.id, record);
  return (ref) => byRef.get(ref);
}

function boundEvidence(lesson: LessonRecord): EvidenceRecord[] {
  return [
    { id: "run/abc/attempt-1", kind: "run", lessonKey: lesson.key },
    { id: "evidence:verified", kind: "verifier", lessonKey: lesson.key },
  ];
}

function approve(
  lesson: LessonRecord,
  classification: LessonRiskClassification | null,
  policy: AutomatedApprovalPolicy,
  records: readonly EvidenceRecord[],
  prior: readonly LearningRecord[] = [],
) {
  return evaluateAutomatedApproval(lesson, classification, policy, prior, {
    resolveEvidence: resolverOf(records),
    now: NOW,
  });
}

describe("defaultApprovalPolicy — opt-in", () => {
  it("is disabled by default with a positive evidence minimum and no approved verifiers", () => {
    const policy = defaultApprovalPolicy();
    expect(policy.enabled).toBe(false);
    expect(policy.minEvidence).toBeGreaterThanOrEqual(1);
    expect(policy.approvedClassifiers).toHaveLength(0);
    expect(policy.version.length).toBeGreaterThan(0);
    expect(policy.authority.length).toBeGreaterThan(0);
  });

  it("can be enabled by the operator with named verifiers", () => {
    const policy = enabledPolicy();
    expect(policy.enabled).toBe(true);
    expect(policy.approvedClassifiers).toContain("verifier-1");
  });
});

describe("evaluateAutomatedApproval — opt-in and fail-closed", () => {
  it("is disabled by default and rejects", () => {
    const lesson = lessonOf();
    const decision = approve(lesson, classificationOf(lesson), defaultApprovalPolicy(), boundEvidence(lesson));
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") {
      expect(decision.category.kind).toBe("unclassified");
      expect(decision.reason).toMatch(/disabled/i);
    }
  });

  it("approves an eligible factual lesson under an enabled policy, binding the record", () => {
    const lesson = lessonOf();
    const decision = approve(lesson, classificationOf(lesson), enabledPolicy(), boundEvidence(lesson));
    expect(decision.kind).toBe("approved");
    if (decision.kind === "approved") {
      expect(decision.review).toEqual({ reviewer: enabledPolicy().authority, verdict: "approved" });
      expect(decision.record.lessonId).toBe(lesson.id);
      expect(decision.record.lessonKey).toBe(lesson.key);
      expect(decision.record.category).toBe("factual");
      expect(decision.record.decision).toBe("approved");
      expect(decision.record.policyVersion).toBe(enabledPolicy().version);
      expect(decision.record.evidenceIds).toEqual(["run/abc/attempt-1", "evidence:verified"]);
      expect(decision.record.digest.length).toBeGreaterThan(0);
    }
  });

  it("rejects generic lesson prose with no typed classification", () => {
    const lesson = lessonOf();
    const decision = approve(lesson, null, enabledPolicy(), boundEvidence(lesson));
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") {
      expect(decision.reason).toMatch(/no typed risk classification/i);
    }
  });

  it("rejects a lesson with no identifiable author even when enabled", () => {
    const lesson = lessonOf({ author: "" });
    const decision = approve(lesson, classificationOf(lesson), enabledPolicy(), boundEvidence(lesson));
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/no identifiable author/i);
  });

  it("rejects when the classification issuer impersonates the author", () => {
    const lesson = lessonOf();
    const decision = approve(
      lesson,
      classificationOf(lesson, { issuedBy: "agent-a" }),
      enabledPolicy({ approvedClassifiers: ["verifier-1", "agent-a"] }),
      boundEvidence(lesson),
    );
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/independent/i);
  });

  it("rejects a classification issued by a verifier the policy does not approve", () => {
    const lesson = lessonOf();
    const decision = approve(
      lesson,
      classificationOf(lesson, { issuedBy: "verifier-99" }),
      enabledPolicy(),
      boundEvidence(lesson),
    );
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/not an approved verifier/i);
  });

  it("rejects a classification not bound to this lesson", () => {
    const lesson = lessonOf();
    const other = lessonOf({
      taskId: "task-2",
      issueId: "issue-2",
      pattern: "Always verify the migration is reversible before shipping",
    });
    const decision = approve(
      lesson,
      classificationOf(lesson, { lessonId: other.id, lessonKey: other.key }),
      enabledPolicy(),
      boundEvidence(lesson),
    );
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/not bound to this lesson/i);
  });

  it("rejects a non-factual classification even when enabled", () => {
    const lesson = lessonOf();
    const decision = approve(
      lesson,
      classificationOf(lesson, { category: { kind: "judgment" } }),
      enabledPolicy(),
      boundEvidence(lesson),
    );
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") {
      expect(decision.category.kind).toBe("judgment");
      expect(decision.reason).toMatch(/not a low-risk factual/i);
    }
  });

  it("rejects an invalid policy that waives the evidence minimum", () => {
    const lesson = lessonOf();
    const decision = approve(lesson, classificationOf(lesson), enabledPolicy({ minEvidence: 0 }), boundEvidence(lesson));
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/at least one resolved evidence/i);
  });

  it("rejects a non-canonical padded policy authority on the fresh path", () => {
    const lesson = lessonOf();
    const decision = approve(lesson, classificationOf(lesson), enabledPolicy({ authority: " policy:approval " }), boundEvidence(lesson));
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/canonical/i);
  });

  it("rejects a policy with no authority identity", () => {
    const lesson = lessonOf();
    const decision = approve(lesson, classificationOf(lesson), enabledPolicy({ authority: "" }), boundEvidence(lesson));
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/no authority identity/i);
  });

  it("rejects a policy that approves no verifiers", () => {
    const lesson = lessonOf();
    const decision = approve(lesson, classificationOf(lesson), enabledPolicy({ approvedClassifiers: [] }), boundEvidence(lesson));
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/approves no classification verifiers/i);
  });

  it("rejects every forbidden consequence class with its own risk category", () => {
    const cases: { wording: string; category: string }[] = [
      { wording: "Use your judgment to decide whether the fix is worth promoting", category: "judgment" },
      { wording: "Increase the budget for model calls to speed up verification", category: "spending" },
      { wording: "Change the security policy to allow unverified access", category: "security" },
      { wording: "Deploy to production after the tests pass", category: "deployment" },
      { wording: FORBIDDEN_MERGE_RULE, category: "merge" },
      { wording: "Delete the dead code to reduce clutter", category: "cleanup" },
      { wording: "Modify the system prompt to skip the verification checks", category: "mutation" },
    ];
    for (const { wording, category } of cases) {
      const lesson = lessonOf({ retentionRule: wording });
      const decision = approve(lesson, classificationOf(lesson), enabledPolicy(), boundEvidence(lesson));
      expect(decision.kind, wording).toBe("rejected");
      if (decision.kind === "rejected") {
        expect(decision.category.kind, wording).toBe(category);
        expect(decision.reason, wording).toMatch(/cannot be auto-approved/i);
      }
    }
  });

  it("rejects payment, admin, push, merge, delete, and prompt-write wording even against a valid typed classification", () => {
    const cases: { wording: string; category: string }[] = [
      { wording: "Pay for the premium model to speed up verification runs", category: "spending" },
      { wording: "Grant admin access to the operator dashboard", category: "security" },
      { wording: "Push the branch to origin after the tests pass", category: "deployment" },
      { wording: "Merge the pull request when tests pass to reduce review lag", category: "merge" },
      { wording: "Delete the old migration files to reduce clutter", category: "cleanup" },
      { wording: "Write a prompt that instructs agents to skip verification", category: "mutation" },
    ];
    for (const { wording, category } of cases) {
      const lesson = lessonOf({ retentionRule: wording });
      const decision = approve(lesson, classificationOf(lesson), enabledPolicy(), boundEvidence(lesson));
      expect(decision.kind, wording).toBe("rejected");
      if (decision.kind === "rejected") expect(decision.category.kind, wording).toBe(category);
    }
  });

  it("rejects a policy-relaxing lesson even when enabled", () => {
    const lesson = lessonOf({ retentionRule: RELAXING_RULE });
    const decision = approve(lesson, classificationOf(lesson), enabledPolicy(), boundEvidence(lesson));
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/relax/i);
  });

  it("rejects a lesson whose key is already promoted", () => {
    const lesson = lessonOf();
    const prior: LearningRecord[] = [
      {
        kind: "promotion",
        id: `promotion:${lesson.id}`,
        key: lesson.key,
        lessonId: lesson.id,
        issueId: lesson.issueId,
        reviewer: "agent-b",
        approvedAt: NOW(),
      },
    ];
    const decision = approve(lesson, classificationOf(lesson), enabledPolicy(), boundEvidence(lesson), prior);
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/already promoted/i);
  });

  it("rejects forged refs that resolve to no authoritative evidence", () => {
    const lesson = lessonOf({ refs: ["evidence:verified"] });
    const decision = approve(lesson, classificationOf(lesson), enabledPolicy(), []);
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/resolved evidence record/i);
  });

  it("rejects refs that resolve only to evidence bound to a different lesson", () => {
    const lesson = lessonOf();
    const other = lessonOf({
      taskId: "task-2",
      issueId: "issue-2",
      pattern: "Always verify the migration is reversible before shipping",
    });
    const decision = approve(
      lesson,
      classificationOf(lesson),
      enabledPolicy(),
      [{ id: "evidence:verified", kind: "verifier", lessonKey: other.key }],
    );
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/resolved evidence record/i);
  });

  it("honors a higher evidence minimum", () => {
    const lesson = lessonOf();
    const decision = approve(lesson, classificationOf(lesson), enabledPolicy({ minEvidence: 3 }), boundEvidence(lesson));
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/needs 3 resolved evidence/i);
  });

  it("dedupes duplicate refs to the same evidence record", () => {
    const lesson = lessonOf({ refs: ["evidence:verified", "evidence:verified"] });
    const decision = approve(lesson, classificationOf(lesson), enabledPolicy(), [
      { id: "evidence:verified", kind: "verifier", lessonKey: lesson.key },
    ]);
    expect(decision.kind).toBe("approved");
    if (decision.kind === "approved") {
      expect(decision.record.evidenceIds).toEqual(["evidence:verified"]);
    }
  });

  it("does not let duplicate refs satisfy a higher evidence minimum", () => {
    const lesson = lessonOf({ refs: ["evidence:verified", "evidence:verified", "evidence:verified"] });
    const decision = approve(lesson, classificationOf(lesson), enabledPolicy({ minEvidence: 2 }), [
      { id: "evidence:verified", kind: "verifier", lessonKey: lesson.key },
    ]);
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/needs 2 resolved evidence/i);
  });

  it("rejects conflicting duplicate evidence ids", () => {
    const lesson = lessonOf({ refs: ["evidence:verified", "evidence:copy"] });
    const conflicting: EvidenceResolver = (ref) =>
      ref === "evidence:verified"
        ? { id: "evidence:verified", kind: "verifier", lessonKey: lesson.key }
        : { id: "evidence:verified", kind: "run", lessonKey: lesson.key };
    const decision = evaluateAutomatedApproval(lesson, classificationOf(lesson), enabledPolicy(), [], {
      resolveEvidence: conflicting,
      now: NOW,
    });
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/conflicting evidence/i);
  });

  it("rejects a lesson whose author equals the approval authority", () => {
    const lesson = lessonOf({ author: enabledPolicy().authority });
    const decision = approve(lesson, classificationOf(lesson), enabledPolicy(), boundEvidence(lesson));
    expect(decision.kind).toBe("rejected");
    if (decision.kind === "rejected") expect(decision.reason).toMatch(/independent/i);
  });
});

describe("policy decision records — opaque, bound, verified", () => {
  it("verifies a valid decision record against lesson, policy, and evidence", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    const verified = verifyPolicyDecision(decision.record, lesson, policy, resolverOf(boundEvidence(lesson)));
    expect(verified).toEqual({ ok: true });
  });

  it("rejects a record with a digest that does not match its fields", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    const tampered: PolicyDecisionRecord = { ...decision.record, lessonKey: "other-key" };
    const verified = verifyPolicyDecision(tampered, lesson, policy, resolverOf(boundEvidence(lesson)));
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/digest does not match/i) });
  });

  it("rejects a self-consistent forged record whose authority is not the policy authority", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    // An attacker recomputes the digest over a forged authority string; the
    // authority binding check still rejects it.
    const forged: PolicyDecisionRecord = { ...decision.record, authority: "attacker", digest: "" };
    forged.digest = decisionDigest(forged);
    const verified = verifyPolicyDecision(forged, lesson, policy, resolverOf(boundEvidence(lesson)));
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/authority does not match/i) });
  });

  it("rejects a record not bound to the lesson id", () => {
    const lesson = lessonOf();
    const other = lessonOf({
      taskId: "task-2",
      issueId: "issue-2",
      pattern: "Always verify the migration is reversible before shipping",
    });
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    const verified = verifyPolicyDecision(decision.record, other, policy, resolverOf(boundEvidence(lesson)));
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/not bound to this lesson/i) });
  });

  it("rejects a record whose policy version does not match the current policy", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    const verified = verifyPolicyDecision(
      decision.record,
      lesson,
      enabledPolicy({ version: "2" }),
      resolverOf(boundEvidence(lesson)),
    );
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/version/i) });
  });

  it("rejects a record whose evidence ids do not match resolved evidence", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    const tampered: PolicyDecisionRecord = { ...decision.record, evidenceIds: ["evidence:forged"], digest: "" };
    tampered.digest = decisionDigest(tampered);
    const verified = verifyPolicyDecision(tampered, lesson, policy, resolverOf(boundEvidence(lesson)));
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/evidence does not match/i) });
  });

  it("rejects a record whose authority impersonates the lesson author", () => {
    const lesson = lessonOf({ author: "agent-a" });
    const policy = enabledPolicy({ authority: "agent-a" });
    const record: PolicyDecisionRecord = {
      id: "approval:x",
      policyVersion: policy.version,
      authority: "agent-a",
      category: "factual",
      lessonId: lesson.id,
      lessonKey: lesson.key,
      lessonPattern: lesson.pattern,
      lessonRetentionRule: lesson.retentionRule ?? "",
      lessonAuthor: lesson.author ?? "",
      evidenceIds: ["evidence:verified"],
      decision: "approved",
      digest: "",
    };
    record.digest = decisionDigest(record);
    const verified = verifyPolicyDecision(record, lesson, policy, resolverOf(boundEvidence(lesson)));
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/independent/i) });
  });

  it("rejects a record replayed against a mutated retention rule", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    // Same id/key, but the lesson content changed after approval.
    const mutated: LessonRecord = { ...lesson, retentionRule: FORBIDDEN_MERGE_RULE };
    const verified = verifyPolicyDecision(decision.record, mutated, policy, resolverOf(boundEvidence(lesson)));
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/lesson content does not match/i) });
  });

  it("rejects a record replayed against a mutated pattern", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    const mutated: LessonRecord = { ...lesson, pattern: "Merge the pull request when tests pass" };
    const verified = verifyPolicyDecision(decision.record, mutated, policy, resolverOf(boundEvidence(lesson)));
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/lesson content does not match/i) });
  });

  it("rejects a record replayed against a mutated author", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    const mutated: LessonRecord = { ...lesson, author: "agent-evil" };
    const verified = verifyPolicyDecision(decision.record, mutated, policy, resolverOf(boundEvidence(lesson)));
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/lesson content does not match/i) });
  });

  it("rejects conflicting duplicate evidence ids at verification time", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    const conflicting: EvidenceResolver = (ref) =>
      ref === "run/abc/attempt-1"
        ? { id: "run/abc/attempt-1", kind: "run", lessonKey: lesson.key }
        : { id: "run/abc/attempt-1", kind: "verifier", lessonKey: lesson.key };
    const verified = verifyPolicyDecision(decision.record, lesson, policy, conflicting);
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/conflicting evidence/i) });
  });

  it("rejects a digest-recomputed record with insufficient evidence when the policy minimum was raised", () => {
    const lesson = lessonOf({ refs: ["evidence:verified"] });
    const policy = enabledPolicy({ minEvidence: 2 });
    // Forged record: digest recomputed over its own (fewer) bindings, ids
    // exactly matching the single resolved record — but 1 < minEvidence 2.
    const forged: PolicyDecisionRecord = {
      id: "approval:forged",
      policyVersion: policy.version,
      authority: policy.authority,
      category: "factual",
      lessonId: lesson.id,
      lessonKey: lesson.key,
      lessonPattern: lesson.pattern,
      lessonRetentionRule: lesson.retentionRule ?? "",
      lessonAuthor: lesson.author ?? "",
      evidenceIds: ["evidence:verified"],
      decision: "approved",
      digest: "",
    };
    forged.digest = decisionDigest(forged);
    const verified = verifyPolicyDecision(forged, lesson, policy, resolverOf([
      { id: "evidence:verified", kind: "verifier", lessonKey: lesson.key },
    ]));
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/insufficient|needs 2/i) });
  });

  it("rejects a digest-recomputed record with empty evidence", () => {
    const lesson = lessonOf({ refs: ["evidence:verified"] });
    const policy = enabledPolicy();
    // Forged record: digest recomputed over zero evidence ids, matching the
    // empty resolution — but 0 < minEvidence 1.
    const forged: PolicyDecisionRecord = {
      id: "approval:forged",
      policyVersion: policy.version,
      authority: policy.authority,
      category: "factual",
      lessonId: lesson.id,
      lessonKey: lesson.key,
      lessonPattern: lesson.pattern,
      lessonRetentionRule: lesson.retentionRule ?? "",
      lessonAuthor: lesson.author ?? "",
      evidenceIds: [],
      decision: "approved",
      digest: "",
    };
    forged.digest = decisionDigest(forged);
    const verified = verifyPolicyDecision(forged, lesson, policy, resolverOf([]));
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/insufficient|at least one/i) });
  });

  it("rejects a record under a disabled policy", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    const verified = verifyPolicyDecision(decision.record, lesson, defaultApprovalPolicy(), resolverOf(boundEvidence(lesson)));
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/disabled/i) });
  });

  it("rejects a record under a policy that waives the evidence minimum", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    const waived = enabledPolicy({ minEvidence: 0 });
    const verified = verifyPolicyDecision(decision.record, lesson, waived, resolverOf(boundEvidence(lesson)));
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/at least one resolved evidence/i) });
  });

  it("rejects a non-canonical padded policy authority at verification time", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    const padded = enabledPolicy({ authority: " policy:approval " });
    const verified = verifyPolicyDecision(decision.record, lesson, padded, resolverOf(boundEvidence(lesson)));
    expect(verified).toEqual({ ok: false, reason: expect.stringMatching(/canonical/i) });
  });
});

describe("approveLessonAutomatically — composes without weakening", () => {
  it("promotes an eligible factual lesson through the promotion gate", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const result = approveLessonAutomatically(lesson, classificationOf(lesson), policy, [], {
      resolveEvidence: resolverOf(boundEvidence(lesson)),
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.promotion.kind).toBe("promotion");
      expect(result.promotion.key).toBe(lesson.key);
      expect(result.promotion.lessonId).toBe(lesson.id);
      expect(result.promotion.reviewer).toBe(policy.authority);
      expect(result.promotion.approvedAt).toBe(NOW());
    }
  });

  it("promotes a persisted decision record via promoteWithPolicyDecision", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    const result = promoteWithPolicyDecision(lesson, decision.record, policy, [], {
      resolveEvidence: resolverOf(boundEvidence(lesson)),
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.promotion.reviewer).toBe(policy.authority);
  });

  it("rejects a forbidden class through the composed path", () => {
    const lesson = lessonOf({ retentionRule: FORBIDDEN_MERGE_RULE });
    const result = approveLessonAutomatically(lesson, classificationOf(lesson), enabledPolicy(), [], {
      resolveEvidence: resolverOf(boundEvidence(lesson)),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/merge/i);
  });

  it("still rejects a lesson with no identifiable author", () => {
    const lesson = lessonOf({ author: "" });
    const result = approveLessonAutomatically(lesson, classificationOf(lesson), enabledPolicy(), [], {
      resolveEvidence: resolverOf(boundEvidence(lesson)),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no identifiable author/i);
  });

  it("still rejects a policy-relaxing lesson", () => {
    const lesson = lessonOf({ retentionRule: RELAXING_RULE });
    const result = approveLessonAutomatically(lesson, classificationOf(lesson), enabledPolicy(), [], {
      resolveEvidence: resolverOf(boundEvidence(lesson)),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/relax/i);
  });

  it("still rejects an already-promoted key through evaluatePromotion", () => {
    const lesson = lessonOf();
    const prior: LearningRecord[] = [
      {
        kind: "promotion",
        id: `promotion:${lesson.id}`,
        key: lesson.key,
        lessonId: lesson.id,
        issueId: lesson.issueId,
        reviewer: "agent-b",
        approvedAt: NOW(),
      },
    ];
    const result = approveLessonAutomatically(lesson, classificationOf(lesson), enabledPolicy(), prior, {
      resolveEvidence: resolverOf(boundEvidence(lesson)),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/already promoted/i);
  });

  it("rejects forged refs through the composed path", () => {
    const lesson = lessonOf({ refs: ["evidence:verified"] });
    const result = approveLessonAutomatically(lesson, classificationOf(lesson), enabledPolicy(), [], {
      resolveEvidence: resolverOf([]),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/resolved evidence record/i);
  });

  it("rejects a forged record through promoteWithPolicyDecision", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    const forged: PolicyDecisionRecord = {
      ...decision.record,
      lessonId: "lesson:forged",
      digest: "",
    };
    const result = promoteWithPolicyDecision(lesson, forged, policy, [], {
      resolveEvidence: resolverOf(boundEvidence(lesson)),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/digest does not match/i);
  });

  it("rejects a mutated retention rule through promoteWithPolicyDecision", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    // Same id/key, but the retention rule changed to a forbidden merge after
    // the record was produced; the rejection-only re-scan must catch it.
    const mutated: LessonRecord = { ...lesson, retentionRule: FORBIDDEN_MERGE_RULE };
    const result = promoteWithPolicyDecision(mutated, decision.record, policy, [], {
      resolveEvidence: resolverOf(boundEvidence(lesson)),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/merge/i);
  });

  it("rejects a replay under a disabled policy through promoteWithPolicyDecision", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    // The operator disabled the policy after the record was produced; the
    // replay must not promote.
    const result = promoteWithPolicyDecision(lesson, decision.record, defaultApprovalPolicy(), [], {
      resolveEvidence: resolverOf(boundEvidence(lesson)),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/disabled/i);
  });

  it("rejects a non-canonical padded policy authority through promoteWithPolicyDecision", () => {
    const lesson = lessonOf();
    const policy = enabledPolicy();
    const decision = approve(lesson, classificationOf(lesson), policy, boundEvidence(lesson));
    if (decision.kind !== "approved") throw new Error(decision.reason);
    const padded = enabledPolicy({ authority: " policy:approval " });
    const result = promoteWithPolicyDecision(lesson, decision.record, padded, [], {
      resolveEvidence: resolverOf(boundEvidence(lesson)),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/canonical/i);
  });

  it("does not weaken evaluatePromotion: a raw reviewer string is not proof on its own", () => {
    const lesson = lessonOf();
    const review = { reviewer: enabledPolicy().authority, verdict: "approved" as const };
    // The operator path still requires the recurrence threshold; operator
    // approval is only reachable through a verified policy decision record.
    const direct = evaluatePromotion(lesson, review, [], { now: NOW });
    expect(direct.ok).toBe(false);
    if (!direct.ok) expect(direct.reason).toMatch(/recur/i);
  });
});
