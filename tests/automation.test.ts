import { describe, expect, it } from "vitest";
import {
  planAutomation,
  type AutomationInput,
  type AutomationIntent,
  type AutomationPlan,
} from "../lib/foundry/automation";
import {
  FORBIDDEN_ACTIONS,
  defaultImprovementState,
  type ImprovementCandidate,
  type ImprovementPolicyState,
} from "../lib/foundry/improvement-loop";
import {
  UNATTENDED_LIMIT_CAP,
  type UnattendedExclusionReason,
  type UnattendedSnapshot,
} from "../lib/foundry/unattended";
import { type Issue } from "../lib/foundry/types";

function at(minute: number): string {
  return new Date(Date.UTC(2026, 7, 25, 9, minute)).toISOString();
}

function makeIssue(overrides: Partial<Issue> & { id: string }): Issue {
  return {
    idea: "example idea",
    targetUrl: "https://example.com/repo",
    size: "m",
    currentStage: "research",
    runMode: "hitl",
    walkHold: false,
    oneshotStopReason: null,
    projectId: "project-1",
    cycleId: null,
    moduleId: null,
    createdAt: at(0),
    updatedAt: at(0),
    ...overrides,
  };
}

type SnapshotOverrides = Omit<Partial<UnattendedSnapshot>, "issue"> & { id: string; issue?: Partial<Issue> };

function makeSnapshot(overrides: SnapshotOverrides): UnattendedSnapshot {
  const { issue: issueOverrides, id, ...flags } = overrides;
  return {
    issue: makeIssue({ id, ...issueOverrides }),
    activeJob: false,
    oneshotWalking: false,
    walkHold: false,
    grillHold: false,
    unresolvedDependencies: false,
    humanGate: false,
    allowedTarget: true,
    ...flags,
  };
}

type CandidateOverrides = Omit<Partial<ImprovementCandidate>, "stage" | "action"> & {
  /** Widened to string so forbidden stages/actions are expressible. */
  stage?: string;
  action?: string;
};

function candidate(overrides: CandidateOverrides = {}): ImprovementCandidate {
  return {
    id: overrides.id ?? "cand-1",
    priority: overrides.priority ?? 10,
    createdAt: overrides.createdAt ?? "2026-08-25T00:00:00.000Z",
    stage: (overrides.stage ?? "research") as ImprovementCandidate["stage"],
    action: overrides.action ?? "research",
    proposal: overrides.proposal ?? "Apply the promoted lesson as a new research checklist item",
    lessonIds: overrides.lessonIds ?? ["lesson:task-1"],
    evidenceRefs: overrides.evidenceRefs ?? ["evt:issue-1:execute"],
    dependsOn: overrides.dependsOn ?? [],
    author: overrides.author ?? "agent-a",
    reviewer: overrides.reviewer === undefined ? "agent-b" : overrides.reviewer,
    approved: overrides.approved ?? true,
    estimatedCostUsd: overrides.estimatedCostUsd ?? 0.01,
    requiresPaidWork: overrides.requiresPaidWork ?? false,
  };
}

function plan(overrides: Partial<AutomationInput> = {}): AutomationPlan {
  return planAutomation({
    snapshots: [],
    unattendedLimit: 20,
    candidates: [],
    policy: defaultImprovementState(),
    ...overrides,
  });
}

function startIssueIds(plan: AutomationPlan): string[] {
  return plan.intents
    .filter((intent): intent is Extract<AutomationIntent, { kind: "start-issue" }> => intent.kind === "start-issue")
    .map((intent) => intent.issueId);
}

function expectOnlyExclusion(
  snapshot: UnattendedSnapshot,
  reason: UnattendedExclusionReason,
): void {
  const out = plan({ snapshots: [snapshot], candidates: [] });
  expect(out.selected).toEqual([]);
  expect(out.exclusions).toEqual([{ issueId: snapshot.issue.id, reason }]);
  expect(startIssueIds(out)).toEqual([]);
}

describe("planAutomation", () => {
  describe("composition", () => {
    it("returns selected ids, exclusions, improvement decision, and intents", () => {
      const out = plan({
        snapshots: [makeSnapshot({ id: "issue-a", issue: { createdAt: at(1) } })],
        candidates: [candidate({ id: "cand-1" })],
      });

      expect(out.selected).toEqual(["issue-a"]);
      expect(out.exclusions).toEqual([]);
      expect(out.improvement).toEqual({ kind: "start", candidateId: "cand-1", reason: "selected candidate cand-1" });
      expect(out.intents).toEqual([
        { kind: "start-issue", issueId: "issue-a" },
        { kind: "start-improvement", candidateId: "cand-1" },
      ]);
    });

    it("starts improvement work even when no issues are selected", () => {
      const out = plan({ snapshots: [], candidates: [candidate({ id: "cand-1" })] });
      expect(out.selected).toEqual([]);
      expect(out.improvement).toMatchObject({ kind: "start", candidateId: "cand-1" });
      expect(out.intents).toEqual([{ kind: "start-improvement", candidateId: "cand-1" }]);
    });

    it("surfaces issue exclusions alongside a startable improvement", () => {
      const out = plan({
        snapshots: [makeSnapshot({ id: "gate", humanGate: true })],
        candidates: [candidate({ id: "cand-1" })],
      });
      expect(out.selected).toEqual([]);
      expect(out.exclusions).toEqual([{ issueId: "gate", reason: "pending-human-gate" }]);
      expect(out.improvement).toMatchObject({ kind: "start", candidateId: "cand-1" });
      expect(out.intents).toEqual([{ kind: "start-improvement", candidateId: "cand-1" }]);
    });

    it("propagates an invalid unattended limit as a RangeError", () => {
      expect(() =>
        planAutomation({
          snapshots: [],
          unattendedLimit: 0,
          candidates: [],
          policy: defaultImprovementState(),
        }),
      ).toThrow(RangeError);
    });
  });

  describe("stable ordering", () => {
    it("selects issues oldest-first, breaking ties by id", () => {
      const out = plan({
        snapshots: [
          makeSnapshot({ id: "newest", issue: { createdAt: at(3) } }),
          makeSnapshot({ id: "oldest", issue: { createdAt: at(1) } }),
          makeSnapshot({ id: "middle", issue: { createdAt: at(2) } }),
          makeSnapshot({ id: "tie-a", issue: { createdAt: at(1) } }),
        ],
      });
      expect(out.selected).toEqual(["oldest", "tie-a", "middle", "newest"]);
      expect(startIssueIds(out)).toEqual(["oldest", "tie-a", "middle", "newest"]);
    });

    it("is independent of input order", () => {
      const snapshots = [
        makeSnapshot({ id: "a", issue: { createdAt: at(1) } }),
        makeSnapshot({ id: "b", issue: { createdAt: at(2) } }),
      ];
      const first = plan({ snapshots });
      const second = plan({ snapshots: [snapshots[1], snapshots[0]] });
      expect(second).toEqual(first);
    });

    it("reports exclusions in the same age order as selection", () => {
      const out = plan({
        snapshots: [
          makeSnapshot({ id: "safe-a", issue: { createdAt: at(1) } }),
          makeSnapshot({ id: "held", issue: { createdAt: at(0) }, walkHold: true }),
          makeSnapshot({ id: "safe-b", issue: { createdAt: at(2) } }),
          makeSnapshot({ id: "gate", issue: { createdAt: at(1) }, humanGate: true }),
        ],
      });
      expect(out.selected).toEqual(["safe-a", "safe-b"]);
      expect(out.exclusions).toEqual([
        { issueId: "held", reason: "walk-held" },
        { issueId: "gate", reason: "pending-human-gate" },
      ]);
    });

    it("carries only the candidate id in a start-improvement intent", () => {
      const out = plan({ snapshots: [], candidates: [candidate({ id: "cand-1" })] });
      expect(out.intents[0]).toEqual({ kind: "start-improvement", candidateId: "cand-1" });
      expect(Object.keys(out.intents[0]).sort()).toEqual(["candidateId", "kind"]);
    });
  });

  describe("hard cap", () => {
    it("selects at most UNATTENDED_LIMIT_CAP issues regardless of the requested limit", () => {
      const snapshots = Array.from({ length: 25 }, (_, i) =>
        makeSnapshot({ id: `issue-${i}`, issue: { createdAt: at(i) } }),
      );
      const out = plan({ snapshots, unattendedLimit: 25 });
      expect(out.selected).toHaveLength(UNATTENDED_LIMIT_CAP);
      expect(out.selected).toEqual(Array.from({ length: UNATTENDED_LIMIT_CAP }, (_, i) => `issue-${i}`));
      expect(startIssueIds(out)).toHaveLength(UNATTENDED_LIMIT_CAP);
    });

    it("respects a smaller explicit limit", () => {
      const snapshots = Array.from({ length: 5 }, (_, i) =>
        makeSnapshot({ id: `issue-${i}`, issue: { createdAt: at(i) } }),
      );
      const out = plan({ snapshots, unattendedLimit: 2 });
      expect(out.selected).toEqual(["issue-0", "issue-1"]);
    });

    it("emits at most one start-improvement intent per pass", () => {
      const out = plan({
        snapshots: Array.from({ length: 25 }, (_, i) =>
          makeSnapshot({ id: `issue-${i}`, issue: { createdAt: at(i) } }),
        ),
        candidates: [
          candidate({ id: "cand-low", priority: 5 }),
          candidate({ id: "cand-high", priority: 1 }),
        ],
      });
      const improvementStarts = out.intents.filter((intent) => intent.kind === "start-improvement");
      expect(improvementStarts).toEqual([{ kind: "start-improvement", candidateId: "cand-high" }]);
      expect(out.intents.length).toBeLessThanOrEqual(UNATTENDED_LIMIT_CAP + 1);
    });
  });

  describe("blocked gates, dependencies, and holds", () => {
    it("never selects an issue behind a pending human gate", () => {
      expectOnlyExclusion(makeSnapshot({ id: "issue-1", humanGate: true }), "pending-human-gate");
    });

    it("never selects an issue with unresolved dependencies", () => {
      expectOnlyExclusion(
        makeSnapshot({ id: "issue-1", unresolvedDependencies: true }),
        "unresolved-dependencies",
      );
    });

    it("never selects a walk-held or grill-held issue", () => {
      expectOnlyExclusion(makeSnapshot({ id: "issue-1", walkHold: true }), "walk-held");
      expectOnlyExclusion(makeSnapshot({ id: "issue-1", grillHold: true }), "grill-held");
    });

    it("never selects merge or hygiene issues", () => {
      expectOnlyExclusion(makeSnapshot({ id: "issue-1", issue: { currentStage: "merge" } }), "disallowed-stage");
      expectOnlyExclusion(makeSnapshot({ id: "issue-1", issue: { currentStage: "hygiene" } }), "disallowed-stage");
    });

    it("waits for improvement while a human gate is pending", () => {
      const out = plan({
        snapshots: [],
        candidates: [candidate({ id: "cand-1" })],
        policy: defaultImprovementState({ humanGatePending: true }),
      });
      expect(out.improvement.kind).toBe("wait");
      expect(out.intents).toEqual([{ kind: "wait", reason: expect.stringContaining("human gate") }]);
    });

    it("waits for improvement until its dependencies are available", () => {
      const blocked = plan({
        snapshots: [],
        candidates: [candidate({ id: "cand-1", dependsOn: ["lesson:task-9"] })],
      });
      expect(blocked.improvement.kind).toBe("wait");
      expect(blocked.intents).toEqual([{ kind: "wait", reason: expect.stringContaining("depends on unavailable") }]);

      const ready = plan({
        snapshots: [],
        candidates: [candidate({ id: "cand-1", dependsOn: ["lesson:task-9"] })],
        policy: defaultImprovementState({ availableRefs: new Set(["lesson:task-9"]) }),
      });
      expect(ready.improvement.kind).toBe("start");
      expect(ready.intents).toEqual([{ kind: "start-improvement", candidateId: "cand-1" }]);
    });

    it("waits for an approved review by a distinct reviewer", () => {
      const withoutReviewer = plan({ snapshots: [], candidates: [candidate({ reviewer: null })] });
      expect(withoutReviewer.improvement.kind).toBe("wait");
      expect(withoutReviewer.intents).toEqual([{ kind: "wait", reason: expect.stringContaining("independent approval") }]);

      const notApproved = plan({ snapshots: [], candidates: [candidate({ reviewer: "agent-b", approved: false })] });
      expect(notApproved.improvement.kind).toBe("wait");
    });

    it("waits for paid work that is not explicitly authorized", () => {
      const out = plan({ snapshots: [], candidates: [candidate({ requiresPaidWork: true })] });
      expect(out.improvement.kind).toBe("wait");
      expect(out.intents).toEqual([{ kind: "wait", reason: expect.stringContaining("paid work") }]);
    });

    it("stops improvement work that would relax policy", () => {
      const out = plan({
        snapshots: [],
        candidates: [candidate({ proposal: "Raise the budget ceiling so we can ship faster" })],
      });
      expect(out.improvement.kind).toBe("stop");
      expect(out.intents).toEqual([{ kind: "stop", reason: expect.stringContaining("would relax policy") }]);
    });
  });

  describe("bounded stop / wait / start decisions", () => {
    it("starts issue work when eligible issues exist", () => {
      const out = plan({ snapshots: [makeSnapshot({ id: "issue-1" })], candidates: [] });
      expect(out.intents).toContainEqual({ kind: "start-issue", issueId: "issue-1" });
    });

    it("waits when everything is blocked and nothing is startable", () => {
      const out = plan({
        snapshots: [makeSnapshot({ id: "issue-1", humanGate: true })],
        candidates: [candidate({ reviewer: null })],
      });
      expect(out.intents).toEqual([{ kind: "wait", reason: expect.stringContaining("independent approval") }]);
    });

    it("stops when there is nothing to do", () => {
      const out = plan({ snapshots: [], candidates: [] });
      expect(out.improvement.kind).toBe("stop");
      expect(out.intents).toEqual([{ kind: "stop", reason: expect.stringContaining("no improvement candidates") }]);
    });

    it("waits when issues are held and improvement has nothing to do", () => {
      const out = plan({
        snapshots: [makeSnapshot({ id: "issue-1", walkHold: true })],
        candidates: [],
      });
      expect(out.exclusions).toEqual([{ issueId: "issue-1", reason: "walk-held" }]);
      expect(out.intents).toEqual([{ kind: "wait", reason: "waiting on issue issue-1 (walk-held)" }]);
    });

    it("stops rather than waits when the only exclusions are permanent or owned elsewhere", () => {
      const out = plan({
        snapshots: [makeSnapshot({ id: "issue-1", issue: { currentStage: "intake" } })],
        candidates: [],
      });
      expect(out.exclusions).toEqual([{ issueId: "issue-1", reason: "disallowed-stage" }]);
      expect(out.intents).toEqual([{ kind: "stop", reason: "no improvement candidates" }]);
    });

    it("prefers start intents over a terminal decision while work exists", () => {
      const out = plan({
        snapshots: [makeSnapshot({ id: "issue-1" })],
        candidates: [candidate({ reviewer: null })],
      });
      expect(out.improvement.kind).toBe("wait");
      expect(out.intents).toEqual([{ kind: "start-issue", issueId: "issue-1" }]);
    });

    it("emits exactly one terminal intent when nothing is startable", () => {
      const out = plan({ snapshots: [], candidates: [candidate({ action: "merge" })] });
      const terminals = out.intents.filter((intent) => intent.kind === "wait" || intent.kind === "stop");
      expect(terminals).toHaveLength(1);
      expect(out.intents[0].kind).toBe("stop");
    });

    it("never proposes a forbidden action, even as a stop reason source", () => {
      for (const action of FORBIDDEN_ACTIONS) {
        const out = plan({ snapshots: [], candidates: [candidate({ action })] });
        expect(out.improvement.kind).toBe("stop");
        expect(out.intents.some((intent) => intent.kind === "start-improvement")).toBe(false);
      }
    });

    it("stops improvement candidates reviewed by their own author", () => {
      const out = plan({
        snapshots: [],
        candidates: [candidate({ author: "agent-a", reviewer: "agent-a" })],
      });
      expect(out.improvement.kind).toBe("stop");
      expect(out.intents).toEqual([{ kind: "stop", reason: expect.stringContaining("reviewed by its author") }]);
    });

    it("keeps the intent list bounded by the cap plus at most one improvement start", () => {
      const out = plan({
        snapshots: Array.from({ length: 30 }, (_, i) =>
          makeSnapshot({ id: `issue-${i}`, issue: { createdAt: at(i) } }),
        ),
        candidates: [candidate({ id: "cand-1" })],
      });
      expect(out.intents.length).toBeLessThanOrEqual(UNATTENDED_LIMIT_CAP + 1);
      expect(out.intents.filter((intent) => intent.kind === "start-issue")).toHaveLength(UNATTENDED_LIMIT_CAP);
    });
  });

  describe("no effects / no mutation", () => {
    it("returns only the four decision fields and no effect-bearing surface", () => {
      const out = plan({
        snapshots: [makeSnapshot({ id: "issue-1" })],
        candidates: [candidate({ id: "cand-1" })],
      });
      expect(Object.keys(out).sort()).toEqual(["exclusions", "improvement", "intents", "selected"]);

      const allowedIntentKinds = new Set(["start-issue", "start-improvement", "wait", "stop"]);
      for (const intent of out.intents) {
        expect(allowedIntentKinds.has(intent.kind)).toBe(true);
      }
      expect(["start", "wait", "stop"]).toContain(out.improvement.kind);
    });

    it("never mutates its inputs", () => {
      const snapshots = [
        makeSnapshot({ id: "a", issue: { createdAt: at(1) } }),
        makeSnapshot({ id: "b", issue: { currentStage: "grill", createdAt: at(0) } }),
        makeSnapshot({ id: "c", issue: { currentStage: "merge", createdAt: at(2) } }),
      ];
      const candidates = [candidate({ id: "cand-1" })];
      const policy: ImprovementPolicyState = defaultImprovementState();

      const snapshotsBefore = snapshots.map((s) => ({ ...s, issue: { ...s.issue } }));
      const candidatesBefore = candidates.map((item) => ({ ...item }));
      const policyBefore = { ...policy };

      for (const snapshot of snapshots) {
        Object.freeze(snapshot);
        Object.freeze(snapshot.issue);
      }
      Object.freeze(snapshots);
      Object.freeze(candidates);
      Object.freeze(candidates[0]);
      Object.freeze(policy);

      const out = planAutomation({ snapshots, unattendedLimit: 20, candidates, policy });

      expect(snapshots).toEqual(snapshotsBefore);
      expect(snapshots.map((s) => s.issue)).toEqual(snapshotsBefore.map((s) => s.issue));
      expect(candidates).toEqual(candidatesBefore);
      expect({ ...policy }).toEqual(policyBefore);
      expect(out).toEqual({
        selected: ["a"],
        exclusions: [
          { issueId: "b", reason: "disallowed-stage" },
          { issueId: "c", reason: "disallowed-stage" },
        ],
        improvement: { kind: "start", candidateId: "cand-1", reason: "selected candidate cand-1" },
        intents: [
          { kind: "start-issue", issueId: "a" },
          { kind: "start-improvement", candidateId: "cand-1" },
        ],
      });
    });

    it("is deterministic across repeated calls with the same inputs", () => {
      const snapshots = [
        makeSnapshot({ id: "a", issue: { createdAt: at(2) } }),
        makeSnapshot({ id: "b", issue: { createdAt: at(1) } }),
      ];
      const candidates = [candidate({ id: "cand-1" })];
      const policy = defaultImprovementState();
      const input = { snapshots, unattendedLimit: 20, candidates, policy };

      const first = planAutomation(input);
      const second = planAutomation(input);
      expect(second).toEqual(first);
    });

    it("does not invoke workers or answer gates (decisions only)", () => {
      const out = plan({
        snapshots: [makeSnapshot({ id: "issue-1", humanGate: true })],
        candidates: [],
      });
      // A pending gate is surfaced as an exclusion and a terminal wait, never
      // as a start intent or a gate answer.
      expect(out.exclusions).toEqual([{ issueId: "issue-1", reason: "pending-human-gate" }]);
      expect(out.intents.every((intent) => intent.kind === "start-issue")).toBe(false);
      expect(out.intents).toEqual([{ kind: "wait", reason: "waiting on issue issue-1 (pending-human-gate)" }]);
    });
  });
});
