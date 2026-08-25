import { beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OrchestrationStore } from "../lib/foundry/orchestration-store";
import {
  clearJob,
  failJob,
  getArtifact,
  getJob,
  orchestrationConnection,
  saveArtifact,
  tryClaimJob,
} from "../lib/foundry/store";
import { DEFAULT_MAX_ATTEMPTS, DEFAULT_TEXT_MODEL } from "../lib/foundry/orchestration-types";
import type { HostId, ResourceBudget } from "../lib/foundry/orchestration-types";
import { schedule } from "../lib/foundry/scheduler";
import type { HostState, ModelState } from "../lib/foundry/scheduler";
import { planWorkspace } from "../lib/foundry/workspace";
import { ARTIFACT_KIND } from "../lib/foundry/types";
import { DEFAULT_EXECUTE_RESOURCES, RETRY_BACKOFF_BASE_MS } from "../lib/foundry/orchestration-execute";
import type { RunnerReport, VerificationResult } from "../lib/foundry/orchestration-execute";
import { EMPTY_EXECUTE_DRIVER_STATE, runExecuteDriver } from "../lib/foundry/orchestration-execute-driver";
import type {
  ExecuteDriverEffects,
  ExecuteDriverOptions,
  ExecuteDriverState,
  FinalizeExecuteInput,
} from "../lib/foundry/orchestration-execute-driver";

// The durable store writes to dataDir()/foundry.sqlite; point it at a scratch
// dir for this process so the tests never touch the real database, event log,
// jobs or artifacts.
process.env.FOUNDRY_DATA = join(tmpdir(), `foundry-execute-driver-test-${process.pid}`);

const ISSUE = "issue-1";
const OWNER = "executor-1";
const NOW = "2026-08-25T10:00:00.000Z";
const ROOT = `/tmp/foundry-execute-driver-test-${process.pid}`;

const EMPTY_BUDGET: ResourceBudget = { cpu: 0, memoryMiB: 0, diskMiB: 0, concurrency: 0 };

const HOSTS: Partial<Record<HostId, HostState>> = {
  vps: {
    id: "vps",
    budget: { cpu: 4, memoryMiB: 8192, diskMiB: 65536, concurrency: 4 },
    used: { ...EMPTY_BUDGET },
  },
};

const MODELS: Record<string, ModelState> = {
  [DEFAULT_TEXT_MODEL]: {
    id: DEFAULT_TEXT_MODEL,
    capabilities: ["text"],
    maxConcurrent: 4,
    concurrent: 0,
  },
};

// Each test gets a clean orchestration and legacy state on the shared scratch db.
beforeEach(() => {
  const conn = orchestrationConnection();
  conn.exec(
    [
      "PRAGMA foreign_keys = OFF",
      "DELETE FROM orchestration_attempts",
      "DELETE FROM orchestration_leases",
      "DELETE FROM orchestration_claims",
      "DELETE FROM orchestration_tasks",
      "DELETE FROM orchestration_runs",
      "DELETE FROM issue_artifacts",
      "DELETE FROM issue_jobs",
      "PRAGMA foreign_keys = ON",
    ].join(";"),
  );
});

/**
 * Wire a real temporary SQLite store plus fake external effects (scheduler,
 * workspace, runner, verifier) around the driver. The runner/verifier are
 * configurable; the schedule/workspace effects use the real pure adapters.
 */
type Harness = {
  store: OrchestrationStore;
  effects: ExecuteDriverEffects;
  options: ExecuteDriverOptions;
  state: ExecuteDriverState;
  events: Array<{ issueId: string; kind: string; payload: Record<string, unknown> }>;
  finalized: FinalizeExecuteInput[];
  advance: (ms: number) => void;
};

function makeHarness(seed: {
  featureEnabled?: boolean;
  maxTicks?: number;
  runner?: (attempt: number, taskId: string) => RunnerReport;
  verifier?: (taskId: string) => VerificationResult;
}): Harness {
  let current = NOW;
  const advance = (ms: number) => {
    current = new Date(Date.parse(current) + ms).toISOString();
  };
  const now = () => current;
  const store = new OrchestrationStore({ now });
  const events: Harness["events"] = [];
  const finalized: FinalizeExecuteInput[] = [];
  let attempt = 0;

  const effects: ExecuteDriverEffects = {
    store,
    schedule: ({ tasks, now: at }) => schedule({ tasks, hosts: HOSTS, models: MODELS, now: at }),
    prepareWorkspace: ({ task, decision }) =>
      planWorkspace({
        taskId: task.id,
        host: decision.host,
        isolation: task.isolation?.kind ?? "git-worktree",
        root: ROOT,
      }),
    run: async ({ taskId }) => {
      attempt += 1;
      const report = seed.runner ?? (() => ({ kind: "completed", taskId }));
      return report(attempt, taskId);
    },
    verify: async ({ taskId }) => {
      const result = seed.verifier ?? (() => ({ taskId, verdict: "passed", evidence: ["e2e"], error: null }));
      return result(taskId);
    },
    appendEvent: (issueId, kind, payload) => events.push({ issueId, kind, payload }),
    finalize: (input) => {
      finalized.push(input);
      // The real legacy contract: success writes the execute artifact and
      // clears the legacy execute job; any other outcome records the failure.
      if (input.outcome === "succeeded") {
        saveArtifact({
          issueId: input.issueId,
          kind: ARTIFACT_KIND.execute,
          stage: "execute",
          body: JSON.stringify({ runId: input.runId, taskId: input.taskId }),
        });
        clearJob(input.issueId, "execute");
      } else {
        failJob(input.issueId, "execute", input.error ?? "execute failed");
      }
    },
  };

  const options: ExecuteDriverOptions = {
    issueId: ISSUE,
    stage: "execute",
    featureEnabled: seed.featureEnabled ?? true,
    owner: OWNER,
    now,
    maxTicks: seed.maxTicks,
  };

  return { store, effects, options, state: { ...EMPTY_EXECUTE_DRIVER_STATE }, events, finalized, advance };
}

/** Manually drive the store to an in-flight running task with a live lease. */
function seedRunningTask(h: Harness, claims?: string[]): { runId: string; taskId: string } {
  const run = h.store.createRun({ issueId: ISSUE, stage: "execute", name: `execute:${ISSUE}` });
  const task = h.store.createTask(run.id, {
    name: `execute:${ISSUE}`,
    resources: { ...DEFAULT_EXECUTE_RESOURCES },
    claims,
  });
  h.store.leaseTask(task.id, { host: "vps", owner: OWNER });
  h.store.startTask(task.id, OWNER);
  return { runId: run.id, taskId: task.id };
}

describe("orchestration-execute-driver", () => {
  it("feature disabled: pre-gates with zero mutation and zero effects", async () => {
    const h = makeHarness({ featureEnabled: false });
    // Seed a legacy execute job to prove the disabled path leaves it untouched.
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runExecuteDriver(h.effects, h.options, h.state);

    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") return;
    expect(result.reason).toBe("feature_disabled");
    expect(result.ticks).toBe(0);

    // No orchestration state, no audit events, no finalize, legacy job intact.
    expect(h.store.listRuns()).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.finalized).toEqual([]);
    expect(getJob(ISSUE, "execute")?.status).toBe("running");
  });

  it("happy path: drives a run to success and finalizes the execute artifact", async () => {
    const h = makeHarness({});
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runExecuteDriver(h.effects, h.options, h.state);

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.outcome).toBe("succeeded");

    const runs = h.store.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("succeeded");
    const tasks = h.store.listTasks(runs[0].id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].state).toBe("succeeded");
    expect(tasks[0].attempts).toBe(1);

    // Audit trail: stage entered once, dispatch once, completed + finalized
    // once each, never failed.
    const kinds = h.events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "execute.stage_entered")).toHaveLength(1);
    expect(kinds.filter((k) => k === "scheduler.dispatch")).toHaveLength(1);
    expect(kinds.filter((k) => k === "execute.completed")).toHaveLength(1);
    expect(kinds.filter((k) => k === "execute.finalized")).toHaveLength(1);
    expect(kinds.filter((k) => k === "execute.failed")).toHaveLength(0);

    // Finalize ran once: the execute artifact exists and the legacy execute
    // job was cleared.
    expect(h.finalized).toHaveLength(1);
    expect(h.finalized[0]).toMatchObject({ issueId: ISSUE, outcome: "succeeded", owner: OWNER });
    expect(getArtifact(ISSUE, ARTIFACT_KIND.execute)).not.toBeNull();
    expect(getJob(ISSUE, "execute")).toBeNull();
  });

  it("persists pre-resolved physical claims into the created task verbatim", async () => {
    const h = makeHarness({});
    // Pre-resolved input: canonical physical identities, no claim strings for
    // the driver to reinterpret. They land on the task exactly as given. The
    // store holds claims while the task is active and only releases them on a
    // terminal transition, so the runner captures the durable task claims
    // mid-run.
    h.options.claims = ["/repo/work/a.txt", "/repo/work/b.txt"];
    let seenClaims: string[] | null = null;
    h.effects.run = async ({ taskId }) => {
      seenClaims = h.store.getTask(taskId)?.claims ?? null;
      return { kind: "completed", taskId };
    };
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    const result = await runExecuteDriver(h.effects, h.options, h.state);

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.outcome).toBe("succeeded");
    expect(seenClaims).toEqual(["/repo/work/a.txt", "/repo/work/b.txt"]);
  });

  it("resume never reinterprets durable physical claims already persisted", async () => {
    const h = makeHarness({});
    // A durable, still-in-flight task already carries its physical claims from
    // creation. A fresh driver invocation arrives with different claims;
    // because the task already exists, `create-task` never fires and the
    // durable claims are never re-resolved or reinterpreted.
    const { taskId } = seedRunningTask(h, ["/repo/work/a.txt"]);
    h.options.claims = ["/totally/different/path"];

    const result = await runExecuteDriver(h.effects, h.options, { ...EMPTY_EXECUTE_DRIVER_STATE });

    // Mid-flight resume is a deterministic waiting noop: the in-flight task
    // keeps its durable physical claims and nothing is recreated or
    // reinterpreted.
    expect(result.status).toBe("waiting");
    expect(h.store.getTask(taskId)?.claims).toEqual(["/repo/work/a.txt"]);
  });

  it("retryable failure: persists retry metadata, waits out backoff, then succeeds", async () => {
    const h = makeHarness({
      runner: (attempt, taskId) =>
        attempt === 1
          ? { kind: "failed", taskId, error: "flaky e2e", retryable: true }
          : { kind: "completed", taskId },
    });

    // First attempt fails; retry metadata is durable on the task row.
    const first = await runExecuteDriver(h.effects, h.options, h.state);
    expect(first.status).toBe("waiting");
    if (first.status !== "waiting") return;
    expect(first.reason).toBe("retry_pending");
    let task = h.store.listTasks()[0];
    expect(task.state).toBe("failed");
    expect(task.attempts).toBe(1);
    expect(task.retryable).toBe(true);
    expect(task.nextRetryAt).toBe("2026-08-25T10:00:30.000Z");

    // Backoff has not elapsed: still waiting, no retry applied yet.
    h.advance(RETRY_BACKOFF_BASE_MS - 1);
    const second = await runExecuteDriver(h.effects, h.options, first.state);
    expect(second.status).toBe("waiting");
    if (second.status !== "waiting") return;
    expect(second.reason).toBe("retry_pending");

    // Backoff elapsed: the driver retries and the second attempt succeeds.
    h.advance(1);
    const third = await runExecuteDriver(h.effects, h.options, second.state);
    expect(third.status).toBe("done");
    if (third.status !== "done") return;
    expect(third.outcome).toBe("succeeded");

    task = h.store.listTasks()[0];
    expect(task.state).toBe("succeeded");
    expect(task.attempts).toBe(2);

    const kinds = h.events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "execute.failed")).toHaveLength(1);
    expect(kinds.filter((k) => k === "execute.completed")).toHaveLength(1);
    expect(kinds.filter((k) => k === "execute.finalized")).toHaveLength(1);

    expect(h.finalized).toHaveLength(1);
    expect(h.finalized[0].outcome).toBe("succeeded");
    expect(getArtifact(ISSUE, ARTIFACT_KIND.execute)).not.toBeNull();
    expect(getJob(ISSUE, "execute")).toBeNull();
  });

  it("exhausted attempts: fails the run and records a legacy execute failure", async () => {
    const h = makeHarness({
      runner: (attempt, taskId) => ({
        kind: "failed" as const,
        taskId,
        error: `flaky #${attempt}`,
        retryable: true,
      }),
    });
    expect(tryClaimJob(ISSUE, "execute")).toBe(true);

    let state = h.state;
    let result = await runExecuteDriver(h.effects, h.options, state);
    expect(result.status).toBe("waiting");
    if (result.status !== "waiting") return;
    expect(result.reason).toBe("retry_pending");
    state = result.state;

    // Attempt 2 backoff is 60s; clear it and fail again.
    h.advance(RETRY_BACKOFF_BASE_MS * 2);
    result = await runExecuteDriver(h.effects, h.options, state);
    expect(result.status).toBe("waiting");
    if (result.status !== "waiting") return;
    expect(result.reason).toBe("retry_pending");
    state = result.state;

    // Attempt 3 backoff is 120s; clear it and exhaust the budget.
    h.advance(RETRY_BACKOFF_BASE_MS * 4);
    result = await runExecuteDriver(h.effects, h.options, state);
    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.outcome).toBe("failed");

    const task = h.store.listTasks()[0];
    expect(task.state).toBe("failed");
    expect(task.attempts).toBe(DEFAULT_MAX_ATTEMPTS);

    const runs = h.store.listRuns();
    expect(runs[0].status).toBe("failed");

    // No artifact on failure; the legacy execute job records the failure.
    expect(h.finalized).toHaveLength(1);
    expect(h.finalized[0].outcome).toBe("failed");
    expect(h.finalized[0].error).toBe("flaky #3");
    expect(getArtifact(ISSUE, ARTIFACT_KIND.execute)).toBeNull();
    expect(getJob(ISSUE, "execute")?.status).toBe("failed");
    expect(getJob(ISSUE, "execute")?.error).toBe("flaky #3");

    const kinds = h.events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "execute.failed")).toHaveLength(DEFAULT_MAX_ATTEMPTS);
    expect(kinds.filter((k) => k === "execute.completed")).toHaveLength(0);
  });

  it("stale expired lease: recovers via expireLeases and completes the run", async () => {
    const h = makeHarness({});
    const { taskId } = seedRunningTask(h);

    // Let the lease expire (default TTL is 5 minutes) while the task is running.
    h.advance(5 * 60_000 + 1);

    const result = await runExecuteDriver(h.effects, h.options, { ...EMPTY_EXECUTE_DRIVER_STATE });

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.outcome).toBe("succeeded");

    // The stale attempt was reclaimed and the run re-executed to success.
    const task = h.store.getTask(taskId);
    expect(task?.state).toBe("succeeded");
    expect(task?.attempts).toBe(2);
    expect(h.store.getRun(task?.runId ?? "")?.status).toBe("succeeded");

    // The lease revocation was recorded, then the run completed + finalized.
    const kinds = h.events.map((e) => e.kind);
    expect(kinds).toContain("task.lease_revoked");
    expect(kinds.filter((k) => k === "execute.completed")).toHaveLength(1);
    expect(kinds.filter((k) => k === "execute.finalized")).toHaveLength(1);

    expect(h.finalized).toHaveLength(1);
    expect(h.finalized[0].outcome).toBe("succeeded");
    expect(getArtifact(ISSUE, ARTIFACT_KIND.execute)).not.toBeNull();
  });

  it("unrecoverable fence: owner-mismatched lease fails closed without mutation", async () => {
    const h = makeHarness({});
    // A live, unexpired lease held by a different executor: not ours to expire.
    const run = h.store.createRun({ issueId: ISSUE, stage: "execute", name: `execute:${ISSUE}` });
    const task = h.store.createTask(run.id, {
      name: `execute:${ISSUE}`,
      resources: { ...DEFAULT_EXECUTE_RESOURCES },
    });
    h.store.leaseTask(task.id, { host: "vps", owner: "other-executor" });

    const result = await runExecuteDriver(h.effects, h.options, h.state);

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.error).toContain("lease_owner_mismatch");

    // Fail closed: a foreign live lease is not mutated or revoked.
    expect(h.store.getTask(task.id)?.state).toBe("leased");
    expect(h.store.getRun(run.id)?.status).toBe("active");
    expect(h.finalized).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it("loop bound: stops at maxTicks without finishing when the budget is too small", async () => {
    const h = makeHarness({ maxTicks: 3 });

    const result = await runExecuteDriver(h.effects, h.options, h.state);

    expect(result.status).toBe("exhausted");
    if (result.status !== "exhausted") return;
    expect(result.ticks).toBe(3);

    // Partially progressed: run + task created, still active, never finalized.
    const runs = h.store.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("active");
    const tasks = h.store.listTasks(runs[0].id);
    expect(tasks[0].state).toBe("ready");
    expect(h.finalized).toEqual([]);
    expect(getArtifact(ISSUE, ARTIFACT_KIND.execute)).toBeNull();
  });
});
