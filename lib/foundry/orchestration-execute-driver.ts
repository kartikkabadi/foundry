// v1 execute-stage runtime driver.
//
// The coordinator (`decideExecuteStep`) is a pure function: it decides one
// step at a time from an injected snapshot and returns a command + its audit
// events. This driver is the thin runtime loop that turns those decisions into
// durable store/scheduler/workspace/runner/verifier effects.
//
// Design:
// - Everything the driver touches is injected (`ExecuteDriverEffects`); there
//   is no default runtime construction here. The durable store is a real
//   `OrchestrationStore`; the scheduler, workspace preparer, runner, verifier,
//   audit-event sink and finalize callback are interfaces the caller wires up.
// - The loop is bounded (`maxTicks`, default 100). Each tick rebuilds a fresh
//   snapshot from the store, asks the coordinator for the next step, applies
//   the command serially, then appends the command's audit events.
// - The owner is stable for the driver's lifetime and every terminal store
//   call (`succeed`/`fail`/`cancel`) passes it through the command's fence.
// - The coordinator's `complete-run` and `finalize-execute` commands each fire
//   once: the store's version CAS makes `completeRun` atomic, and the retained
//   `finalized` flag guards the finalize callback.
// - Retry is durable on the task snapshot (`retryable` + `nextRetryAt`), so a
//   caller can wait out the backoff and re-invoke — even with a fresh store
//   connection — and the coordinator reconstructs the due retry from the task.
// - Recovery is handled only where the store supports it: a stale expired
//   lease is reclaimed via `expireLeases`. Every other fence reason
//   (missing/released/owner-mismatched/task-mismatched lease, missing dispatch)
//   is unrecoverable from this driver and fails closed — the loop stops with a
//   `failed` result and no unsafe mutation.
//
// When the switch is off the driver pre-gates with zero mutation: it returns a
// `skipped` result and never touches the store or any effect, so the legacy
// direct execute path keeps running untouched.

import { decideExecuteStep } from "./orchestration-execute";
import type {
  ExecuteCommand,
  ExecuteNoopReason,
  ExecuteStepInput,
  RunnerReport,
  VerificationResult,
} from "./orchestration-execute";
import type { OrchestrationStore } from "./orchestration-store";
import type {
  Isolation,
  OrchestrationRun,
  OrchestrationTask,
  RunStatus,
  TaskLease,
} from "./orchestration-types";
import type { DispatchDecision, ScheduleOutput } from "./scheduler";
import type { StageId } from "./types";
import type { WorkspacePlan } from "./workspace";

// ---------------------------------------------------------------------------
// Injected effects
// ---------------------------------------------------------------------------

/**
 * Pure scheduler invocation. The effect owns host/model state and returns the
 * full schedule output; the driver picks the dispatch for the current task.
 */
export type ScheduleEffect = (input: {
  runId: string;
  tasks: OrchestrationTask[];
  now: string;
}) => ScheduleOutput;

/** Workspace preparation for a dispatched task; returns the plan. */
export type WorkspaceEffect = (input: {
  task: OrchestrationTask;
  decision: DispatchDecision;
}) => WorkspacePlan;

/** Runner execution; resolves with the attempt report once it settles. */
export type RunnerEffect = (input: {
  taskId: string;
  decision: DispatchDecision;
  workspace: WorkspacePlan;
}) => RunnerReport | Promise<RunnerReport>;

/** Independent verifier; resolves with the verdict once it settles. */
export type VerifierEffect = (input: { taskId: string }) => VerificationResult | Promise<VerificationResult>;

/** Audit event sink; the coordinator's returned events are appended through it. */
export type AppendEventEffect = (issueId: string, kind: string, payload: Record<string, unknown>) => void;

/**
 * Finalize callback. Success writes the execute artifact and clears the legacy
 * execute job; any other outcome records a legacy execute failure. Fired at
 * most once per run, guarded by `ExecuteDriverState.finalized`.
 */
export type FinalizeExecuteInput = {
  runId: string;
  issueId: string;
  taskId: string;
  outcome: Exclude<RunStatus, "active">;
  owner: string;
  /** Failure detail for non-success outcomes; null on success. */
  error: string | null;
};
export type FinalizeEffect = (input: FinalizeExecuteInput) => void;

export type ExecuteDriverEffects = {
  /** Durable orchestration store (real SQLite-backed store). */
  store: OrchestrationStore;
  schedule: ScheduleEffect;
  prepareWorkspace: WorkspaceEffect;
  run: RunnerEffect;
  verify: VerifierEffect;
  appendEvent: AppendEventEffect;
  finalize: FinalizeEffect;
};

// ---------------------------------------------------------------------------
// Options and retained state
// ---------------------------------------------------------------------------

export type ExecuteDriverOptions = {
  issueId: string;
  stage: StageId;
  /** Caller pre-gate on `isMultiAgentEnabled`; off means zero mutation. */
  featureEnabled: boolean;
  /** Stable executor identity that owns leases; passed to every terminal call. */
  owner: string;
  /** Injected clock; ISO-8601 wall clock, deterministic per tick. */
  now: () => string;
  /**
   * Pre-resolved physical write-path identities for the task this driver
   * creates. The caller (the orchestration runtime) resolves requested claim
   * strings against the sanctioned root BEFORE the driver runs; the driver
   * persists these authoritative identities verbatim at `create-task` and
   * never re-resolves or reinterprets claim strings. Absent → the
   * coordinator's task-spec claims pass through unchanged, so direct driver
   * use keeps working with pre-resolved input.
   */
  claims?: string[];
  /** Bounded loop budget; defaults to DEFAULT_MAX_EXECUTE_TICKS. */
  maxTicks?: number;
};

export const DEFAULT_MAX_EXECUTE_TICKS = 100;

/**
 * Caller-retained driver state. Only `finalized` must survive across
 * invocations so the driver re-finalizes exactly once; retry is durable on the
 * task snapshot (`retryable` + `nextRetryAt`), so a due retry is reconstructed
 * from the store even across a fresh connection.
 */
export type ExecuteDriverState = {
  schedule: ScheduleOutput | null;
  dispatch: DispatchDecision | null;
  workspace: WorkspacePlan | null;
  runner: RunnerReport | null;
  verification: VerificationResult | null;
  finalized: boolean;
};

export const EMPTY_EXECUTE_DRIVER_STATE: ExecuteDriverState = {
  schedule: null,
  dispatch: null,
  workspace: null,
  runner: null,
  verification: null,
  finalized: false,
};

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type ExecuteDriverResult =
  | { status: "skipped"; reason: "feature_disabled" | "wrong_stage"; ticks: number; state: ExecuteDriverState }
  | { status: "done"; outcome: Exclude<RunStatus, "active">; ticks: number; state: ExecuteDriverState }
  | { status: "waiting"; reason: ExecuteNoopReason; ticks: number; state: ExecuteDriverState }
  | { status: "exhausted"; ticks: number; state: ExecuteDriverState }
  | { status: "failed"; error: string; ticks: number; state: ExecuteDriverState };

/** Thrown when a command cannot be applied safely; the loop fails closed. */
export class ExecuteDriverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecuteDriverError";
  }
}

// ---------------------------------------------------------------------------
// Snapshot + command application
// ---------------------------------------------------------------------------

function currentRun(
  store: OrchestrationStore,
  issueId: string,
  stage: StageId,
): OrchestrationRun | null {
  return store.listRuns().find((run) => run.issueId === issueId && run.stage === stage) ?? null;
}

/** Rebuild the coordinator's injected snapshot from fresh store state. */
function buildInput(
  effects: ExecuteDriverEffects,
  options: ExecuteDriverOptions,
  state: ExecuteDriverState,
): ExecuteStepInput {
  const run = currentRun(effects.store, options.issueId, options.stage);
  const tasks = run ? effects.store.listTasks(run.id) : [];
  const task = tasks[0] ?? null;
  const lease: TaskLease | null = task?.leaseId
    ? (effects.store.leases().find((lease) => lease.id === task.leaseId) ?? null)
    : null;
  return {
    issueId: options.issueId,
    stage: options.stage,
    featureEnabled: options.featureEnabled,
    owner: options.owner,
    now: options.now(),
    run,
    tasks,
    schedule: state.schedule,
    dispatch: state.dispatch,
    workspace: state.workspace,
    lease,
    runner: state.runner,
    verification: state.verification,
    finalized: state.finalized,
  };
}

/**
 * Apply one coordinator command through the durable store and the injected
 * effects. Mirrors the adapter applyCommand shape from the coordinator tests:
 * the only differences are that `run-task`/`verify` resolve the injected
 * runner/verifier effect and retain the report, `fail` persists the retry
 * decision onto the task, `finalize-execute` invokes the finalize callback
 * once, and `recover` fails closed for any fence reason the store cannot repair.
 */
async function applyCommand(
  effects: ExecuteDriverEffects,
  options: ExecuteDriverOptions,
  state: ExecuteDriverState,
  command: ExecuteCommand,
): Promise<void> {
  switch (command.kind) {
    case "create-run":
      effects.store.createRun({ issueId: command.issueId, stage: command.stage, name: command.name });
      return;

    case "create-task": {
      const run = currentRun(effects.store, options.issueId, options.stage);
      if (!run) {
        throw new ExecuteDriverError(`create-task failed: no active run for issue ${options.issueId}`);
      }
      // The coordinator carries the bare isolation kind; the store persists the
      // authoritative domain Isolation (kind + ref). Keep null for no isolation.
      const isolation: Isolation | null = command.task.isolation
        ? { kind: command.task.isolation, ref: command.task.name }
        : null;
      // The coordinator's task spec carries no physical claims; the caller
      // resolves claim strings to canonical physical identities before the
      // driver runs and they are persisted verbatim here. Absent → the spec's
      // claims pass through (pre-resolved input for direct driver use).
      const claims = options.claims ?? command.task.claims;
      effects.store.createTask(run.id, {
        name: command.task.name,
        deps: command.task.deps,
        resources: command.task.resources,
        host: command.task.host,
        isolation,
        model: command.task.model,
        route: command.task.route,
        maxAttempts: command.task.maxAttempts,
        claims,
      });
      return;
    }

    case "compute-schedule": {
      const tasks = effects.store.listTasks(command.runId);
      const output = effects.schedule({ runId: command.runId, tasks, now: options.now() });
      state.schedule = output;
      // v1 is a single-task DAG; the current task is the run's only task.
      state.dispatch = output.dispatched.find((decision) => decision.taskId === (tasks[0]?.id ?? "")) ?? null;
      return;
    }

    case "dispatch":
      effects.store.leaseTask(command.taskId, { host: command.decision.host, owner: options.owner });
      state.dispatch = command.decision;
      return;

    case "prepare-workspace": {
      const task = effects.store.getTask(command.taskId);
      if (!task) {
        throw new ExecuteDriverError(`prepare-workspace failed: task ${command.taskId} not found`);
      }
      state.workspace = effects.prepareWorkspace({ task, decision: command.decision });
      return;
    }

    case "run-task": {
      effects.store.startTask(command.taskId, options.owner);
      state.workspace = command.workspace;
      state.runner = null;
      state.runner = await effects.run({
        taskId: command.taskId,
        decision: command.decision,
        workspace: command.workspace,
      });
      return;
    }

    case "verify": {
      effects.store.verifyTask(command.taskId, command.fence.owner);
      state.verification = null;
      state.verification = await effects.verify({ taskId: command.taskId });
      return;
    }

    case "succeed":
      effects.store.succeedTask(command.taskId, command.fence.owner);
      return;

    case "fail": {
      // The retry decision is persisted atomically with the failure as durable
      // task facts (`retryable` + `nextRetryAt`); the coordinator reconstructs
      // the explicit retry command from the task snapshot once the backoff
      // elapses. Nothing is retained in driver state.
      effects.store.failTask(command.taskId, command.error, command.fence.owner, {
        retryable: command.retryable,
        nextRetryAt: command.notBefore,
      });
      return;
    }

    case "retry":
      effects.store.retryTask(command.taskId);
      return;

    case "cancel":
      effects.store.cancelTask(command.taskId, command.fence.owner, command.reason);
      return;

    case "complete-run":
      effects.store.completeRun(command.runId, command.status);
      return;

    case "finalize-execute": {
      const task = effects.store.getTask(command.taskId);
      const error = command.outcome === "failed" ? (task?.error ?? command.outcome) : null;
      effects.finalize({
        runId: command.runId,
        issueId: command.issueId,
        taskId: command.taskId,
        outcome: command.outcome,
        owner: command.owner,
        error,
      });
      state.finalized = true;
      return;
    }

    case "recover": {
      // The store supports only expired-lease recovery. Any other fence reason
      // (missing/released/owner-mismatched/task-mismatched lease, missing
      // dispatch) cannot be repaired from this driver, so fail closed rather
      // than spin or mutate state we do not own.
      if (command.reason === "lease_expired") {
        effects.store.expireLeases(options.now());
        return;
      }
      throw new ExecuteDriverError(
        `unrecoverable fence ${command.reason} for task ${command.taskId}: no store-supported recovery; failing closed`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Run loop
// ---------------------------------------------------------------------------

/** Terminal outcome when the run is terminal and the finalize callback fired. */
function terminalOutcome(
  effects: ExecuteDriverEffects,
  options: ExecuteDriverOptions,
  state: ExecuteDriverState,
): Exclude<RunStatus, "active"> | null {
  const run = currentRun(effects.store, options.issueId, options.stage);
  if (run && run.status !== "active" && state.finalized) return run.status;
  return null;
}

/**
 * Drive one issue's execute stage to the next stable point. Applies commands
 * serially from fresh snapshots until the coordinator returns a noop, the run
 * reaches a terminal finalized state, the tick budget is exhausted, or a
 * command cannot be applied (fails closed).
 *
 * Re-invocation: pass the returned `state` back in to resume after a `waiting`
 * noop (for example `retry_pending` once the backoff has elapsed). Retry is
 * durable on the task snapshot, so a due retry is reconstructed from the store
 * even across a fresh connection; only the finalized flag must survive
 * invocations.
 */
export async function runExecuteDriver(
  effects: ExecuteDriverEffects,
  options: ExecuteDriverOptions,
  state: ExecuteDriverState = { ...EMPTY_EXECUTE_DRIVER_STATE },
): Promise<ExecuteDriverResult> {
  const maxTicks = options.maxTicks ?? DEFAULT_MAX_EXECUTE_TICKS;
  const driverState: ExecuteDriverState = { ...EMPTY_EXECUTE_DRIVER_STATE, ...state };

  // Pre-gate: orchestration is opt-in and this driver only engages at the
  // execute stage. Off/stage-mismatch means zero mutation and zero effects, so
  // the legacy direct execute path keeps running untouched.
  if (!options.featureEnabled) {
    return { status: "skipped", reason: "feature_disabled", ticks: 0, state: driverState };
  }
  if (options.stage !== "execute") {
    return { status: "skipped", reason: "wrong_stage", ticks: 0, state: driverState };
  }

  for (let tick = 0; tick < maxTicks; tick += 1) {
    const decision = decideExecuteStep(buildInput(effects, options, driverState));

    if (decision.kind === "noop") {
      const outcome = terminalOutcome(effects, options, driverState);
      if (outcome !== null) return { status: "done", outcome, ticks: tick, state: driverState };
      if (decision.reason === "feature_disabled" || decision.reason === "wrong_stage") {
        return { status: "skipped", reason: decision.reason, ticks: tick, state: driverState };
      }
      return { status: "waiting", reason: decision.reason, ticks: tick, state: driverState };
    }

    try {
      await applyCommand(effects, options, driverState, decision.command);
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        ticks: tick + 1,
        state: driverState,
      };
    }

    for (const event of decision.events) {
      effects.appendEvent(event.issueId, event.kind, event.payload);
    }

    const outcome = terminalOutcome(effects, options, driverState);
    if (outcome !== null) return { status: "done", outcome, ticks: tick + 1, state: driverState };
  }

  return { status: "exhausted", ticks: maxTicks, state: driverState };
}
