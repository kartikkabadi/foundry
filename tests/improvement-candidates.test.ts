import { describe, expect, it } from "vitest";
import {
  deriveImprovementCandidates,
  type CandidateExclusionReason,
  type ImprovementProposal,
} from "../lib/foundry/improvement-candidates";
import {
  FORBIDDEN_ACTIONS,
  IMPROVEMENT_STAGES,
  type ImprovementCandidate,
} from "../lib/foundry/improvement-loop";
import { type LearningRecord, type LessonRecord, type PromotionRecord } from "../lib/foundry/learning";

const NOW = "2026-08-25T00:00:00.000Z";

const STRONG_PATTERN =
  "Always verify that a released change passes the package tests before merge";

const LESSON_ID = "lesson:task-1";
const PROMOTION_ID = "promotion:lesson:task-1";

function lesson(overrides: Partial<LessonRecord> = {}): LessonRecord {
  return {
    kind: "lesson",
    id: LESSON_ID,
    key: "lesson-key",
    taskId: "task-1",
    issueId: "issue-1",
    stage: "execute",
    outcome: "succeeded",
    pattern: STRONG_PATTERN,
    retentionRule: STRONG_PATTERN,
    refs: ["run/abc/attempt-1", "evidence:verified"],
    author: "agent-a",
    proposedAt: NOW,
    ...overrides,
  };
}

function promotion(overrides: Partial<PromotionRecord> = {}): PromotionRecord {
  return {
    kind: "promotion",
    id: PROMOTION_ID,
    key: "lesson-key",
    lessonId: LESSON_ID,
    issueId: "issue-1",
    reviewer: "agent-b",
    approvedAt: NOW,
    ...overrides,
  };
}

function proposal(overrides: Partial<ImprovementProposal> = {}): ImprovementProposal {
  return {
    id: "cand-1",
    promotionId: PROMOTION_ID,
    stage: "research",
    action: "research",
    reviewer: "agent-b",
    approved: true,
    estimatedCostUsd: 0.05,
    ...overrides,
  };
}

function derive(
  overrides: { records?: LearningRecord[]; proposals?: ImprovementProposal[] } = {},
): { candidates: ImprovementCandidate[]; exclusions: { proposalId: string; reason: CandidateExclusionReason }[] } {
  return deriveImprovementCandidates(
    overrides.records ?? [lesson(), promotion()],
    overrides.proposals ?? [proposal()],
  );
}

function onlyExclusion(
  reason: CandidateExclusionReason,
  overrides: { records?: LearningRecord[]; proposals?: ImprovementProposal[] } = {},
): void {
  const out = derive(overrides);
  expect(out.candidates).toEqual([]);
  expect(out.exclusions).toEqual([{ proposalId: overrides.proposals?.[0]?.id ?? "cand-1", reason }]);
}

describe("deriveImprovementCandidates", () => {
  describe("valid derivation", () => {
    it("derives a candidate from a promoted lesson plus explicit proposal metadata", () => {
      const out = derive();
      expect(out.exclusions).toEqual([]);
      expect(out.candidates).toHaveLength(1);
      expect(out.candidates[0]).toEqual({
        id: "cand-1",
        priority: 10,
        createdAt: NOW,
        stage: "research",
        action: "research",
        proposal: STRONG_PATTERN,
        lessonIds: [LESSON_ID],
        evidenceRefs: ["run/abc/attempt-1", "evidence:verified"],
        dependsOn: [],
        author: "agent-a",
        reviewer: "agent-b",
        approved: true,
        estimatedCostUsd: 0.05,
        requiresPaidWork: false,
      });
    });

    it("defaults the proposal text and aging timestamp to the lesson and promotion", () => {
      const out = derive({ proposals: [proposal({ proposal: undefined, createdAt: undefined })] });
      expect(out.candidates[0].proposal).toBe(STRONG_PATTERN);
      expect(out.candidates[0].createdAt).toBe(promotion().approvedAt);
    });

    it("honors explicit metadata overrides and merges covered evidence refs", () => {
      const out = derive({
        records: [lesson({ refs: ["run/abc/attempt-1", "evidence:verified", "artifact:extra-1"] }), promotion()],
        proposals: [
          proposal({
            id: "cand-explicit",
            priority: 1,
            createdAt: "2026-08-20T00:00:00.000Z",
            proposal: "Add a lint rule that rejects unverified merges",
            evidenceRefs: ["artifact:extra-1"],
            dependsOn: [LESSON_ID],
            reviewer: "agent-b",
            requiresPaidWork: true,
            estimatedCostUsd: 2.5,
          }),
        ],
      });
      expect(out.candidates).toHaveLength(1);
      expect(out.candidates[0]).toMatchObject({
        id: "cand-explicit",
        priority: 1,
        createdAt: "2026-08-20T00:00:00.000Z",
        proposal: "Add a lint rule that rejects unverified merges",
        lessonIds: [LESSON_ID],
        evidenceRefs: ["run/abc/attempt-1", "evidence:verified", "artifact:extra-1"],
        dependsOn: [LESSON_ID],
        author: "agent-a",
        reviewer: "agent-b",
        requiresPaidWork: true,
        estimatedCostUsd: 2.5,
      });
    });
  });

  describe("linked lesson/promotion exclusions", () => {
    it("excludes a proposal whose referenced promotion does not exist (unpromoted lesson)", () => {
      onlyExclusion("unpromoted-lesson", {
        records: [lesson()],
        proposals: [proposal({ id: "cand-unpromoted", promotionId: "promotion:missing" })],
      });
    });

    it("excludes a proposal whose promotion links a missing lesson (orphan promotion)", () => {
      onlyExclusion("orphan-promotion", {
        records: [promotion({ lessonId: "lesson:missing" })],
        proposals: [proposal({ id: "cand-orphan" })],
      });
    });

    it("excludes a proposal with a blank id", () => {
      const out = derive({ proposals: [proposal({ id: "   " })] });
      expect(out.candidates).toEqual([]);
      expect(out.exclusions).toEqual([{ proposalId: "", reason: "unidentified-proposal" }]);
    });

    it("rejects a lesson that carries no author even when a reviewer is identified", () => {
      onlyExclusion("authorless-lesson", {
        records: [lesson({ author: null }), promotion()],
      });
    });

    it("rejects a promotion whose stable key does not match the lesson's key", () => {
      onlyExclusion("inconsistent-promotion", {
        records: [lesson(), promotion({ key: "forged-key" })],
      });
    });

    it("rejects a promotion whose lesson carries no evidence refs", () => {
      onlyExclusion("unbacked-promotion", {
        records: [lesson({ refs: [] }), promotion()],
      });
    });
  });

  describe("independent reviewer exclusions", () => {
    it("excludes a proposal reviewed by the lesson author", () => {
      onlyExclusion("self-review", {
        proposals: [proposal({ reviewer: "agent-a" })],
      });
    });

    it("excludes a proposal whose reviewer is not identified", () => {
      onlyExclusion("unidentified-reviewer", {
        proposals: [proposal({ reviewer: "   " })],
      });
    });

    it("excludes a proposal whose reviewer is not the promotion's approved reviewer", () => {
      onlyExclusion("reviewer-mismatch", {
        proposals: [proposal({ reviewer: "agent-c" })],
      });
    });
  });

  describe("evidence authority exclusions", () => {
    it("excludes a proposal citing a ref not covered by the lesson's refs", () => {
      onlyExclusion("forged-evidence", {
        proposals: [proposal({ evidenceRefs: ["artifact:smuggled"] })],
      });
    });

    it("excludes a proposal whose refs include an empty or blank string", () => {
      onlyExclusion("forged-evidence", {
        proposals: [proposal({ evidenceRefs: ["", "evidence:verified"] })],
      });
    });
  });

  describe("allowed stage/action and finite cost exclusions", () => {
    it("excludes a proposal targeting a disallowed stage", () => {
      onlyExclusion("disallowed-stage", {
        proposals: [proposal({ stage: "merge" })],
      });
    });

    it("excludes every forbidden action", () => {
      for (const action of FORBIDDEN_ACTIONS) {
        onlyExclusion("forbidden-action", {
          proposals: [proposal({ id: `cand-${action}`, action })],
        });
      }
    });

    it("excludes a proposal whose cost is not finite and positive", () => {
      onlyExclusion("non-finite-cost", { proposals: [proposal({ estimatedCostUsd: Number.NaN })] });
      onlyExclusion("non-finite-cost", { proposals: [proposal({ estimatedCostUsd: 0 })] });
      onlyExclusion("non-finite-cost", { proposals: [proposal({ estimatedCostUsd: -1 })] });
      onlyExclusion("non-finite-cost", {
        proposals: [proposal({ estimatedCostUsd: Number.POSITIVE_INFINITY })],
      });
    });
  });

  describe("dedupe and order", () => {
    it("derives one candidate per unique id and excludes later duplicates", () => {
      const out = derive({
        proposals: [
          proposal({ id: "cand-dup", priority: 5 }),
          proposal({ id: "cand-dup", priority: 1 }),
          proposal({ id: "cand-other" }),
        ],
      });
      expect(out.candidates).toHaveLength(2);
      // The higher-priority (lower number) duplicate wins the id.
      expect(out.candidates.map((candidate) => candidate.id)).toEqual(["cand-dup", "cand-other"]);
      expect(out.candidates[0].priority).toBe(1);
      expect(out.exclusions).toEqual([{ proposalId: "cand-dup", reason: "duplicate-candidate" }]);
    });

    it("orders candidates by priority, then age, then id", () => {
      const out = derive({
        proposals: [
          proposal({ id: "cand-late", priority: 10, createdAt: "2026-08-21T00:00:00.000Z" }),
          proposal({ id: "cand-high", priority: 1, createdAt: "2026-08-22T00:00:00.000Z" }),
          proposal({ id: "cand-tie-b", priority: 5, createdAt: "2026-08-23T00:00:00.000Z" }),
          proposal({ id: "cand-tie-a", priority: 5, createdAt: "2026-08-23T00:00:00.000Z" }),
        ],
      });
      expect(out.candidates.map((candidate) => candidate.id)).toEqual([
        "cand-high",
        "cand-tie-a",
        "cand-tie-b",
        "cand-late",
      ]);
    });

    it("is independent of the input proposal order", () => {
      const proposals = [
        proposal({ id: "cand-a", priority: 10, createdAt: "2026-08-21T00:00:00.000Z" }),
        proposal({ id: "cand-b", priority: 1, createdAt: "2026-08-20T00:00:00.000Z" }),
      ];
      const first = derive({ proposals });
      const second = derive({ proposals: [proposals[1], proposals[0]] });
      expect(second).toEqual(first);
    });
  });

  describe("no inferred approval and no mutation", () => {
    it("never infers approval from the promotion's approved review", () => {
      const out = derive({ proposals: [proposal({ approved: false })] });
      expect(out.candidates).toHaveLength(1);
      expect(out.candidates[0].approved).toBe(false);
    });

    it("returns only the derivation fields and never mutates its inputs", () => {
      const records: LearningRecord[] = [lesson(), promotion()];
      const proposals: ImprovementProposal[] = [proposal()];
      const recordsBefore = records.map((record) => ({ ...record }));
      const proposalsBefore = proposals.map((item) => ({ ...item }));

      for (const record of records) Object.freeze(record);
      for (const proposalItem of proposals) Object.freeze(proposalItem);
      Object.freeze(records);
      Object.freeze(proposals);

      const out = deriveImprovementCandidates(records, proposals);

      expect(records).toEqual(recordsBefore);
      expect(proposals).toEqual(proposalsBefore);
      expect(Object.keys(out).sort()).toEqual(["candidates", "exclusions"]);
      expect(out.candidates).toHaveLength(1);
      expect(out.exclusions).toEqual([]);
    });

    it("is deterministic across repeated calls with the same inputs", () => {
      const records = [lesson(), promotion()];
      const proposals = [proposal({ id: "cand-a" }), proposal({ id: "cand-b" })];
      const first = deriveImprovementCandidates(records, proposals);
      const second = deriveImprovementCandidates(records, proposals);
      expect(second).toEqual(first);
    });

    it("deep-clones candidate arrays so mutating output cannot mutate inputs", () => {
      const records: LearningRecord[] = [lesson(), promotion()];
      const proposals: ImprovementProposal[] = [
        proposal({ dependsOn: [LESSON_ID], evidenceRefs: ["evidence:verified"] }),
      ];
      const out = deriveImprovementCandidates(records, proposals);
      expect(out.candidates).toHaveLength(1);

      const candidate = out.candidates[0];
      candidate.evidenceRefs.push("mutated-evidence");
      candidate.dependsOn.push("mutated-depends-on");
      candidate.lessonIds.push("mutated-lesson");
      candidate.proposal = "mutated-proposal";
      out.candidates.push({ ...candidate });
      out.exclusions.push({ proposalId: "mutated-exclusion", reason: "self-review" });

      const lessonRecord = records.find((record): record is LessonRecord => record.kind === "lesson");
      expect(lessonRecord?.refs).toEqual(["run/abc/attempt-1", "evidence:verified"]);
      expect(proposals[0].dependsOn).toEqual([LESSON_ID]);
      expect(proposals[0].evidenceRefs).toEqual(["evidence:verified"]);
      expect(lessonRecord?.retentionRule).toBe(STRONG_PATTERN);
    });

    it("does not alias the exclusion or candidates arrays to inputs", () => {
      const records: LearningRecord[] = [lesson(), promotion()];
      const proposals: ImprovementProposal[] = [proposal({ id: "cand-x" })];
      const out = deriveImprovementCandidates(records, proposals);
      expect(out.candidates).not.toBe(proposals);
      out.candidates[0].proposal = "mutated";
      out.exclusions.push({ proposalId: "mutated", reason: "forged-evidence" });
      expect(proposals[0]).toEqual(
        expect.objectContaining({
          id: "cand-x",
          reviewer: "agent-b",
          approved: true,
        }),
      );
    });
  });
});
