import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_ACTIONS,
  decideImprovement,
  defaultImprovementState,
  type ImprovementCandidate,
  type ImprovementPolicyState,
} from "../lib/foundry/improvement-loop";

type CandidateOverrides = Omit<Partial<ImprovementCandidate>, "stage" | "action"> & {
  /** Widened to string so forbidden stages/actions are expressible. */
  stage?: string;
  action?: string;
};

let nextId = 0;

function candidate(overrides: CandidateOverrides = {}): ImprovementCandidate {
  return {
    id: overrides.id ?? `cand-${++nextId}`,
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

describe("decideImprovement", () => {
  it("stops when there is no work to do", () => {
    const decision = decideImprovement([], defaultImprovementState());
    expect(decision.kind).toBe("stop");
    expect(decision.reason).toContain("no improvement candidates");
  });

  it("stops once the iteration bound is reached", () => {
    const decision = decideImprovement(
      [candidate()],
      defaultImprovementState({ maxIterations: 3, iterationsUsed: 3 }),
    );
    expect(decision.kind).toBe("stop");
    expect(decision.reason).toContain("iteration bound");
  });

  it("stops when the spend budget is already exhausted", () => {
    const decision = decideImprovement(
      [candidate()],
      defaultImprovementState({ maxCostUsd: 1, spentCostUsd: 1 }),
    );
    expect(decision.kind).toBe("stop");
    expect(decision.reason).toContain("budget exhausted");
  });

  it("stops when the top candidate would exceed the remaining budget", () => {
    const decision = decideImprovement(
      [candidate({ estimatedCostUsd: 0.01 })],
      defaultImprovementState({ maxCostUsd: 0.02, spentCostUsd: 0.015 }),
    );
    expect(decision.kind).toBe("stop");
    expect(decision.reason).toContain("remaining budget");
  });

  it("stops when a candidate exceeds the per-candidate ceiling", () => {
    const decision = decideImprovement(
      [candidate({ estimatedCostUsd: 0.1 })],
      defaultImprovementState({ perCandidateCeilingUsd: 0.05 }),
    );
    expect(decision.kind).toBe("stop");
    expect(decision.reason).toContain("per-candidate ceiling");
  });

  it("waits while a human gate is pending", () => {
    const decision = decideImprovement(
      [candidate()],
      defaultImprovementState({ humanGatePending: true }),
    );
    expect(decision.kind).toBe("wait");
    expect(decision.reason).toContain("human gate");
  });

  it("stops on a candidate reviewed by its own author", () => {
    const decision = decideImprovement(
      [candidate({ author: "agent-a", reviewer: "agent-a" })],
      defaultImprovementState(),
    );
    expect(decision.kind).toBe("stop");
    expect(decision.reason).toContain("reviewed by its author");
  });

  it("waits for an approved review by a distinct reviewer", () => {
    const withoutReviewer = decideImprovement(
      [candidate({ reviewer: null })],
      defaultImprovementState(),
    );
    expect(withoutReviewer.kind).toBe("wait");
    expect(withoutReviewer.reason).toContain("independent approval");

    const notApproved = decideImprovement(
      [candidate({ reviewer: "agent-b", approved: false })],
      defaultImprovementState(),
    );
    expect(notApproved.kind).toBe("wait");
    expect(notApproved.reason).toContain("independent approval");
  });

  it("stops on a candidate whose proposal relaxes policy", () => {
    const decision = decideImprovement(
      [candidate({ proposal: "Raise the budget ceiling so we can ship faster" })],
      defaultImprovementState(),
    );
    expect(decision.kind).toBe("stop");
    expect(decision.reason).toContain("would relax policy");
  });

  it("stops on a candidate targeting a forbidden stage", () => {
    const decision = decideImprovement([candidate({ stage: "merge" })], defaultImprovementState());
    expect(decision.kind).toBe("stop");
    expect(decision.reason).toContain("forbidden stage merge");
  });

  it("stops on a candidate proposing a forbidden action", () => {
    for (const action of FORBIDDEN_ACTIONS) {
      const decision = decideImprovement([candidate({ action })], defaultImprovementState());
      expect(decision.kind).toBe("stop");
      expect(decision.reason).toContain("forbidden action");
    }
  });

  it("stops on a candidate with no backing lesson or evidence refs", () => {
    const decision = decideImprovement(
      [candidate({ lessonIds: [], evidenceRefs: [] })],
      defaultImprovementState(),
    );
    expect(decision.kind).toBe("stop");
    expect(decision.reason).toContain("not evidence-backed");
  });

  it("stops on a candidate without a finite positive estimated cost", () => {
    expect(decideImprovement([candidate({ estimatedCostUsd: 0 })], defaultImprovementState()).kind).toBe("stop");
    expect(decideImprovement([candidate({ estimatedCostUsd: Number.NaN })], defaultImprovementState()).kind).toBe("stop");
  });

  it("waits until a candidate's dependencies are available", () => {
    const pending = decideImprovement(
      [candidate({ dependsOn: ["lesson:task-9"] })],
      defaultImprovementState(),
    );
    expect(pending.kind).toBe("wait");
    expect(pending.reason).toContain("depends on unavailable lesson:task-9");

    const ready = decideImprovement(
      [candidate({ dependsOn: ["lesson:task-9"] })],
      defaultImprovementState({ availableRefs: new Set(["lesson:task-9"]) }),
    );
    expect(ready.kind).toBe("start");
  });

  it("waits for paid work that is not explicitly authorized", () => {
    const denied = decideImprovement(
      [candidate({ requiresPaidWork: true })],
      defaultImprovementState(),
    );
    expect(denied.kind).toBe("wait");
    expect(denied.reason).toContain("paid work");

    const allowed = decideImprovement(
      [candidate({ requiresPaidWork: true })],
      defaultImprovementState({ paidAuthorization: true }),
    );
    expect(allowed.kind).toBe("start");
  });

  it("stops on a non-finite or negative policy field", () => {
    expect(decideImprovement([candidate()], defaultImprovementState({ maxIterations: -1 })).kind).toBe("stop");
    expect(
      decideImprovement([candidate()], defaultImprovementState({ maxCostUsd: Number.POSITIVE_INFINITY })).kind,
    ).toBe("stop");
    expect(
      decideImprovement([candidate()], defaultImprovementState({ perCandidateCeilingUsd: Number.NaN })).kind,
    ).toBe("stop");
  });

  it("selects the highest-priority candidate regardless of input order", () => {
    const state = defaultImprovementState();
    const high = candidate({ id: "prio-high", priority: 1 });
    const low = candidate({ id: "prio-low", priority: 5 });

    expect(decideImprovement([low, high], state)).toMatchObject({ kind: "start", candidateId: "prio-high" });
    expect(decideImprovement([high, low], state)).toMatchObject({ kind: "start", candidateId: "prio-high" });
  });

  it("breaks priority ties on age, then id", () => {
    const state = defaultImprovementState();
    const older = candidate({ id: "cand-b", priority: 2, createdAt: "2026-08-20T00:00:00.000Z" });
    const newer = candidate({ id: "cand-a", priority: 2, createdAt: "2026-08-25T00:00:00.000Z" });
    expect(decideImprovement([newer, older], state)).toMatchObject({ kind: "start", candidateId: "cand-b" });

    const firstId = candidate({ id: "cand-b", priority: 2, createdAt: "2026-08-22T00:00:00.000Z" });
    const secondId = candidate({ id: "cand-a", priority: 2, createdAt: "2026-08-22T00:00:00.000Z" });
    expect(decideImprovement([firstId, secondId], state)).toMatchObject({ kind: "start", candidateId: "cand-a" });
  });

  it("starts a valid top candidate, carrying only its id", () => {
    const decision = decideImprovement([candidate({ id: "cand-ok" })], defaultImprovementState());
    expect(decision.kind).toBe("start");
    if (decision.kind !== "start") return;
    expect(decision.candidateId).toBe("cand-ok");
    expect(Object.keys(decision).sort()).toEqual(["candidateId", "kind", "reason"]);
    expect(decision.reason).toBe("selected candidate cand-ok");
  });

  it("never mutates its inputs", () => {
    const list = [candidate({ id: "b", priority: 2 }), candidate({ id: "a", priority: 1 })];
    const before = list.map((item) => item.id);
    const state: ImprovementPolicyState = defaultImprovementState();

    decideImprovement(list, state);

    expect(list.map((item) => item.id)).toEqual(before);
  });
});
