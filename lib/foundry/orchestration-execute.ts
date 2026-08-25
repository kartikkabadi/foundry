// Execute-stage integration coordinator for the multi-agent system.
//
// Pure decision seam between the Walk's execute stage and the orchestration
// adapters (store, scheduler, workspace, runner, verifier). On each call it
// checks, in order:
//
//   1. the multi-agent feature switch
//   2. the issue stage (must be "execute")
//   3. the orchestration run state
//   4. the scheduler decision
//   5. the workspace plan
//   6. lease fencing
//   7. the runner report
//   8. the verification verdict
//
// and returns a typed command (plus the events the caller should append to the
// event log) for the next step, or a noop with a reason when nothing is due.
//
// This module is data-only: it never touches the database, spawns a process,
// creates a PR, cleans up, or mutates anything. All inputs are injected, so
// every decision is a pure function of the snapshot. The caller (a future tiny
// change to execute.ts) reads the decision, applies the command through the
// real adapters, appends the returned events, and re-invokes with a fresh
// snapshot. Store transitions remain the source of truth; the CAS on the
// integer version is the hard backstop when a lease goes stale between ticks.
//
// Purity rules:
//   - Noop decisions are eventless. A recurring noop snapshot (a deferred task,
//     a wrong stage, a disabled switch) is re-evaluated every tick, so emitting
//     an event on each noop would spam the event log. Events fire only on
//     commands (transitions), which is what makes them idempotent: each is
//     recorded exactly once per transition.
//   - The caller MUST pre-gate on `isMultiAgentEnabled` before invoking the
//     coordinator. The `feature_disabled` noop below is a defense-in-depth
//     fallback for when the caller is misconfigured, and it is deliberately
//     eventless.
//   - Terminal commands (`succeed`, `fail`, `cancel`), the `verify` handoff,
//     and the `retry` command carry a `fence` (the executor `owner` plus the
//     `leaseId` the coordinator validated) so the driver can re-enforce store
//     fencing at apply time. `finalize-execute` carries the owner only: no
//     lease is live once the run is terminal.
//   - Retry timing is a pure function of the injected `now` and a deterministic
//     backoff. The `fail` command carries `notBefore`; the caller persists it as
//     the task's durable `nextRetryAt` (with `retryable`), and the coordinator
//     reads the task snapshot to emit the explicit `retry` command once the
//     backoff has elapsed.

import { DEFAULT_MAX_ATTEMPTS, DEFAULT_TEXT_MODEL, isTerminalState } from "./orchestration-types";
import type {
  HostId,
  IsolationKind,
  ModelRequirement,
  ModelRoute,
  OrchestrationRun,
  OrchestrationTask,
  ResourceBudget,
  RunStatus,
  TaskLease,
} from "./orchestration-types";
import type { DispatchDecision, ScheduleOutput } from "./scheduler";
import type { StageId } from "./types";
import type { WorkspacePlan } from "./workspace";

// ---------------------------------------------------------------------------
// Feature switch
// ---------------------------------------------------------------------------

export const MULTIAGENT_ENV_VAR = "FOUNDRY_MULTIAGENT";

/** Feature switch: on only when FOUNDRY_MULTIAGENT=1. Pure function of `env`. */
export function isMultiAgentEnabled(env: Record<string, string | undefined> = {}): boolean {
  return env[MULTIAGENT_ENV_VAR] === "1";
}

// ---------------------------------------------------------------------------
// Injected inputs
// ---------------------------------------------------------------------------

/** Outcome reported by the runner adapter for a task attempt. */
export type RunnerReport =
  | { kind: "completed"; taskId: string }
  | { kind: "failed"; taskId: string; error: string; retryable: boolean }
  | { kind: "cancelled"; taskId: string };

export type VerificationVerdict = "passed" | "failed";

/** Verdict reported by the independent verifier. */
export type VerificationResult = {
  taskId: string;
  verdict: VerificationVerdict;
  evidence: string[];
  error: string | null;
};

/**
 * Snapshot of everything the coordinator needs to decide the next step. Every
 * field is injected by the caller; nothing is read from the environment, the
 * database, or the filesystem.
 */
export type ExecuteStepInput = {
  issueId: string;
  stage: StageId;
  featureEnabled: boolean;
  /** Executor identity that owns leases; the fencing subject. */
  owner: string;
  /** ISO-8601 wall clock; injected so decisions are deterministic. */
  now: string;
  run: OrchestrationRun | null;
  tasks: OrchestrationTask[];
  /** Latest pure scheduler output; null until the caller has run it once. */
  schedule: ScheduleOutput | null;
  /** The dispatch decision applied (or to be applied) for the current task. */
  dispatch: DispatchDecision | null;
  workspace: WorkspacePlan | null;
  lease: TaskLease | null;
  runner: RunnerReport | null;
  verification: VerificationResult | null;
  /**
   * True once the caller has applied the `finalize-execute` command. Guards the
   * terminal command: finalizing the artifact outcome does not change store
   * state, so without this flag the coordinator would re-emit it on every tick.
   */
  finalized: boolean;
};

// ---------------------------------------------------------------------------
// Default task spec for the v1 one-task execute DAG
// ---------------------------------------------------------------------------

export const DEFAULT_EXECUTE_RESOURCES: ResourceBudget = {
  cpu: 1,
  memoryMiB: 1024,
  diskMiB: 4096,
  concurrency: 1,
};

/** Spec handed to `create-task`; the caller may override before applying. */
export type ExecuteTaskSpec = {
  name: string;
  deps: string[];
  host: HostId | null;
  isolation: IsolationKind | null;
  resources: ResourceBudget;
  model: ModelRequirement;
  route: ModelRoute;
  claims: string[];
  maxAttempts: number;
};

export function defaultExecuteTaskSpec(issueId: string): ExecuteTaskSpec {
  return {
    name: `execute:${issueId}`,
    deps: [],
    host: null,
    isolation: "git-worktree",
    resources: { ...DEFAULT_EXECUTE_RESOURCES },
    model: { capability: "text", costCeilingUsd: null },
    route: { primary: DEFAULT_TEXT_MODEL, paidFallback: null, paidCostCeilingUsd: null },
    claims: [],
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
  };
}

// ---------------------------------------------------------------------------
// Retry backoff
// ---------------------------------------------------------------------------

// Deterministic exponential backoff for the execute stage. No jitter: the same
// `now` and attempt produce the same delay, so every retry decision is
// reproducible across process restarts.
export const RETRY_BACKOFF_BASE_MS = 30_000;
export const RETRY_BACKOFF_CAP_MS = 600_000;

/** Exponential backoff in ms for the attempt AFTER `attempt` failures. */
export function retryDelayMs(attempt: number): number {
  const base = RETRY_BACKOFF_BASE_MS * 2 ** Math.max(attempt - 1, 0);
  return Math.min(base, RETRY_BACKOFF_CAP_MS);
}

/** ISO-8601 not-before for the next attempt; a pure function of `now`. */
export function retryNotBefore(now: string, attempt: number): string {
  return new Date(Date.parse(now) + retryDelayMs(attempt)).toISOString();
}

// ---------------------------------------------------------------------------
// Typed commands and events
// ---------------------------------------------------------------------------

export const EXECUTE_NOOP_REASONS = [
  "feature_disabled",
  "wrong_stage",
  "run_not_active",
  "no_dispatch",
  "retry_pending",
  "waiting_for_runner",
  "waiting_for_verifier",
  "task_terminal",
] as const;
export type ExecuteNoopReason = (typeof EXECUTE_NOOP_REASONS)[number];

export const FENCING_REASONS = [
  "lease_missing",
  "lease_released",
  "lease_expired",
  "lease_owner_mismatch",
  "lease_task_mismatch",
  "missing_dispatch",
] as const;
export type FencingReason = (typeof FENCING_REASONS)[number];

export const EXECUTE_COMMAND_KINDS = [
  "create-run",
  "create-task",
  "compute-schedule",
  "dispatch",
  "prepare-workspace",
  "run-task",
  "verify",
  "succeed",
  "fail",
  "cancel",
  "retry",
  "complete-run",
  "finalize-execute",
  "recover",
] as const;
export type ExecuteCommandKind = (typeof EXECUTE_COMMAND_KINDS)[number];

/**
 * Lease fence carried by terminal/retry commands so the driver can re-enforce
 * store fencing at apply time: the executor that owns the lease, plus the lease
 * id the coordinator validated. `leaseId` is null when no lease is live (a
 * retry after the failed task's lease was released).
 */
export type TerminalFence = {
  owner: string;
  leaseId: string | null;
};

/**
 * What the caller should do next. Each kind maps to one adapter/store action;
 * the command carries every value the action needs, so the caller never has to
 * re-derive state.
 */
export type ExecuteCommand =
  | { kind: "create-run"; issueId: string; stage: "execute"; name: string }
  | { kind: "create-task"; runId: string; task: ExecuteTaskSpec }
  | { kind: "compute-schedule"; runId: string }
  | { kind: "dispatch"; taskId: string; decision: DispatchDecision }
  | { kind: "prepare-workspace"; taskId: string; decision: DispatchDecision }
  | { kind: "run-task"; taskId: string; decision: DispatchDecision; workspace: WorkspacePlan }
  | { kind: "verify"; taskId: string; fence: TerminalFence }
  | { kind: "succeed"; taskId: string; evidence: string[]; fence: TerminalFence }
  | { kind: "fail"; taskId: string; error: string; retryable: boolean; notBefore: string | null; fence: TerminalFence }
  | { kind: "cancel"; taskId: string; reason: string; fence: TerminalFence }
  | { kind: "retry"; taskId: string; fence: TerminalFence }
  | { kind: "complete-run"; runId: string; status: Exclude<RunStatus, "active"> }
  | { kind: "finalize-execute"; runId: string; issueId: string; taskId: string; outcome: Exclude<RunStatus, "active">; owner: string }
  | { kind: "recover"; taskId: string; reason: FencingReason };

export const EXECUTE_EVENT_KINDS = [
  "execute.stage_entered",
  "execute.completed",
  "execute.failed",
  "execute.finalized",
  "scheduler.dispatch",
  "task.lease_revoked",
] as const;
export type ExecuteEventKind = (typeof EXECUTE_EVENT_KINDS)[number];

export type ExecuteEvent = {
  issueId: string;
  kind: ExecuteEventKind;
  payload: Record<string, unknown>;
};

/** One-step decision: either a noop (nothing due) or a command + events. */
export type ExecuteStepDecision =
  | { kind: "noop"; reason: ExecuteNoopReason; events: ExecuteEvent[] }
  | { kind: "command"; command: ExecuteCommand; events: ExecuteEvent[] };

// ---------------------------------------------------------------------------
// Lease fencing
// ---------------------------------------------------------------------------

/**
 * Pre-flight fencing check: an in-flight task (leased/running/verifying) must
 * hold a live, un-released lease for this task owned by `owner` that has not
 * expired at `now`. The store's version CAS remains the hard backstop; this is
 * the cheap deterministic check that keeps the coordinator from issuing a run
 * on a lease that is already stale.
 */
export function checkLeaseFence(
  lease: TaskLease | null,
  task: Pick<OrchestrationTask, "id">,
  owner: string,
  now: string,
): { ok: true } | { ok: false; reason: FencingReason } {
  if (lease === null) return { ok: false, reason: "lease_missing" };
  if (lease.taskId !== task.id) return { ok: false, reason: "lease_task_mismatch" };
  if (lease.releasedAt !== null) return { ok: false, reason: "lease_released" };
  if (lease.owner !== owner) return { ok: false, reason: "lease_owner_mismatch" };
  if (lease.expiresAt <= now) return { ok: false, reason: "lease_expired" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

function noopDecision(reason: ExecuteNoopReason): ExecuteStepDecision {
  // Noop decisions are eventless: they recur on unchanged snapshots, and an
  // event per tick would spam the event log. Events fire only on commands.
  return { kind: "noop", reason, events: [] };
}

function commandDecision(command: ExecuteCommand, events: ExecuteEvent[]): ExecuteStepDecision {
  return { kind: "command", command, events };
}

/** Fence for the current in-flight task: the live lease the coordinator validated. */
function fenceOf(input: ExecuteStepInput): TerminalFence {
  return { owner: input.owner, leaseId: input.lease?.id ?? null };
}

function failDecision(
  input: ExecuteStepInput,
  task: OrchestrationTask,
  error: string,
  retryable: boolean,
): ExecuteStepDecision {
  const notBefore = retryable ? retryNotBefore(input.now, task.attempts) : null;
  return commandDecision(
    { kind: "fail", taskId: task.id, error, retryable, notBefore, fence: fenceOf(input) },
    [{ kind: "execute.failed", issueId: input.issueId, payload: { taskId: task.id, error, retryable } }],
  );
}

/**
 * Decide the next step for the execute stage of one issue. Pure: no I/O, no
 * mutation, no clock reads. The returned command's events are what the caller
 * should append via `appendEvent` when it applies the command.
 */
export function decideExecuteStep(input: ExecuteStepInput): ExecuteStepDecision {
  const { issueId } = input;

  // 1. Feature switch: orchestration is opt-in. The caller MUST pre-gate on
  //    isMultiAgentEnabled before invoking the coordinator; off means the
  //    legacy direct execute path keeps running untouched. This noop is a
  //    defense-in-depth fallback and is deliberately eventless.
  if (!input.featureEnabled) {
    return noopDecision("feature_disabled");
  }

  // 2. Stage gate: this coordinator only engages at stage "execute".
  if (input.stage !== "execute") {
    return noopDecision("wrong_stage");
  }

  // 3. Run state: an orchestration run must exist.
  const run = input.run;
  if (run === null) {
    return commandDecision(
      { kind: "create-run", issueId, stage: "execute", name: `execute:${issueId}` },
      [{ kind: "execute.stage_entered", issueId, payload: { stage: "execute" } }],
    );
  }

  const task = input.tasks[0] ?? null;

  // 3a. A terminal run has only one remaining step: finalize the artifact
  //     outcome once (guarded by input.finalized), then nothing. A terminal run
  //     with no task has nothing to finalize.
  if (run.status !== "active") {
    if (task === null) return noopDecision("run_not_active");
    if (!input.finalized) return finalizeDecision(input, run, task, run.status);
    return noopDecision("task_terminal");
  }

  // 3b. Task graph: v1 runs the stage as a single-task DAG.
  if (task === null) {
    return commandDecision(
      { kind: "create-task", runId: run.id, task: defaultExecuteTaskSpec(issueId) },
      [],
    );
  }

  // 6. Lease fencing: an in-flight task must hold a live lease owned by this
  //    executor. Checked before any state-specific decision so a stale lease
  //    never lets a run or verify command through.
  if (task.state === "leased" || task.state === "running" || task.state === "verifying") {
    const fence = checkLeaseFence(input.lease, task, input.owner, input.now);
    if (!fence.ok) {
      return commandDecision(
        { kind: "recover", taskId: task.id, reason: fence.reason },
        [{ kind: "task.lease_revoked", issueId, payload: { taskId: task.id, reason: fence.reason } }],
      );
    }
  }

  // Terminal task inside an active run: either retry a failed task that is due,
  // or wrap up the run once every task is terminal.
  if (isTerminalState(task.state)) {
    return decideTerminal(input, run, task);
  }

  switch (task.state) {
    case "ready":
      return decideReady(input, run, task);
    case "leased":
      return decideLeased(input, task);
    case "running":
      return decideRunning(input, task);
    case "verifying":
      return decideVerifying(input, task);
    default:
      // blocked: nothing due.
      return noopDecision("task_terminal");
  }
}

function decideReady(
  input: ExecuteStepInput,
  run: OrchestrationRun,
  task: OrchestrationTask,
): ExecuteStepDecision {
  // 4. Scheduler decision: ask the caller to run the pure scheduler first.
  if (input.schedule === null) {
    return commandDecision({ kind: "compute-schedule", runId: run.id }, []);
  }
  const dispatch = input.schedule.dispatched.find((d) => d.taskId === task.id);
  if (dispatch !== undefined) {
    return commandDecision(
      { kind: "dispatch", taskId: task.id, decision: dispatch },
      [{ kind: "scheduler.dispatch", issueId: input.issueId, payload: { decisions: [dispatch] } }],
    );
  }
  // No dispatch: the deferral reason lives in the injected schedule output and
  // is re-evaluated next tick. This noop is eventless — recording scheduler.defer
  // here would emit once per tick on an unchanged snapshot.
  return noopDecision("no_dispatch");
}

function decideLeased(input: ExecuteStepInput, task: OrchestrationTask): ExecuteStepDecision {
  const decision = input.dispatch;
  if (decision === null || decision.taskId !== task.id) {
    // Leased without a recorded dispatch decision is a corrupted lease; reclaim.
    return commandDecision(
      { kind: "recover", taskId: task.id, reason: "missing_dispatch" },
      [{ kind: "task.lease_revoked", issueId: input.issueId, payload: { taskId: task.id, reason: "missing_dispatch" } }],
    );
  }
  // 5. Workspace plan: plan (and prepare) before running.
  if (input.workspace === null) {
    return commandDecision({ kind: "prepare-workspace", taskId: task.id, decision }, []);
  }
  return commandDecision({ kind: "run-task", taskId: task.id, decision, workspace: input.workspace }, []);
}

function decideRunning(input: ExecuteStepInput, task: OrchestrationTask): ExecuteStepDecision {
  // 7. Runner result: nothing to do while the runner is still in flight.
  const report = input.runner;
  if (report === null || report.taskId !== task.id) {
    return noopDecision("waiting_for_runner");
  }
  switch (report.kind) {
    case "completed":
      return commandDecision({ kind: "verify", taskId: task.id, fence: fenceOf(input) }, []);
    case "failed":
      // Retry only while the attempt budget remains; otherwise the failure is
      // terminal and the run wraps up.
      return failDecision(input, task, report.error, report.retryable && task.attempts < task.maxAttempts);
    case "cancelled":
      return commandDecision(
        { kind: "cancel", taskId: task.id, reason: "runner cancelled", fence: fenceOf(input) },
        [],
      );
  }
}

function decideVerifying(input: ExecuteStepInput, task: OrchestrationTask): ExecuteStepDecision {
  // 8. Verification verdict: nothing to do while the verifier is still running.
  const result = input.verification;
  if (result === null || result.taskId !== task.id) {
    return noopDecision("waiting_for_verifier");
  }
  if (result.verdict === "passed") {
    return commandDecision(
      { kind: "succeed", taskId: task.id, evidence: result.evidence, fence: fenceOf(input) },
      [{ kind: "execute.completed", issueId: input.issueId, payload: { taskId: task.id, evidence: result.evidence } }],
    );
  }
  return failDecision(input, task, result.error ?? "verification failed", task.attempts < task.maxAttempts);
}

/**
 * A terminal task inside an active run: emit the explicit `retry` command once a
 * pending retry's backoff has elapsed, otherwise close the run with the verdict
 * derived from every task once all of them are terminal.
 */
function decideTerminal(input: ExecuteStepInput, run: OrchestrationRun, task: OrchestrationTask): ExecuteStepDecision {
  if (task.state === "failed") {
    // A durable retryable failure is retried once its `nextRetryAt` has
    // elapsed; otherwise the run closes with the derived verdict. The decision
    // is reconstructed from the task snapshot (persisted atomically with the
    // failure), so it survives driver invocations and store reconnects.
    if (task.retryable && task.nextRetryAt !== null && task.attempts < task.maxAttempts) {
      if (input.now >= task.nextRetryAt) {
        return commandDecision(
          {
            kind: "retry",
            taskId: task.id,
            // The lease was released when the task failed; only the owner is fenced.
            fence: { owner: input.owner, leaseId: null },
          },
          [],
        );
      }
      return noopDecision("retry_pending");
    }
  }
  // v1 is a single-task DAG, but do not complete the run early: wait until every
  // task is terminal, then close the run with the derived verdict.
  if (input.tasks.some((t) => !isTerminalState(t.state))) {
    return noopDecision("task_terminal");
  }
  return commandDecision({ kind: "complete-run", runId: run.id, status: terminalRunStatus(input.tasks) }, []);
}

/** Run verdict derived from the terminal task states. */
function terminalRunStatus(tasks: OrchestrationTask[]): Exclude<RunStatus, "active"> {
  if (tasks.some((task) => task.state === "failed")) return "failed";
  if (tasks.some((task) => task.state === "cancelled")) return "cancelled";
  return "succeeded";
}

/** Terminal command telling the caller to finalize the artifact outcome once. */
function finalizeDecision(
  input: ExecuteStepInput,
  run: OrchestrationRun,
  task: OrchestrationTask,
  outcome: Exclude<RunStatus, "active">,
): ExecuteStepDecision {
  return commandDecision(
    {
      kind: "finalize-execute",
      runId: run.id,
      issueId: input.issueId,
      taskId: task.id,
      outcome,
      // No live lease once the run is terminal; the driver records the owner
      // that finalized the artifact outcome.
      owner: input.owner,
    },
    [{ kind: "execute.finalized", issueId: input.issueId, payload: { runId: run.id, taskId: task.id, outcome } }],
  );
}
