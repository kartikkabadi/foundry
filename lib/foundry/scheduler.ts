import {
  canonicalClaimPath,
  type HostId,
  type ModelCapability,
  type OrchestrationTask,
  type ResourceBudget,
  type TaskState,
} from "./orchestration-types";

/**
 * Pure, deterministic, resource-aware DAG scheduler for Foundry's multi-agent
 * orchestration. Produces dispatch decisions only; execution stays behind
 * adapters (omp-runner, workspace). No I/O, no wall clock, no global state:
 * `now` is injected so identical input always yields identical output.
 *
 * The caller applies decisions: lease each task on its chosen host, record the
 * model, and re-run `schedule` with fresh host/model usage once tasks finish.
 */

export type HostState = {
  id: HostId;
  budget: ResourceBudget;
  used: ResourceBudget;
};

export type ModelState = {
  id: string;
  capabilities: readonly ModelCapability[];
  maxConcurrent: number;
  concurrent: number;
  cooldownUntil?: string;
};

export type SchedulePolicy = {
  /** Positive burst cost ceiling (USD) that enables Box as an overflow host. */
  boxBurstCostCeilingUsd?: number;
};

export type ScheduleInput = {
  tasks: OrchestrationTask[];
  hosts: Partial<Record<HostId, HostState>>;
  models: Record<string, ModelState>;
  now: string;
  /** Optional schedule policy; Box stays disabled unless a positive burst ceiling is set. */
  policy?: SchedulePolicy;
  /**
   * Optional pure gate state, keyed by gate ID. A gate listed as `true` is
   * satisfied (answered); a gate that is absent or `false` is pending. The
   * scheduler only reads this state to defer gate-bound tasks — it never
   * answers, mutates, or emits gates.
   */
  gates?: Readonly<Record<string, boolean>>;
  /**
   * Optional per-task gate requirements: task ID -> the gate IDs that must be
   * satisfied before the task may dispatch. Tasks absent here are not
   * gate-bound and keep all existing scheduling behavior.
   */
  requiredGatesByTask?: Readonly<Record<string, readonly string[]>>;
};

export type DispatchDecision = {
  taskId: string;
  host: HostId;
  model: string;
};

export type DispatchReasonCode =
  | "blocked-by-pending-gate"
  | "blocked-by-pending-dependency"
  | "blocked-by-failed-dependency"
  | "blocked-by-cancelled-dependency"
  | "not-ready"
  | "file-conflict"
  | "no-cost-ceiling"
  | "model-unavailable"
  | "model-concurrency"
  | "model-cooldown"
  | "no-eligible-host"
  | "box-disabled"
  | "no-capacity";

export type DispatchReason = {
  taskId: string;
  code: DispatchReasonCode;
  detail: string;
};

export type ScheduleOutput = {
  dispatched: DispatchDecision[];
  reasons: DispatchReason[];
};

// charCode of "/", used to detect path-prefix boundaries without allocating.
const SLASH_CHAR_CODE = 47;

// Shared empty claims array so claim-less tasks allocate nothing.
const EMPTY_CLAIMS: string[] = [];

function isBoxEnabled(policy: SchedulePolicy | undefined): boolean {
  const ceiling = policy?.boxBurstCostCeilingUsd;
  return ceiling !== undefined && Number.isFinite(ceiling) && ceiling > 0;
}

function overlapNormalized(first: string, second: string): boolean {
  if (first === second) return true;
  if (first.length > second.length && first.startsWith(second) && first.charCodeAt(second.length) === SLASH_CHAR_CODE) {
    return true;
  }
  if (second.length > first.length && second.startsWith(first) && second.charCodeAt(first.length) === SLASH_CHAR_CODE) {
    return true;
  }
  return false;
}

/** True when one write path equals the other or contains it as a subdirectory. */
export function overlappingPaths(first: string, second: string): boolean {
  return overlapNormalized(canonicalClaimPath(first), canonicalClaimPath(second));
}

function isInFlight(state: TaskState): boolean {
  return state === "leased" || state === "running" || state === "verifying";
}

function fitsOnHost(
  host: HostState,
  task: OrchestrationTask,
  dispatchedDelta: ResourceBudget | undefined,
): boolean {
  const requirement = task.resources;
  const used = host.used;
  const budget = host.budget;
  if (used.cpu + (dispatchedDelta?.cpu ?? 0) + requirement.cpu > budget.cpu) return false;
  if (used.memoryMiB + (dispatchedDelta?.memoryMiB ?? 0) + requirement.memoryMiB > budget.memoryMiB) return false;
  if (used.diskMiB + (dispatchedDelta?.diskMiB ?? 0) + requirement.diskMiB > budget.diskMiB) return false;
  if (used.concurrency + (dispatchedDelta?.concurrency ?? 0) + requirement.concurrency > budget.concurrency) {
    return false;
  }
  return true;
}

type HostPick =
  | { ok: true; host: HostState }
  | { ok: false; reason: "no-eligible-host" | "box-disabled" | "no-capacity"; detail: string };

function pickHost(
  task: OrchestrationTask,
  hosts: Partial<Record<HostId, HostState>>,
  dispatchedByHost: Map<HostId, ResourceBudget>,
  boxEnabled: boolean,
): HostPick {
  const pinned = task.host;
  if (pinned !== null) {
    const host = hosts[pinned];
    if (!host) {
      return { ok: false, reason: "no-eligible-host", detail: `host ${pinned} is not registered for ${task.id}` };
    }
    // Box is paid burst capacity: even an explicit pin does not override the
    // disabled default — a positive burst cost ceiling is required to select it.
    if (pinned === "box" && !boxEnabled) {
      return {
        ok: false,
        reason: "box-disabled",
        detail: `task ${task.id} is pinned to box, but no positive burst cost ceiling is set`,
      };
    }
    if (fitsOnHost(host, task, dispatchedByHost.get(pinned))) return { ok: true, host };
    return { ok: false, reason: "no-capacity", detail: `host ${pinned} has no capacity for ${task.id}` };
  }

  // Free tasks: vps first; box only as overflow, and only when a positive burst
  // cost ceiling enables it.
  const vps = hosts.vps;
  const box = hosts.box;
  if (vps !== undefined && fitsOnHost(vps, task, dispatchedByHost.get("vps"))) {
    return { ok: true, host: vps };
  }
  if (box !== undefined && boxEnabled && fitsOnHost(box, task, dispatchedByHost.get("box"))) {
    return { ok: true, host: box };
  }
  if (vps === undefined && box === undefined) {
    return { ok: false, reason: "no-eligible-host", detail: `no eligible host for ${task.id}` };
  }
  if (box !== undefined && !boxEnabled) {
    return {
      ok: false,
      reason: "box-disabled",
      detail: `only disabled box could run ${task.id}; set a positive burst cost ceiling to enable box`,
    };
  }
  return { ok: false, reason: "no-capacity", detail: `no eligible host has capacity for ${task.id}` };
}

function tryModel(
  modelId: string,
  capability: ModelCapability,
  models: Record<string, ModelState>,
  dispatchedByModel: Map<string, number>,
  now: string,
): { id: string } | { reason: DispatchReasonCode; detail: string } {
  const model = models[modelId];
  if (!model) {
    return { reason: "model-unavailable", detail: `model ${modelId} is not registered` };
  }
  if (capability === "vision" && !model.capabilities.includes("vision")) {
    return { reason: "model-unavailable", detail: `model ${modelId} cannot handle vision work` };
  }
  if (capability === "text" && !model.capabilities.includes("text")) {
    return { reason: "model-unavailable", detail: `model ${modelId} cannot handle text work` };
  }
  const inFlight = model.concurrent + (dispatchedByModel.get(modelId) ?? 0);
  if (model.cooldownUntil !== undefined && now < model.cooldownUntil) {
    return { reason: "model-cooldown", detail: `model ${modelId} is cooling down until ${model.cooldownUntil}` };
  }
  if (inFlight >= model.maxConcurrent) {
    return {
      reason: "model-concurrency",
      detail: `model ${modelId} is at its concurrency limit (${model.maxConcurrent})`,
    };
  }
  return { id: modelId };
}

function pickModel(
  task: OrchestrationTask,
  models: Record<string, ModelState>,
  dispatchedByModel: Map<string, number>,
  now: string,
): { id: string } | { reason: DispatchReasonCode; detail: string } {
  const primary = tryModel(task.route.primary, task.model.capability, models, dispatchedByModel, now);
  if ("id" in primary) return primary;

  // A paid fallback is only reachable with an explicit cost ceiling.
  const fallback = task.route.paidFallback;
  if (!fallback) return primary;
  if (task.route.paidCostCeilingUsd === null) {
    return {
      reason: "no-cost-ceiling",
      detail: `task ${task.id} routes to paid fallback ${fallback} without an explicit cost ceiling`,
    };
  }
  return tryModel(fallback, task.model.capability, models, dispatchedByModel, now);
}

function pendingGateBlocker(
  task: OrchestrationTask,
  gates: Readonly<Record<string, boolean>> | undefined,
  requiredGatesByTask: Readonly<Record<string, readonly string[]>> | undefined,
): { code: DispatchReasonCode; detail: string } | null {
  const required = requiredGatesByTask?.[task.id];
  if (!required || required.length === 0) return null;
  const pending: string[] = [];
  for (const gateId of required) {
    if (gates?.[gateId] !== true) pending.push(gateId);
  }
  if (pending.length === 0) return null;
  // Sorted copy so the reported order never depends on the caller's input order.
  pending.sort();
  return {
    code: "blocked-by-pending-gate",
    detail: `pending required gates: ${pending.join(", ")}`,
  };
}

function dependencyBlocker(
  task: OrchestrationTask,
  byId: Map<string, OrchestrationTask>,
): { code: DispatchReasonCode; detail: string } | null {
  for (const dependencyId of task.deps) {
    const dependency = byId.get(dependencyId);
    if (!dependency) {
      return { code: "blocked-by-pending-dependency", detail: `dependency ${dependencyId} is unknown` };
    }
    if (dependency.state === "succeeded") continue;
    if (dependency.state === "failed") {
      return { code: "blocked-by-failed-dependency", detail: `dependency ${dependencyId} failed` };
    }
    if (dependency.state === "cancelled") {
      return { code: "blocked-by-cancelled-dependency", detail: `dependency ${dependencyId} was cancelled` };
    }
    return { code: "blocked-by-pending-dependency", detail: `dependency ${dependencyId} is ${dependency.state}` };
  }
  return null;
}

function hasClaimConflict(claims: string[], claimedPaths: string[]): boolean {
  for (const claim of claims) {
    for (const heldPath of claimedPaths) {
      if (overlapNormalized(claim, heldPath)) return true;
    }
  }
  return false;
}

function byAge(first: OrchestrationTask, second: OrchestrationTask): number {
  if (first.createdAt < second.createdAt) return -1;
  if (first.createdAt > second.createdAt) return 1;
  if (first.id < second.id) return -1;
  if (first.id > second.id) return 1;
  return 0;
}

export function schedule(input: ScheduleInput): ScheduleOutput {
  const { tasks, hosts, models, now } = input;
  const boxEnabled = isBoxEnabled(input.policy);

  const byId = new Map<string, OrchestrationTask>();
  for (const task of tasks) byId.set(task.id, task);

  // Write paths held by tasks already occupying capacity (leased/running/verifying).
  const claimedPaths: string[] = [];
  for (const task of tasks) {
    if (isInFlight(task.state) && task.claims.length > 0) {
      for (const path of task.claims) claimedPaths.push(canonicalClaimPath(path));
    }
  }

  const dispatchedByHost = new Map<HostId, ResourceBudget>();
  const dispatchedByModel = new Map<string, number>();
  const dispatched: DispatchDecision[] = [];
  const reasons: DispatchReason[] = [];

  // Age-based fairness: oldest ready tasks first; id breaks createdAt ties.
  const ready = tasks.filter((task) => task.state === "ready").sort(byAge);

  for (const task of ready) {
    const gateBlocked = pendingGateBlocker(task, input.gates, input.requiredGatesByTask);
    if (gateBlocked) {
      reasons.push({ taskId: task.id, code: gateBlocked.code, detail: gateBlocked.detail });
      continue;
    }

    const blockedBy = dependencyBlocker(task, byId);
    if (blockedBy) {
      reasons.push({ taskId: task.id, code: blockedBy.code, detail: blockedBy.detail });
      continue;
    }

    const claims = task.claims.length === 0 ? EMPTY_CLAIMS : task.claims.map(canonicalClaimPath);
    if (hasClaimConflict(claims, claimedPaths)) {
      reasons.push({
        taskId: task.id,
        code: "file-conflict",
        detail: "write claims overlap an in-flight or already dispatched task",
      });
      continue;
    }

    const modelPick = pickModel(task, models, dispatchedByModel, now);
    if ("reason" in modelPick) {
      reasons.push({ taskId: task.id, code: modelPick.reason, detail: modelPick.detail });
      continue;
    }

    const hostPick = pickHost(task, hosts, dispatchedByHost, boxEnabled);
    if (!hostPick.ok) {
      reasons.push({ taskId: task.id, code: hostPick.reason, detail: hostPick.detail });
      continue;
    }

    dispatched.push({ taskId: task.id, host: hostPick.host.id, model: modelPick.id });

    const hostDelta = dispatchedByHost.get(hostPick.host.id);
    if (hostDelta === undefined) {
      dispatchedByHost.set(hostPick.host.id, {
        cpu: task.resources.cpu,
        memoryMiB: task.resources.memoryMiB,
        diskMiB: task.resources.diskMiB,
        concurrency: task.resources.concurrency,
      });
    } else {
      hostDelta.cpu += task.resources.cpu;
      hostDelta.memoryMiB += task.resources.memoryMiB;
      hostDelta.diskMiB += task.resources.diskMiB;
      hostDelta.concurrency += task.resources.concurrency;
    }

    dispatchedByModel.set(modelPick.id, (dispatchedByModel.get(modelPick.id) ?? 0) + 1);

    if (claims.length > 0) {
      for (const path of claims) claimedPaths.push(path);
    }
  }

  for (const task of tasks) {
    if (task.state !== "blocked") continue;
    const blockedBy = dependencyBlocker(task, byId);
    if (blockedBy) {
      reasons.push({ taskId: task.id, code: blockedBy.code, detail: blockedBy.detail });
    } else {
      reasons.push({
        taskId: task.id,
        code: "not-ready",
        detail: "all dependencies succeeded; task is not marked ready",
      });
    }
  }

  return { dispatched, reasons };
}
