import { describe, expect, it } from "vitest";
import {
  UNATTENDED_ELIGIBLE_STAGES,
  UNATTENDED_EXCLUDED_STAGES,
  UNATTENDED_LIMIT_CAP,
  selectUnattended,
  unattendedExclusionFor,
  type UnattendedExclusionReason,
  type UnattendedSnapshot,
} from "../lib/foundry/unattended";
import { STAGES, type Issue } from "../lib/foundry/types";

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

function expectExcluded(snapshot: UnattendedSnapshot, reason: UnattendedExclusionReason): void {
  const out = selectUnattended([snapshot], 20);
  expect(out.selected).toEqual([]);
  expect(out.exclusions).toEqual([{ issueId: snapshot.issue.id, reason }]);
}

describe("stage eligibility", () => {
  it("covers every stage exactly once between eligible and excluded", () => {
    const eligible = UNATTENDED_ELIGIBLE_STAGES;
    const excluded = UNATTENDED_EXCLUDED_STAGES;
    for (const stage of STAGES) {
      expect(eligible.includes(stage) || excluded.includes(stage)).toBe(true);
      expect(eligible.includes(stage) && excluded.includes(stage)).toBe(false);
    }
    expect(eligible.length).toBe(7);
    expect(excluded.length).toBe(5);
  });

  it("selects every eligible stage when otherwise clean", () => {
    const snapshots = UNATTENDED_ELIGIBLE_STAGES.map((stage, index) =>
      makeSnapshot({ id: `issue-${stage}`, issue: { currentStage: stage, createdAt: at(index) } }),
    );
    const out = selectUnattended(snapshots, 20);
    expect(out.selected).toEqual(UNATTENDED_ELIGIBLE_STAGES.map((stage) => `issue-${stage}`));
    expect(out.exclusions).toEqual([]);
  });

  it("never selects intake, grill, or spec", () => {
    for (const stage of ["intake", "grill", "spec"] as const) {
      expectExcluded(makeSnapshot({ id: `issue-${stage}`, issue: { currentStage: stage } }), "disallowed-stage");
    }
  });

  it("never selects merge or hygiene", () => {
    for (const stage of ["merge", "hygiene"] as const) {
      expectExcluded(makeSnapshot({ id: `issue-${stage}`, issue: { currentStage: stage } }), "disallowed-stage");
    }
  });

  it("reports a clean eligible snapshot as selectable", () => {
    expect(unattendedExclusionFor(makeSnapshot({ id: "issue-1" }))).toBeNull();
  });
});

describe("safety exclusions", () => {
  it("excludes a pending human gate", () => {
    expectExcluded(makeSnapshot({ id: "issue-1", humanGate: true }), "pending-human-gate");
  });

  it("excludes an active job", () => {
    expectExcluded(makeSnapshot({ id: "issue-1", activeJob: true }), "active-job");
  });

  it("excludes a oneshot that is already walking", () => {
    expectExcluded(makeSnapshot({ id: "issue-1", oneshotWalking: true }), "oneshot-walking");
  });

  it("excludes a walk-held issue", () => {
    expectExcluded(makeSnapshot({ id: "issue-1", walkHold: true }), "walk-held");
  });

  it("excludes a grill-held issue", () => {
    expectExcluded(makeSnapshot({ id: "issue-1", grillHold: true }), "grill-held");
  });

  it("excludes an issue with unresolved dependencies", () => {
    expectExcluded(makeSnapshot({ id: "issue-1", unresolvedDependencies: true }), "unresolved-dependencies");
  });

  it("excludes an issue whose project/repository is not allowed", () => {
    expectExcluded(makeSnapshot({ id: "issue-1", allowedTarget: false }), "disallowed-target");
  });

  it("reports a single reason per issue, priority first", () => {
    const out = selectUnattended(
      [
        makeSnapshot({
          id: "issue-a",
          issue: { currentStage: "merge" },
          activeJob: true,
          humanGate: true,
        }),
      ],
      20,
    );
    expect(out.exclusions).toEqual([{ issueId: "issue-a", reason: "disallowed-stage" }]);
  });
});

describe("ordering", () => {
  it("selects safe work oldest-first", () => {
    const snapshots = [
      makeSnapshot({ id: "newest", issue: { createdAt: at(3) } }),
      makeSnapshot({ id: "oldest", issue: { createdAt: at(1) } }),
      makeSnapshot({ id: "middle", issue: { createdAt: at(2) } }),
    ];
    const out = selectUnattended(snapshots, 20);
    expect(out.selected).toEqual(["oldest", "middle", "newest"]);
  });

  it("breaks createdAt ties by id", () => {
    const snapshots = [
      makeSnapshot({ id: "c", issue: { createdAt: at(1) } }),
      makeSnapshot({ id: "a", issue: { createdAt: at(1) } }),
      makeSnapshot({ id: "b", issue: { createdAt: at(1) } }),
    ];
    const out = selectUnattended(snapshots, 20);
    expect(out.selected).toEqual(["a", "b", "c"]);
  });

  it("is independent of input order", () => {
    const first = [makeSnapshot({ id: "a", issue: { createdAt: at(1) } }), makeSnapshot({ id: "b", issue: { createdAt: at(2) } })];
    const second = [first[1], first[0]];
    expect(selectUnattended(second, 20)).toEqual(selectUnattended(first, 20));
  });

  it("reports exclusions in the same age order as selection", () => {
    const out = selectUnattended(
      [
        makeSnapshot({ id: "safe-a", issue: { createdAt: at(1) } }),
        makeSnapshot({ id: "held", issue: { createdAt: at(0) }, walkHold: true }),
        makeSnapshot({ id: "safe-b", issue: { createdAt: at(2) } }),
        makeSnapshot({ id: "merge", issue: { currentStage: "merge", createdAt: at(3) } }),
      ],
      20,
    );
    expect(out.selected).toEqual(["safe-a", "safe-b"]);
    expect(out.exclusions).toEqual([
      { issueId: "held", reason: "walk-held" },
      { issueId: "merge", reason: "disallowed-stage" },
    ]);
  });
});

describe("bounding", () => {
  it("selects at most the requested limit", () => {
    const snapshots = Array.from({ length: 5 }, (_, i) =>
      makeSnapshot({ id: `issue-${i}`, issue: { createdAt: at(i) } }),
    );
    const out = selectUnattended(snapshots, 2);
    expect(out.selected).toEqual(["issue-0", "issue-1"]);
    expect(out.exclusions).toEqual([]);
  });

  it("hard-caps the limit at 20", () => {
    const snapshots = Array.from({ length: 25 }, (_, i) =>
      makeSnapshot({ id: `issue-${i}`, issue: { createdAt: at(i) } }),
    );
    const out = selectUnattended(snapshots, 25);
    expect(out.selected).toHaveLength(UNATTENDED_LIMIT_CAP);
    expect(out.selected).toEqual(Array.from({ length: UNATTENDED_LIMIT_CAP }, (_, i) => `issue-${i}`));
    expect(out.exclusions).toEqual([]);
  });

  it("selects nothing when there is no eligible work", () => {
    expect(selectUnattended([], 5)).toEqual({ selected: [], exclusions: [] });
    const out = selectUnattended([makeSnapshot({ id: "issue-1", issue: { currentStage: "grill" } })], 5);
    expect(out.selected).toEqual([]);
    expect(out.exclusions).toHaveLength(1);
  });

  it("skips excluded issues before filling the limit", () => {
    const out = selectUnattended(
      [
        makeSnapshot({ id: "safe-1", issue: { createdAt: at(0) } }),
        makeSnapshot({ id: "unsafe", issue: { createdAt: at(1) }, activeJob: true }),
        makeSnapshot({ id: "safe-2", issue: { createdAt: at(2) } }),
      ],
      1,
    );
    expect(out.selected).toEqual(["safe-1"]);
    expect(out.exclusions).toEqual([{ issueId: "unsafe", reason: "active-job" }]);
  });
});

describe("limit validation", () => {
  const invalidLimits: Array<[string, unknown]> = [
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["fraction", 1.5],
    ["string", "5"],
    ["undefined", undefined],
    ["null", null],
  ];

  it.each(invalidLimits)("rejects an invalid limit: %s", (_name, limit) => {
    expect(() => selectUnattended([makeSnapshot({ id: "issue-1" })], limit as number)).toThrow(RangeError);
  });

  it("accepts a limit of 1", () => {
    const out = selectUnattended(
      [
        makeSnapshot({ id: "a", issue: { createdAt: at(1) } }),
        makeSnapshot({ id: "b", issue: { createdAt: at(2) } }),
      ],
      1,
    );
    expect(out.selected).toEqual(["a"]);
  });

  it("accepts a limit exactly at the cap", () => {
    const snapshots = Array.from({ length: UNATTENDED_LIMIT_CAP }, (_, i) =>
      makeSnapshot({ id: `issue-${i}`, issue: { createdAt: at(i) } }),
    );
    expect(selectUnattended(snapshots, UNATTENDED_LIMIT_CAP).selected).toHaveLength(UNATTENDED_LIMIT_CAP);
  });
});

describe("purity", () => {
  it("never mutates its inputs", () => {
    const snapshots = [
      makeSnapshot({ id: "a", issue: { createdAt: at(1) } }),
      makeSnapshot({ id: "b", issue: { currentStage: "grill", createdAt: at(0) } }),
      makeSnapshot({ id: "c", issue: { currentStage: "merge", createdAt: at(2) } }),
    ];
    const snapshotsBefore = snapshots.map((s) => ({ ...s, issue: { ...s.issue } }));
    const issuesBefore = snapshots.map((s) => ({ ...s.issue }));

    for (const snapshot of snapshots) {
      Object.freeze(snapshot);
      Object.freeze(snapshot.issue);
    }
    Object.freeze(snapshots);

    const out = selectUnattended(snapshots, 20);

    expect(out.selected).toEqual(["a"]);
    expect(snapshots).toEqual(snapshotsBefore);
    expect(snapshots.map((s) => s.issue)).toEqual(issuesBefore);
  });

  it("returns only ids and reasons, with no side effects", () => {
    const snapshot = makeSnapshot({ id: "issue-1", humanGate: true });
    const out = selectUnattended([snapshot], 20);
    expect(out).toEqual({ selected: [], exclusions: [{ issueId: "issue-1", reason: "pending-human-gate" }] });
  });
});
