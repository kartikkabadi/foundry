import { describe, expect, it } from "vitest";
import {
  AutomationDriverError,
  noLeaseGuard,
  runAutomationDriver,
  type AutomationDriverEffects,
  type AutomationDriverResult,
  type AutomationIntentOutcome,
} from "../lib/foundry/automation-driver";
import {
  planAutomation,
  type AutomationInput,
  type AutomationIntent,
  type AutomationPlan,
} from "../lib/foundry/automation";
import {
  defaultImprovementState,
  type ImprovementCandidate,
  type ImprovementPolicyState,
} from "../lib/foundry/improvement-loop";
import { UNATTENDED_LIMIT_CAP, type UnattendedSnapshot } from "../lib/foundry/unattended";
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

function candidate(overrides: Partial<ImprovementCandidate> = {}): ImprovementCandidate {
  return {
    id: "cand-1",
    priority: 10,
    createdAt: "2026-08-25T00:00:00.000Z",
    stage: "research",
    action: "research",
    proposal: "Apply the promoted lesson as a new research checklist item",
    lessonIds: ["lesson:task-1"],
    evidenceRefs: ["evt:issue-1:execute"],
    dependsOn: [],
    author: "agent-a",
    reviewer: "agent-b",
    approved: true,
    estimatedCostUsd: 0.01,
    requiresPaidWork: false,
    ...overrides,
  };
}

function input(overrides: Partial<AutomationInput> = {}): AutomationInput {
  return {
    snapshots: [],
    unattendedLimit: UNATTENDED_LIMIT_CAP,
    candidates: [],
    policy: defaultImprovementState(),
    ...overrides,
  };
}

/** Wire recording effects around the driver; per-test overrides win. */
function harness(overrides: Partial<AutomationDriverEffects> = {}): {
  effects: AutomationDriverEffects;
  startedIssues: string[];
  startedCandidates: string[];
  audited: AutomationIntentOutcome[];
  run: (input: AutomationInput) => Promise<AutomationDriverResult>;
} {
  const startedIssues: string[] = [];
  const startedCandidates: string[] = [];
  const audited: AutomationIntentOutcome[] = [];
  const effects: AutomationDriverEffects = {
    startIssue: (issueId, guard) => {
      guard.run(() => {
        startedIssues.push(issueId);
      });
    },
    startImprovement: (candidateId, guard) => {
      guard.run(() => {
        startedCandidates.push(candidateId);
      });
    },
    audit: (outcome) => {
      audited.push(outcome);
    },
    ...overrides,
  };
  return {
    effects,
    startedIssues,
    startedCandidates,
    audited,
    run: (runInput) => runAutomationDriver(runInput, effects, noLeaseGuard()),
  };
}

function startIssueIntents(issueIds: string[]): AutomationIntent[] {
  return issueIds.map((issueId) => ({ kind: "start-issue" as const, issueId }));
}

function planWith(intents: AutomationIntent[]): AutomationPlan {
  return {
    selected: [],
    exclusions: [],
    improvement: { kind: "stop", reason: "custom test planner" },
    intents,
  };
}

describe("runAutomationDriver", () => {
  describe("ordering", () => {
    it("applies start intents strictly in plan order and audits in the same order", async () => {
      const h = harness();
      const out = await h.run(
        input({
          snapshots: [
            makeSnapshot({ id: "issue-c", issue: { createdAt: at(3) } }),
            makeSnapshot({ id: "issue-a", issue: { createdAt: at(1) } }),
            makeSnapshot({ id: "issue-b", issue: { createdAt: at(2) } }),
          ],
          candidates: [candidate({ id: "cand-1" })],
        }),
      );

      expect(h.startedIssues).toEqual(["issue-a", "issue-b", "issue-c"]);
      expect(h.startedCandidates).toEqual(["cand-1"]);
      expect(out.results).toEqual([
        { kind: "start-issue", issueId: "issue-a", status: "succeeded" },
        { kind: "start-issue", issueId: "issue-b", status: "succeeded" },
        { kind: "start-issue", issueId: "issue-c", status: "succeeded" },
        { kind: "start-improvement", candidateId: "cand-1", status: "succeeded" },
      ]);
      expect(h.audited).toEqual(out.results);
    });

    it("awaits each effect before starting the next intent", async () => {
      const order: string[] = [];
      let afterFirst = false;
      const effects: AutomationDriverEffects = {
        startIssue: async (issueId) => {
          if (issueId === "issue-a") {
            order.push("a-begin");
            await Promise.resolve();
            afterFirst = true;
            order.push("a-end");
            return;
          }
          order.push(`b-${afterFirst ? "after-a" : "before-a"}`);
        },
        startImprovement: () => {
          order.push("improve");
        },
        audit: () => {
          order.push("audit");
        },
      };

      await runAutomationDriver(
        input({
          snapshots: [
            makeSnapshot({ id: "issue-a", issue: { createdAt: at(1) } }),
            makeSnapshot({ id: "issue-b", issue: { createdAt: at(2) } }),
          ],
        }),
        effects,
        noLeaseGuard(),
      );

      // The audit for intent a runs before start b, proving strict sequencing.
      expect(order).toEqual(["a-begin", "a-end", "audit", "b-after-a", "audit"]);
    });

    it("calls the planner exactly once per pass", async () => {
      const h = harness();
      let plannerCalls = 0;
      const planner = (planInput: AutomationInput): AutomationPlan => {
        plannerCalls += 1;
        return planAutomation(planInput);
      };
      await runAutomationDriver(
        input({
          snapshots: Array.from({ length: 3 }, (_, i) =>
            makeSnapshot({ id: `issue-${i}`, issue: { createdAt: at(i) } }),
          ),
        }),
        h.effects,
        noLeaseGuard(),
        { planner },
      );
      expect(plannerCalls).toBe(1);
    });
  });

  describe("max bound", () => {
    it("starts at most UNATTENDED_LIMIT_CAP issues from the default planner", async () => {
      const h = harness();
      const out = await h.run(
        input({
          snapshots: Array.from({ length: 25 }, (_, i) =>
            makeSnapshot({ id: `issue-${i}`, issue: { createdAt: at(i) } }),
          ),
          unattendedLimit: 25,
        }),
      );

      expect(h.startedIssues).toHaveLength(UNATTENDED_LIMIT_CAP);
      expect(h.startedIssues).toEqual(Array.from({ length: UNATTENDED_LIMIT_CAP }, (_, i) => `issue-${i}`));
      expect(out.failedStarts).toBe(0);
    });

    it("fails closed before any effect when a planner exceeds the bound", async () => {
      const h = harness();
      const over = startIssueIntents(Array.from({ length: UNATTENDED_LIMIT_CAP + 1 }, (_, i) => `issue-${i}`));
      const planner = () => planWith(over);

      await expect(
        runAutomationDriver(input(), h.effects, noLeaseGuard(), { planner }),
      ).rejects.toThrow(AutomationDriverError);

      expect(h.startedIssues).toEqual([]);
      expect(h.startedCandidates).toEqual([]);
      expect(h.audited).toEqual([]);
    });
  });

  describe("duplicate rejection", () => {
    it("fails closed before any effect on a duplicate start-issue id", async () => {
      const h = harness();
      const planner = () => planWith(startIssueIntents(["issue-a", "issue-a"]));

      await expect(
        runAutomationDriver(input(), h.effects, noLeaseGuard(), { planner }),
      ).rejects.toThrow(/duplicate start-issue intent for issue-a/);

      expect(h.startedIssues).toEqual([]);
      expect(h.startedCandidates).toEqual([]);
      expect(h.audited).toEqual([]);
    });
  });

  describe("effect failure isolation", () => {
    it("fails only the throwing intent and continues with the rest", async () => {
      const h = harness({
        startIssue: (issueId, guard) => {
          if (issueId === "issue-b") {
            throw new Error("store rejected start");
          }
          guard.run(() => {
            h.startedIssues.push(issueId);
          });
        },
      });
      const out = await h.run(
        input({
          snapshots: [
            makeSnapshot({ id: "issue-a", issue: { createdAt: at(1) } }),
            makeSnapshot({ id: "issue-b", issue: { createdAt: at(2) } }),
            makeSnapshot({ id: "issue-c", issue: { createdAt: at(3) } }),
          ],
        }),
      );

      expect(h.startedIssues).toEqual(["issue-a", "issue-c"]);
      expect(out.failedStarts).toBe(1);
      expect(out.results).toEqual([
        { kind: "start-issue", issueId: "issue-a", status: "succeeded" },
        { kind: "start-issue", issueId: "issue-b", status: "failed", error: "store rejected start" },
        { kind: "start-issue", issueId: "issue-c", status: "succeeded" },
      ]);
      expect(h.audited).toEqual(out.results);
    });

    it("fails only the throwing intent for async rejections too", async () => {
      const h = harness({
        startImprovement: async (candidateId) => {
          await Promise.reject(new Error(`cannot start ${candidateId}`));
        },
      });
      const out = await h.run(input({ candidates: [candidate({ id: "cand-1" })] }));

      expect(out.failedStarts).toBe(1);
      expect(out.startedCandidateId).toBeNull();
      expect(out.results).toEqual([
        { kind: "start-improvement", candidateId: "cand-1", status: "failed", error: "cannot start cand-1" },
      ]);
    });

    it("keeps running even when the audit sink throws", async () => {
      const h = harness({
        audit: (outcome) => {
          if (outcome.kind === "start-issue" && outcome.issueId === "issue-b") {
            throw new Error("log sink down");
          }
          h.audited.push(outcome);
        },
      });
      const out = await h.run(
        input({
          snapshots: [
            makeSnapshot({ id: "issue-a", issue: { createdAt: at(1) } }),
            makeSnapshot({ id: "issue-b", issue: { createdAt: at(2) } }),
            makeSnapshot({ id: "issue-c", issue: { createdAt: at(3) } }),
          ],
        }),
      );

      expect(h.startedIssues).toEqual(["issue-a", "issue-b", "issue-c"]);
      expect(out.results).toHaveLength(3);
      // The outcome for issue-b is still recorded even though its audit write threw.
      expect(out.results.map((r) => (r.kind === "start-issue" ? r.issueId : null))).toEqual([
        "issue-a",
        "issue-b",
        "issue-c",
      ]);
      expect(h.audited.map((r) => (r.kind === "start-issue" ? r.issueId : null))).toEqual(["issue-a", "issue-c"]);
    });
  });

  describe("wait and stop are audit-only", () => {
    it("never invokes a start effect for a wait intent", async () => {
      const h = harness();
      const out = await h.run(
        input({
          snapshots: [makeSnapshot({ id: "issue-1", humanGate: true })],
          candidates: [candidate({ reviewer: null })],
        }),
      );

      expect(out.results).toEqual([{ kind: "wait", reason: expect.stringContaining("independent approval") }]);
      expect(h.audited).toEqual([{ kind: "wait", reason: expect.stringContaining("independent approval") }]);
      expect(h.startedIssues).toEqual([]);
      expect(h.startedCandidates).toEqual([]);
    });

    it("never invokes a start effect for a stop intent", async () => {
      const h = harness();
      const out = await h.run(input());

      expect(out.results).toEqual([{ kind: "stop", reason: expect.stringContaining("no improvement candidates") }]);
      expect(h.audited).toEqual([{ kind: "stop", reason: expect.stringContaining("no improvement candidates") }]);
      expect(h.startedIssues).toEqual([]);
      expect(h.startedCandidates).toEqual([]);
    });

    it("audits an explicit wait from a custom planner without any start effect", async () => {
      const h = harness();
      const planner = () => planWith([{ kind: "wait", reason: "host busy" }]);
      const out = await runAutomationDriver(input(), h.effects, noLeaseGuard(), { planner });

      expect(out.results).toEqual([{ kind: "wait", reason: "host busy" }]);
      expect(h.audited).toEqual([{ kind: "wait", reason: "host busy" }]);
      expect(h.startedIssues).toEqual([]);
      expect(h.startedCandidates).toEqual([]);
    });
  });

  describe("missing start effects", () => {
    it("fails a start-improvement intent closed when no improvement effect is injected", async () => {
      const h = harness();
      const out = await runAutomationDriver(
        input({
          snapshots: [makeSnapshot({ id: "issue-a", issue: { createdAt: at(1) } })],
          candidates: [candidate({ id: "cand-1" })],
        }),
        { startIssue: h.effects.startIssue, audit: h.effects.audit },
        noLeaseGuard(),
      );

      expect(h.startedIssues).toEqual(["issue-a"]);
      expect(h.startedCandidates).toEqual([]);
      expect(out.failedStarts).toBe(1);
      expect(out.results).toEqual([
        { kind: "start-issue", issueId: "issue-a", status: "succeeded" },
        { kind: "start-improvement", candidateId: "cand-1", status: "failed", error: "no startImprovement effect injected" },
      ]);
    });

    it("fails a start-issue intent closed when no issue effect is injected", async () => {
      const h = harness();
      const out = await runAutomationDriver(
        input({
          snapshots: [makeSnapshot({ id: "issue-a", issue: { createdAt: at(1) } })],
          candidates: [candidate({ id: "cand-1" })],
        }),
        { startImprovement: h.effects.startImprovement, audit: h.effects.audit },
        noLeaseGuard(),
      );

      expect(h.startedIssues).toEqual([]);
      expect(h.startedCandidates).toEqual(["cand-1"]);
      expect(out.failedStarts).toBe(1);
      expect(out.results).toEqual([
        { kind: "start-issue", issueId: "issue-a", status: "failed", error: "no startIssue effect injected" },
        { kind: "start-improvement", candidateId: "cand-1", status: "succeeded" },
      ]);
    });
  });

  describe("unchanged input", () => {
    it("never mutates the injected input", async () => {
      const h = harness();
      const snapshots = [
        makeSnapshot({ id: "issue-a", issue: { createdAt: at(1) } }),
        makeSnapshot({ id: "issue-b", issue: { currentStage: "grill", createdAt: at(0) } }),
        makeSnapshot({ id: "issue-c", issue: { currentStage: "merge", createdAt: at(2) } }),
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

      const out = await h.run(input({ snapshots, candidates, policy }));

      expect(snapshots).toEqual(snapshotsBefore);
      expect(snapshots.map((s) => s.issue)).toEqual(snapshotsBefore.map((s) => s.issue));
      expect(candidates).toEqual(candidatesBefore);
      expect({ ...policy }).toEqual(policyBefore);
      expect(out.results).toEqual([
        { kind: "start-issue", issueId: "issue-a", status: "succeeded" },
        { kind: "start-improvement", candidateId: "cand-1", status: "succeeded" },
      ]);
    });
  });
});
