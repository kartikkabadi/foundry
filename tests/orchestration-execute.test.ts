import { beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OrchestrationStore } from "../lib/foundry/orchestration-store";
import { orchestrationConnection } from "../lib/foundry/store";
import { DEFAULT_MAX_ATTEMPTS, DEFAULT_TEXT_MODEL } from "../lib/foundry/orchestration-types";
import type { HostId, Isolation, ResourceBudget } from "../lib/foundry/orchestration-types";
import { schedule } from "../lib/foundry/scheduler";
import type { DispatchDecision, HostState, ModelState, ScheduleOutput } from "../lib/foundry/scheduler";
import { planWorkspace } from "../lib/foundry/workspace";
import type { WorkspacePlan } from "../lib/foundry/workspace";
import {
  checkLeaseFence,
  decideExecuteStep,
  defaultExecuteTaskSpec,
  DEFAULT_EXECUTE_RESOURCES,
  isMultiAgentEnabled,
  retryNotBefore,
} from "../lib/foundry/orchestration-execute";
import type {
  ExecuteCommand,
  ExecuteCommandKind,
  ExecuteStepInput,
  RunnerReport,
  VerificationResult,
} from "../lib/foundry/orchestration-execute";

// The durable store writes to dataDir()/foundry.sqlite; point it at a scratch
// dir for this process so the tests never touch the real database or event log.
process.env.FOUNDRY_DATA = join(tmpdir(), `foundry-execute-test-${process.pid}`);

const ISSUE = "issue-1";
const OWNER = "executor-1";
const NOW = "2026-08-25T10:00:00.000Z";

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

// Each test gets a clean orchestration state on the shared scratch database.
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
      "PRAGMA foreign_keys = ON",
    ].join(";"),
  );
});

/** Deterministic store so snapshots and leases are reproducible. */
function makeStore(): OrchestrationStore {
  return new OrchestrationStore({ now: () => NOW });
}

/** Adapter-side state the coordinator cannot see; the caller owns it. */
type Ctx = {
  schedule: ScheduleOutput | null;
  dispatch: DispatchDecision | null;
  workspace: WorkspacePlan | null;
  runner: RunnerReport | null;
  verification: VerificationResult | null;
  /** True once the caller has applied the finalize-execute command. */
  finalized: boolean;
  runId: string;
  taskId: string;
};

function freshCtx(seed: Partial<Ctx> = {}): Ctx {
  return {
    schedule: null,
    dispatch: null,
    workspace: null,
    runner: null,
    verification: null,
    finalized: false,
    runId: "",
    taskId: "",
    ...seed,
  };
}

/** Rebuild the coordinator's injected snapshot from store state plus adapter ctx. */
function snapshot(
  store: OrchestrationStore,
  ctx: Ctx,
  overrides: Partial<ExecuteStepInput> = {},
): ExecuteStepInput {
  const runs = store.listRuns();
  const run = runs[0] ?? null;
  const tasks = run ? store.listTasks(run.id) : [];
  const task = tasks[0] ?? null;
  const lease = task?.leaseId ? (store.leases().find((lease) => lease.id === task.leaseId) ?? null) : null;
  return {
    issueId: ISSUE,
    stage: "execute",
    featureEnabled: true,
    owner: OWNER,
    now: NOW,
    run,
    tasks,
    schedule: ctx.schedule,
    dispatch: ctx.dispatch,
    workspace: ctx.workspace,
    lease,
    runner: ctx.runner,
    verification: ctx.verification,
    finalized: ctx.finalized,
    ...overrides,
  };
}

/** Apply one coordinator command through the real adapters; returns its kind. */
function applyCommand(store: OrchestrationStore, command: ExecuteCommand, ctx: Ctx): void {
  switch (command.kind) {
    case "create-run": {
      const run = store.createRun({
        issueId: command.issueId,
        stage: command.stage,
        name: command.name,
      });
      ctx.runId = run.id;
      return;
    }
    case "create-task": {
      // The coordinator carries the bare isolation kind; the store persists the
      // authoritative domain Isolation (kind + ref). Keep null for no isolation.
      const isolation: Isolation | null = command.task.isolation
        ? { kind: command.task.isolation, ref: command.task.name }
        : null;
      const task = store.createTask(ctx.runId, {
        name: command.task.name,
        deps: command.task.deps,
        resources: command.task.resources,
        host: command.task.host,
        isolation,
        model: command.task.model,
        route: command.task.route,
        maxAttempts: command.task.maxAttempts,
        claims: command.task.claims,
      });
      ctx.taskId = task.id;
      return;
    }
    case "compute-schedule": {
      const output = schedule({
        tasks: store.listTasks(ctx.runId),
        hosts: HOSTS,
        models: MODELS,
        now: NOW,
      });
      ctx.schedule = output;
      ctx.dispatch = output.dispatched.find((decision) => decision.taskId === ctx.taskId) ?? null;
      return;
    }
    case "dispatch": {
      store.leaseTask(command.taskId, { host: command.decision.host, owner: OWNER });
      ctx.dispatch = command.decision;
      return;
    }
    case "prepare-workspace": {
      const task = store.getTask(command.taskId);
      ctx.workspace = planWorkspace({
        taskId: command.taskId,
        host: command.decision.host,
        isolation: task?.isolation?.kind ?? "git-worktree",
        root: `/tmp/foundry-execute-test-${process.pid}`,
      });
      return;
    }
    case "run-task": {
      store.startTask(command.taskId, OWNER);
      ctx.runner = null;
      return;
    }
    case "verify": {
      store.verifyTask(command.taskId, command.fence.owner);
      ctx.verification = null;
      return;
    }
    case "succeed": {
      store.succeedTask(command.taskId, command.fence.owner);
      return;
    }
    case "fail": {
      // The retry decision is persisted atomically with the failure as durable
      // task facts (`retryable` + `nextRetryAt`); the coordinator reconstructs
      // the explicit retry command from the task snapshot later.
      store.failTask(command.taskId, command.error, command.fence.owner, {
        retryable: command.retryable,
        nextRetryAt: command.notBefore,
      });
      return;
    }
    case "retry": {
      store.retryTask(command.taskId);
      return;
    }
    case "cancel": {
      store.cancelTask(command.taskId, command.fence.owner, command.reason);
      return;
    }
    case "complete-run": {
      store.completeRun(command.runId, command.status);
      return;
    }
    case "finalize-execute": {
      // Finalizing the artifact outcome is a pure driver concern; the harness
      // records that it ran once so the coordinator stops re-emitting it.
      ctx.finalized = true;
      return;
    }
    case "recover": {
      store.expireLeases(NOW);
      return;
    }
  }
}

/** Drive the coordinator against a real store until the runner is in flight. */
function driveToRunning(): { store: OrchestrationStore; ctx: Ctx } {
  const store = makeStore();
  const ctx = freshCtx();
  let decision = decideExecuteStep(snapshot(store, ctx));
  let guard = 0;
  while (decision.kind === "command" && guard < 30) {
    applyCommand(store, decision.command, ctx);
    guard += 1;
    decision = decideExecuteStep(snapshot(store, ctx));
  }
  expect(decision).toMatchObject({ kind: "noop", reason: "waiting_for_runner" });
  expect(store.getTask(ctx.taskId)?.state).toBe("running");
  return { store, ctx };
}

/** Drive a run through to the verifying state (runner completed, verified). */
function driveToVerifying(): { store: OrchestrationStore; ctx: Ctx } {
  const { store, ctx } = driveToRunning();
  ctx.runner = { kind: "completed", taskId: ctx.taskId };
  const decision = decideExecuteStep(snapshot(store, ctx));
  expect(decision.kind).toBe("command");
  if (decision.kind === "command") {
    expect(decision.command.kind).toBe("verify");
    applyCommand(store, decision.command, ctx);
  }
  expect(store.getTask(ctx.taskId)?.state).toBe("verifying");
  return { store, ctx };
}

describe("orchestration-execute coordinator", () => {
  it("isMultiAgentEnabled: on only for FOUNDRY_MULTIAGENT=1", () => {
    expect(isMultiAgentEnabled({})).toBe(false);
    expect(isMultiAgentEnabled({ FOUNDRY_MULTIAGENT: "0" })).toBe(false);
    expect(isMultiAgentEnabled({ FOUNDRY_MULTIAGENT: "1" })).toBe(true);
  });

  it("defaultExecuteTaskSpec: one text task in a git worktree with default budget", () => {
    const spec = defaultExecuteTaskSpec(ISSUE);
    expect(spec.name).toBe(`execute:${ISSUE}`);
    expect(spec.deps).toEqual([]);
    expect(spec.isolation).toBe("git-worktree");
    expect(spec.resources).toEqual(DEFAULT_EXECUTE_RESOURCES);
    expect(spec.model).toEqual({ capability: "text", costCeilingUsd: null });
    expect(spec.route.primary).toBe(DEFAULT_TEXT_MODEL);
    expect(spec.maxAttempts).toBe(DEFAULT_MAX_ATTEMPTS);
  });

  it("disabled switch: noops with feature_disabled when orchestration is off", () => {
    const input = snapshot(makeStore(), freshCtx(), { featureEnabled: false });
    const decision = decideExecuteStep(input);
    expect(decision.kind).toBe("noop");
    // Defense-in-depth fallback; the caller pre-gates on isMultiAgentEnabled.
    // Eventless so a recurring noop snapshot never spams the event log.
    expect(decision).toMatchObject({ reason: "feature_disabled", events: [] });
  });

  it("wrong stage: noops when the issue stage is not execute", () => {
    const input = snapshot(makeStore(), freshCtx(), { stage: "evidence" });
    const decision = decideExecuteStep(input);
    expect(decision.kind).toBe("noop");
    expect(decision).toMatchObject({ reason: "wrong_stage", events: [] });
  });

  it("no dispatch: noops with the scheduler's defer reason when nothing is dispatched", () => {
    const store = makeStore();
    const run = store.createRun({ issueId: ISSUE, stage: "execute", name: `execute:${ISSUE}` });
    const task = store.createTask(run.id, {
      name: `execute:${ISSUE}`,
      resources: DEFAULT_EXECUTE_RESOURCES,
    });
    const input = snapshot(store, freshCtx({ runId: run.id, taskId: task.id }), {
      schedule: {
        dispatched: [],
        reasons: [{ taskId: task.id, code: "no-capacity", detail: "no eligible host has capacity" }],
      },
    });
    const next = decideExecuteStep(input);
    expect(next.kind).toBe("noop");
    expect(next).toMatchObject({ reason: "no_dispatch" });
    // Noop decisions are eventless: the deferral reason lives in the injected
    // schedule output and would re-emit an event on every unchanged tick.
    expect(next).toMatchObject({ events: [] });
  });

  it("happy path: run -> task -> schedule -> dispatch -> workspace -> run -> verify", () => {
    const store = makeStore();
    const ctx = freshCtx();
    const steps: ExecuteCommandKind[] = [];
    let decision = decideExecuteStep(snapshot(store, ctx));
    let guard = 0;
    while (decision.kind === "command" && guard < 30) {
      steps.push(decision.command.kind);
      applyCommand(store, decision.command, ctx);
      guard += 1;
      decision = decideExecuteStep(snapshot(store, ctx));
    }
    expect(steps).toEqual([
      "create-run",
      "create-task",
      "compute-schedule",
      "dispatch",
      "prepare-workspace",
      "run-task",
    ]);
    expect(decision).toMatchObject({ kind: "noop", reason: "waiting_for_runner" });
    expect(store.getTask(ctx.taskId)?.state).toBe("running");

    // Runner completes -> verify (running -> verifying); the handoff carries
    // the validated lease fence so the driver re-enforces store fencing.
    ctx.runner = { kind: "completed", taskId: ctx.taskId };
    const verify = decideExecuteStep(snapshot(store, ctx));
    expect(verify).toMatchObject({
      kind: "command",
      command: { kind: "verify", taskId: ctx.taskId, fence: { owner: OWNER, leaseId: expect.any(String) } },
    });
  });

  it("stale lease: fencing reclaims an expired lease instead of running", () => {
    const { store, ctx } = driveToRunning();
    // Default lease TTL is 5 minutes; the lease expires at 10:05, so at 10:40
    // the fence must block the in-flight task and ask for recovery.
    const input = snapshot(store, ctx, { now: "2026-08-25T10:40:00.000Z" });
    const decision = decideExecuteStep(input);
    expect(decision.kind).toBe("command");
    if (decision.kind === "command") {
      expect(decision.command).toMatchObject({ kind: "recover", taskId: ctx.taskId, reason: "lease_expired" });
    }
    expect(decision).toMatchObject({
      events: [{ kind: "task.lease_revoked", payload: { taskId: ctx.taskId, reason: "lease_expired" } }],
    });
  });

  it("checkLeaseFence: rejects missing, mismatched, released, foreign, and expired leases", () => {
    const task = { id: "task-1" };
    const valid = {
      id: "lease-1",
      taskId: "task-1",
      host: "vps" as HostId,
      owner: OWNER,
      createdAt: NOW,
      expiresAt: "2026-08-25T10:05:00.000Z",
      releasedAt: null,
    };
    expect(checkLeaseFence(valid, task, OWNER, "2026-08-25T10:04:00.000Z")).toEqual({ ok: true });
    expect(checkLeaseFence(null, task, OWNER, NOW)).toEqual({ ok: false, reason: "lease_missing" });
    expect(checkLeaseFence({ ...valid, taskId: "other" }, task, OWNER, NOW)).toEqual({
      ok: false,
      reason: "lease_task_mismatch",
    });
    expect(checkLeaseFence({ ...valid, releasedAt: NOW }, task, OWNER, NOW)).toEqual({
      ok: false,
      reason: "lease_released",
    });
    expect(checkLeaseFence({ ...valid, owner: "other" }, task, OWNER, NOW)).toEqual({
      ok: false,
      reason: "lease_owner_mismatch",
    });
    expect(checkLeaseFence({ ...valid, expiresAt: NOW }, task, OWNER, "2026-08-25T10:00:01.000Z")).toEqual({
      ok: false,
      reason: "lease_expired",
    });
  });

  it("runner failure: failed report issues fail with retry timing metadata", () => {
    const { store, ctx } = driveToRunning();
    ctx.runner = { kind: "failed", taskId: ctx.taskId, error: "tests failed", retryable: true };
    const decision = decideExecuteStep(snapshot(store, ctx));
    expect(decision).toMatchObject({
      kind: "command",
      command: {
        kind: "fail",
        taskId: ctx.taskId,
        error: "tests failed",
        retryable: true,
        notBefore: retryNotBefore(NOW, 1),
        fence: { owner: OWNER, leaseId: expect.any(String) },
      },
      events: [{ kind: "execute.failed", payload: { taskId: ctx.taskId, error: "tests failed", retryable: true } }],
    });
    if (decision.kind === "command") {
      applyCommand(store, decision.command, ctx);
      // The retry decision is durable on the task, written atomically with the
      // failure; the coordinator reads it back from the snapshot.
      const failed = store.getTask(ctx.taskId);
      expect(failed?.retryable).toBe(true);
      expect(failed?.nextRetryAt).toBe(retryNotBefore(NOW, 1));
    }
    // The task is not retried inline: it stays failed and waits for its backoff.
    const task = store.getTask(ctx.taskId);
    expect(task?.state).toBe("failed");
    expect(task?.attempts).toBe(1);
    // Before the backoff elapses the coordinator waits.
    expect(decideExecuteStep(snapshot(store, ctx))).toMatchObject({ kind: "noop", reason: "retry_pending" });
    // Once the backoff has elapsed the coordinator emits the explicit retry.
    const later = decideExecuteStep(snapshot(store, ctx, { now: "2026-08-25T10:00:31.000Z" }));
    expect(later).toMatchObject({
      kind: "command",
      command: {
        kind: "retry",
        taskId: ctx.taskId,
        fence: { owner: OWNER, leaseId: null },
      },
    });
    if (later.kind === "command") applyCommand(store, later.command, ctx);
    expect(store.getTask(ctx.taskId)?.state).toBe("ready");
    expect(store.getTask(ctx.taskId)?.attempts).toBe(1);
    // Applying the retry consumed the durable decision.
    expect(store.getTask(ctx.taskId)?.retryable).toBe(false);
    expect(store.getTask(ctx.taskId)?.nextRetryAt).toBeNull();
  });

  it("runner failure (non-retryable): fail leaves the task failed", () => {
    const { store, ctx } = driveToRunning();
    ctx.runner = { kind: "failed", taskId: ctx.taskId, error: "unrecoverable", retryable: false };
    const decision = decideExecuteStep(snapshot(store, ctx));
    expect(decision).toMatchObject({
      kind: "command",
      command: { kind: "fail", taskId: ctx.taskId, error: "unrecoverable", retryable: false },
    });
    if (decision.kind === "command") {
      applyCommand(store, decision.command, ctx);
    }
    expect(store.getTask(ctx.taskId)?.state).toBe("failed");
  });

  it("runner cancel: cancelled report issues a cancel command", () => {
    const { store, ctx } = driveToRunning();
    ctx.runner = { kind: "cancelled", taskId: ctx.taskId };
    const decision = decideExecuteStep(snapshot(store, ctx));
    expect(decision).toMatchObject({ kind: "command", command: { kind: "cancel", taskId: ctx.taskId } });
  });

  it("verification failure: failed verdict issues fail and the task is retried", () => {
    const { store, ctx } = driveToVerifying();
    ctx.verification = { taskId: ctx.taskId, verdict: "failed", evidence: [], error: "review found defects" };
    const decision = decideExecuteStep(snapshot(store, ctx));
    expect(decision).toMatchObject({
      kind: "command",
      command: { kind: "fail", taskId: ctx.taskId, retryable: true },
    });
    if (decision.kind === "command") {
      applyCommand(store, decision.command, ctx);
    }
    // The task is not retried inline: it stays failed and waits for its backoff.
    expect(store.getTask(ctx.taskId)?.state).toBe("failed");
    expect(store.getTask(ctx.taskId)?.attempts).toBe(1);
    // Once the backoff has elapsed the coordinator emits the explicit retry.
    const later = decideExecuteStep(snapshot(store, ctx, { now: "2026-08-25T10:00:31.000Z" }));
    expect(later).toMatchObject({
      kind: "command",
      command: { kind: "retry", taskId: ctx.taskId },
    });
    if (later.kind === "command") {
      applyCommand(store, later.command, ctx);
    }
    expect(store.getTask(ctx.taskId)?.state).toBe("ready");
    expect(store.getTask(ctx.taskId)?.attempts).toBe(1);
  });

  it("success: passed verdict issues succeed and completes the task", () => {
    const { store, ctx } = driveToVerifying();
    const evidence = ["code_checks", "package_tests"];
    ctx.verification = { taskId: ctx.taskId, verdict: "passed", evidence, error: null };
    const decision = decideExecuteStep(snapshot(store, ctx));
    expect(decision).toMatchObject({
      kind: "command",
      command: { kind: "succeed", taskId: ctx.taskId, evidence },
      events: [{ kind: "execute.completed", payload: { taskId: ctx.taskId, evidence } }],
    });
    if (decision.kind === "command") {
      applyCommand(store, decision.command, ctx);
    }
    const task = store.getTask(ctx.taskId);
    expect(task?.state).toBe("succeeded");
    expect(task?.error).toBeNull();
    const lease = store.leases().find((lease) => lease.taskId === ctx.taskId);
    expect(lease?.releasedAt).toBe(NOW);
  });

  it("noops when the run is already terminal", () => {
    const store = makeStore();
    const run = store.createRun({ issueId: ISSUE, stage: "execute", name: `execute:${ISSUE}` });
    store.completeRun(run.id, "succeeded");
    const decision = decideExecuteStep(snapshot(store, freshCtx({ runId: run.id })));
    expect(decision).toMatchObject({ kind: "noop", reason: "run_not_active" });
  });
});
