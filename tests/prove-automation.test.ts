/**
 * Disposable behavioral proof for the automation runtime slice.
 *
 * Drives the public APIs — durable AutomationControl CAS over temp SQLite,
 * `deriveImprovementCandidates` (linked lesson + promotion), and the runtime's
 * delegation to `runAutomationDriver` — through fake injected effects. No
 * assertions on source strings; every claim is about observable behavior:
 * which effects ran, in what order, and what was audited.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runAutomationRuntime,
  type AutomationRuntimeEffects,
  type AutomationRuntimeResult,
} from "../lib/foundry/automation-runtime";
import {
  deriveImprovementCandidates,
  type ImprovementProposal,
} from "../lib/foundry/improvement-candidates";
import type { AutomationIntentOutcome } from "../lib/foundry/automation-driver";
import type { AutomationControlAdapter } from "../lib/foundry/automation-control";
import type { UnattendedSnapshot } from "../lib/foundry/unattended";
import type { Issue } from "../lib/foundry/types";
import type { LearningRecord, LessonRecord, PromotionRecord } from "../lib/foundry/learning";

const NOW = "2026-08-25T00:00:00.000Z";
const STRONG_PATTERN = "Always verify that a released change passes the package tests before merge";
const LESSON_ID = "lesson:task-1";
const PROMOTION_ID = "promotion:lesson:task-1";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "foundry-prove-auto-"));
  process.env.FOUNDRY_DATA = join(dataDir, "data");
  vi.resetModules();
});

afterEach(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

// store.ts holds a module-level SQLite `db` singleton; a fresh module instance
// (after vi.resetModules) is what opens a genuinely new connection against the
// temp database, proving the control row lives on disk, not in a cache.
async function loadControlStore(): Promise<AutomationControlAdapter> {
  const { createAutomationControlStore } = await import("../lib/foundry/store");
  return createAutomationControlStore({ now: () => NOW });
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
    createdAt: NOW,
    updatedAt: NOW,
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
    requiresPaidWork: true,
    ...overrides,
  };
}

/** Derive the evidence-backed improvement candidate from the linked lesson+promotion. */
function deriveCandidate(proposalOverrides: Partial<ImprovementProposal> = {}) {
  const out = deriveImprovementCandidates(
    [lesson(), promotion()],
    [proposal(proposalOverrides)],
  );
  expect(out.exclusions).toEqual([]);
  expect(out.candidates).toHaveLength(1);
  return out.candidates[0];
}

/** Recording effect seam; per-test overrides win. */
function harness(overrides: Partial<AutomationRuntimeEffects> = {}): {
  effects: AutomationRuntimeEffects;
  startedIssues: string[];
  startedCandidates: string[];
  audited: AutomationIntentOutcome[];
  run: (control: AutomationControlAdapter) => Promise<AutomationRuntimeResult>;
} {
  const startedIssues: string[] = [];
  const startedCandidates: string[] = [];
  const audited: AutomationIntentOutcome[] = [];
  const effects: AutomationRuntimeEffects = {
    startIssue: (issueId) => {
      startedIssues.push(issueId);
    },
    startImprovement: (candidateId) => {
      startedCandidates.push(candidateId);
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
    run: (control) =>
      runAutomationRuntime(control, { snapshots: [], candidates: [] }, effects),
  };
}

describe("prove automation runtime (disposable)", () => {
  it("enables via CAS and runs one issue and one improvement through fake effects, auditing in order", async () => {
    const control = await loadControlStore();
    expect(control.get()).toMatchObject({ enabled: false, version: 1 });

    // Operator action: CAS-enable with bounds and paid authorization.
    const enabled = control.update(
      { enabled: true, limit: 1, maxIterations: 5, maxCostUsd: 2, perCandidateCeilingUsd: 1, paidAuthorization: true },
      1,
    );
    expect(enabled).toMatchObject({ enabled: true, limit: 1, paidAuthorization: true, version: 2 });

    const candidates = [deriveCandidate()];
    const h = harness();
    const out = await runAutomationRuntime(
      control,
      { snapshots: [makeSnapshot({ id: "issue-1" })], candidates },
      h.effects,
    );

    expect(out.ran).toBe(true);
    expect(out.control.version).toBe(2);
    expect(h.startedIssues).toEqual(["issue-1"]);
    expect(h.startedCandidates).toEqual(["cand-1"]);
    expect(out.driver?.results).toEqual([
      { kind: "start-issue", issueId: "issue-1", status: "succeeded" },
      { kind: "start-improvement", candidateId: "cand-1", status: "succeeded" },
    ]);
    // The audit sink saw the same outcomes, in the same plan order.
    expect(h.audited).toEqual(out.driver?.results);
  });

  it("caps the per-pass issue limit from the durable control", async () => {
    const control = await loadControlStore();
    control.update({ enabled: true, limit: 2, paidAuthorization: true }, 1);

    const h = harness();
    const out = await runAutomationRuntime(
      control,
      {
        snapshots: [
          makeSnapshot({ id: "issue-1", issue: { createdAt: NOW } }),
          makeSnapshot({ id: "issue-2", issue: { createdAt: NOW } }),
          makeSnapshot({ id: "issue-3", issue: { createdAt: NOW } }),
        ],
        candidates: [],
      },
      h.effects,
    );

    expect(out.ran).toBe(true);
    // Three eligible snapshots, but the durable limit of 2 caps the pass.
    expect(h.startedIssues).toEqual(["issue-1", "issue-2"]);
    expect(out.driver?.startedIssueIds).toEqual(["issue-1", "issue-2"]);
  });

  it("caps improvement policy ceilings from the durable control", async () => {
    const control = await loadControlStore();
    // The candidate costs 0.05; the durable ceiling is 0.01.
    control.update({ enabled: true, perCandidateCeilingUsd: 0.01, paidAuthorization: true }, 1);

    const h = harness();
    const out = await runAutomationRuntime(
      control,
      { snapshots: [], candidates: [deriveCandidate()] },
      h.effects,
    );

    expect(out.ran).toBe(true);
    expect(h.startedCandidates).toEqual([]);
    expect(out.driver?.results).toEqual([
      { kind: "stop", reason: expect.stringContaining("exceeds the per-candidate ceiling") },
    ]);
  });

  it("withholds paid work until paid authorization is durable", async () => {
    const control = await loadControlStore();
    control.update({ enabled: true, paidAuthorization: false }, 1);

    const h = harness();
    const denied = await runAutomationRuntime(
      control,
      { snapshots: [], candidates: [deriveCandidate()] },
      h.effects,
    );
    expect(h.startedCandidates).toEqual([]);
    expect(denied.driver?.results).toEqual([
      { kind: "wait", reason: expect.stringContaining("requires paid work that is not authorized") },
    ]);

    // Operator grants paid authorization through CAS; the next pass reads it live.
    control.update({ paidAuthorization: true }, control.get().version);
    const granted = await runAutomationRuntime(
      control,
      { snapshots: [], candidates: [deriveCandidate()] },
      h.effects,
    );
    expect(granted.ran).toBe(true);
    expect(h.startedCandidates).toEqual(["cand-1"]);
  });

  it("does not start and audits a wait when the control is held", async () => {
    const control = await loadControlStore();
    control.update({ enabled: true }, 1);
    control.update({ operatorHold: true }, 2);
    expect(control.get()).toMatchObject({ enabled: true, operatorHold: true, version: 3 });

    const candidates = [deriveCandidate()];
    const h = harness();
    const out = await runAutomationRuntime(
      control,
      { snapshots: [makeSnapshot({ id: "issue-1" })], candidates },
      h.effects,
    );

    expect(out.ran).toBe(false);
    expect(out.driver).toBeNull();
    expect(h.startedIssues).toEqual([]);
    expect(h.startedCandidates).toEqual([]);
    expect(h.audited).toEqual([{ kind: "wait", reason: "automation held by operator" }]);
  });

  it("does not start and audits a stop when the control is disabled", async () => {
    const control = await loadControlStore();
    expect(control.get()).toMatchObject({ enabled: false, version: 1 });

    const candidates = [deriveCandidate()];
    const h = harness();
    const out = await runAutomationRuntime(
      control,
      { snapshots: [makeSnapshot({ id: "issue-1" })], candidates },
      h.effects,
    );

    expect(out.ran).toBe(false);
    expect(out.driver).toBeNull();
    expect(h.startedIssues).toEqual([]);
    expect(h.startedCandidates).toEqual([]);
    expect(h.audited).toEqual([{ kind: "stop", reason: "automation disabled" }]);
  });

  it("keeps the runtime alive when the audit sink throws on a held pass", async () => {
    const control = await loadControlStore();
    control.update({ enabled: true, operatorHold: true }, 1);

    const h = harness({
      audit: () => {
        throw new Error("log sink down");
      },
    });
    const out = await runAutomationRuntime(
      control,
      { snapshots: [makeSnapshot({ id: "issue-1" })], candidates: [] },
      h.effects,
    );

    expect(out.ran).toBe(false);
    expect(out.driver).toBeNull();
    expect(h.startedIssues).toEqual([]);
  });

  it("rejects a stale CAS version, guarding the operator server action", async () => {
    const control = await loadControlStore();
    control.update({ enabled: true }, 1);

    let caught: unknown;
    try {
      control.update({ enabled: false }, 1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("AutomationControlStaleVersionError");
    expect((caught as Error).message).toMatch(/expected version 1, current version 2/);
    // The failed write changed nothing; the control stays enabled at version 2.
    expect(control.get()).toMatchObject({ enabled: true, version: 2 });
  });
});
