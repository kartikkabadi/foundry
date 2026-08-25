import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { overlappingPaths } from "./scheduler";
import { orchestrationConnection } from "./store";
import { appendEvent, readEvents } from "./log";
import { dataDir } from "./paths";
import { STAGES, type StageId } from "./types";
import {
  canTransition,
  isTerminalState,
  DEFAULT_COST_CEILING_USD,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TEXT_MODEL,
  LEGAL_TRANSITIONS,
  type AttemptStatus,
  type GraphValidation,
  type HostId,
  type Isolation,
  type IsolationKind,
  type ModelCapability,
  type ModelRequirement,
  type ModelRoute,
  type OrchestrationEvent,
  type OrchestrationRun,
  type OrchestrationTask,
  type ResourceBudget,
  type RunStatus,
  type TaskArtifact,
  type TaskAttempt,
  type TaskLease,
  type TaskState,
} from "./orchestration-types";

export type OrchestrationStoreOptions = {
  now?: () => string;
  id?: () => string;
};

const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;

function isoAfter(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function mapRun(row: Record<string, unknown>): OrchestrationRun {
  return {
    id: String(row.id),
    issueId: String(row.issue_id),
    stage: row.stage as StageId,
    name: String(row.name),
    status: row.status as RunStatus,
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapTask(row: Record<string, unknown>): OrchestrationTask {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    name: String(row.name),
    state: row.state as TaskState,
    version: Number(row.version),
    deps: JSON.parse(String(row.deps)) as string[],
    host: row.host ? (row.host as HostId) : null,
    isolation: row.isolation_kind
      ? { kind: row.isolation_kind as IsolationKind, ref: String(row.isolation_ref) }
      : null,
    resources: JSON.parse(String(row.resources)) as ResourceBudget,
    model: JSON.parse(String(row.model)) as ModelRequirement,
    route: JSON.parse(String(row.route)) as ModelRoute,
    claims: JSON.parse(String(row.claims)) as string[],
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    retryable: Number(row.retryable) === 1,
    nextRetryAt: row.next_retry_at === null ? null : String(row.next_retry_at),
    error: row.error === null ? null : String(row.error),
    leaseId: row.lease_id === null ? null : String(row.lease_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: row.started_at === null ? null : String(row.started_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at),
  };
}

function mapAttempt(row: Record<string, unknown>): TaskAttempt {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    index: Number(row.idx),
    status: row.status as AttemptStatus,
    startedAt: String(row.started_at),
    endedAt: row.ended_at === null ? null : String(row.ended_at),
    error: row.error === null ? null : String(row.error),
  };
}

function mapLease(row: Record<string, unknown>): TaskLease {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    host: row.host as HostId,
    owner: String(row.owner),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    releasedAt: row.released_at === null ? null : String(row.released_at),
  };
}

function mapArtifact(row: Record<string, unknown>): TaskArtifact {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    kind: String(row.kind),
    path: row.path === null ? null : String(row.path),
    body: row.body === null ? null : String(row.body),
    createdAt: String(row.created_at),
  };
}

/**
 * Durable orchestration store backed by the existing SQLite database
 * (`data/foundry.sqlite`, shared with every other Foundry table via
 * `orchestrationConnection`). There is no second database and no
 * `orchestration_events` table: every orchestration event is appended to the
 * existing per-issue JSONL Event log through `appendEvent`.
 *
 * State survives a new store instance (a fresh OrchestrationStore reads the
 * same rows), and every mutation is a version compare-and-set: tasks and runs
 * carry an integer `version` that is bumped on each write, so a stale write
 * (one based on an outdated snapshot) fails instead of clobbering newer state.
 */
export class OrchestrationStore {
  private readonly stamp: () => string;
  private readonly newId: () => string;

  constructor(private readonly options: OrchestrationStoreOptions = {}) {
    this.stamp = options.now ?? (() => new Date().toISOString());
    this.newId = options.id ?? randomUUID;
  }

  private get conn(): DatabaseSync {
    return orchestrationConnection();
  }

  private tx<T>(fn: () => T): T {
    const conn = this.conn;
    conn.exec("BEGIN");
    try {
      const result = fn();
      conn.exec("COMMIT");
      return result;
    } catch (error) {
      conn.exec("ROLLBACK");
      throw error;
    }
  }

  private recordEvent(
    runId: string,
    taskId: string | null,
    kind: string,
    payload: Record<string, unknown>,
  ): void {
    const run = this.getRun(runId);
    if (!run) return;
    appendEvent(run.issueId, kind, { ...payload, runId, taskId });
  }

  private requireRun(runId: string): OrchestrationRun {
    const run = this.getRun(runId);
    assert(run, `unknown orchestration run: ${runId}`);
    return run;
  }

  private requireTask(taskId: string): OrchestrationTask {
    const task = this.getTask(taskId);
    assert(task, `unknown task: ${taskId}`);
    return task;
  }

  private assertTransition(task: OrchestrationTask, to: TaskState): void {
    if (!canTransition(task.state, to)) {
      throw new Error(
        `illegal transition task ${task.id}: ${task.state} -> ${to} (allowed: ${LEGAL_TRANSITIONS[task.state].join(", ")})`,
      );
    }
  }

  private writeTask(task: OrchestrationTask): OrchestrationTask {
    const result = this.conn
      .prepare(
        `UPDATE orchestration_tasks SET
          state = ?, deps = ?, host = ?, isolation_kind = ?, isolation_ref = ?,
          resources = ?, model = ?, route = ?, claims = ?, attempts = ?,
          retryable = ?, next_retry_at = ?,
          error = ?, lease_id = ?, version = version + 1, updated_at = ?,
          started_at = ?, completed_at = ?
         WHERE id = ? AND version = ?`,
      )
      .run(
        task.state,
        JSON.stringify(task.deps),
        task.host,
        task.isolation?.kind ?? null,
        task.isolation?.ref ?? null,
        JSON.stringify(task.resources),
        JSON.stringify(task.model),
        JSON.stringify(task.route),
        JSON.stringify(task.claims),
        task.attempts,
        task.retryable ? 1 : 0,
        task.nextRetryAt,
        task.error,
        task.leaseId,
        task.updatedAt,
        task.startedAt,
        task.completedAt,
        task.id,
        task.version ?? 1,
      );
    if (result.changes !== 1) {
      throw new Error(`stale write: task ${task.id} (version ${task.version ?? 1} no longer current)`);
    }
    task.version = (task.version ?? 1) + 1;
    return task;
  }

  private writeClaims(task: OrchestrationTask): void {
    this.conn.prepare("DELETE FROM orchestration_claims WHERE task_id = ?").run(task.id);
    for (const path of task.claims) {
      this.conn
        .prepare("INSERT OR IGNORE INTO orchestration_claims (task_id, path) VALUES (?, ?)")
        .run(task.id, path);
    }
  }

  private satisfied(depIds: string[]): { ok: boolean; unsatisfied: string[] } {
    const unsatisfied = depIds.filter((depId) => {
      const dep = this.getTask(depId);
      return !dep || dep.state !== "succeeded";
    });
    return { ok: unsatisfied.length === 0, unsatisfied };
  }

  private dependenciesSatisfied(taskId: string): { ok: boolean; unsatisfied: string[] } {
    return this.satisfied(this.requireTask(taskId).deps);
  }

  private dependents(taskId: string): OrchestrationTask[] {
    const rows = this.conn.prepare("SELECT * FROM orchestration_tasks").all() as Record<string, unknown>[];
    return rows.map(mapTask).filter((task) => task.deps.includes(taskId));
  }

  private unblockDependents(taskId: string): void {
    for (const dependent of this.dependents(taskId)) {
      if (dependent.state !== "blocked") continue;
      const check = this.dependenciesSatisfied(dependent.id);
      if (!check.ok) continue;
      dependent.state = "ready";
      dependent.updatedAt = this.stamp();
      this.writeTask(dependent);
      this.recordEvent(dependent.runId, dependent.id, "task.unblocked", {
        byTask: taskId,
      });
    }
  }

  private finishAttempt(taskId: string, status: AttemptStatus, error: string | null, endedAt: string): void {
    this.conn
      .prepare(
        "UPDATE orchestration_attempts SET status = ?, ended_at = ?, error = ? WHERE task_id = ? AND status = 'running'",
      )
      .run(status, endedAt, error, taskId);
  }

  private getLease(id: string): TaskLease | null {
    const row = this.conn.prepare("SELECT * FROM orchestration_leases WHERE id = ?").get(id);
    return row ? mapLease(row as Record<string, unknown>) : null;
  }

  private releaseLeaseInternal(task: OrchestrationTask, reason: string, now: string): void {
    const lease = task.leaseId ? this.getLease(task.leaseId) : null;
    if (lease && lease.releasedAt === null) {
      this.conn
        .prepare("UPDATE orchestration_leases SET released_at = ? WHERE id = ? AND released_at IS NULL")
        .run(now, lease.id);
      this.recordEvent(task.runId, task.id, "task.lease_released", {
        leaseId: lease.id,
        reason,
      });
    }
    task.leaseId = null;
    task.host = null;
  }

  private clearClaims(task: OrchestrationTask): void {
    if (task.claims.length === 0) return;
    const released = [...task.claims];
    task.claims = [];
    this.conn.prepare("DELETE FROM orchestration_claims WHERE task_id = ?").run(task.id);
    this.recordEvent(task.runId, task.id, "task.claims_released", {
      paths: released,
    });
  }

  private claimConflicts(
    paths: string[],
    excludeTaskId: string | null,
  ): Array<{ path: string; taskId: string }> {
    const candidates = [...new Set(paths.map((path) => path.trim()).filter((path) => path.length > 0))];
    const conflicts: Array<{ path: string; taskId: string }> = [];
    const claims = this.conn
      .prepare("SELECT task_id AS task_id, path FROM orchestration_claims")
      .all() as Array<{ task_id: string; path: string }>;
    for (const claim of claims) {
      if (excludeTaskId !== null && claim.task_id === excludeTaskId) continue;
      for (const path of candidates) {
        if (overlappingPaths(path, claim.path)) {
          conflicts.push({ path, taskId: claim.task_id });
        }
      }
    }
    return conflicts;
  }

  private eventsFromLog(issueId: string): OrchestrationEvent[] {
    const out: OrchestrationEvent[] = [];
    readEvents(issueId).forEach((event, index) => {
      const payload = event.payload ?? {};
      const runId = typeof payload.runId === "string" ? payload.runId : undefined;
      if (!runId) return;
      out.push({
        seq: index + 1,
        ts: event.ts,
        runId,
        taskId: typeof payload.taskId === "string" ? payload.taskId : null,
        kind: event.kind,
        payload: { ...payload },
      });
    });
    return out;
  }

  private issueLogIds(): string[] {
    try {
      const dir = join(dataDir(), "logs");
      return readdirSync(dir)
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => name.slice(0, -".jsonl".length));
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------

  createRun(input: { issueId: string; stage: StageId; name: string }): OrchestrationRun {
    assert(input.issueId.trim().length > 0, "run issueId must not be empty");
    assert(STAGES.includes(input.stage), `unknown stage: ${input.stage}`);
    assert(input.name.trim().length > 0, "run name must not be empty");
    const id = this.newId();
    const now = this.stamp();
    const run: OrchestrationRun = {
      id,
      issueId: input.issueId.trim(),
      stage: input.stage,
      name: input.name.trim(),
      status: "active",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.conn
      .prepare(
        `INSERT INTO orchestration_runs (id, issue_id, stage, name, status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 1, ?, ?)`,
      )
      .run(run.id, run.issueId, run.stage, run.name, now, now);
    this.recordEvent(id, null, "run.created", {
      name: run.name,
      issueId: run.issueId,
      stage: run.stage,
    });
    return run;
  }

  getRun(id: string): OrchestrationRun | null {
    const row = this.conn.prepare("SELECT * FROM orchestration_runs WHERE id = ?").get(id);
    return row ? mapRun(row as Record<string, unknown>) : null;
  }

  listRuns(): OrchestrationRun[] {
    const rows = this.conn.prepare("SELECT * FROM orchestration_runs ORDER BY created_at").all();
    return (rows as Record<string, unknown>[]).map(mapRun);
  }

  completeRun(runId: string, status: Exclude<RunStatus, "active">): OrchestrationRun {
    const run = this.requireRun(runId);
    assert(run.status === "active", `run ${runId} already ${run.status}`);
    const pending = this.listTasks(runId).filter((task) => !isTerminalState(task.state));
    assert(pending.length === 0, `run ${runId} has ${pending.length} unfinished tasks`);
    const result = this.conn
      .prepare(
        `UPDATE orchestration_runs SET status = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ? AND status = 'active'`,
      )
      .run(status, this.stamp(), runId, run.version);
    assert(result.changes === 1, `stale write: run ${runId} changed since read`);
    this.recordEvent(runId, null, "run.completed", { status });
    return this.requireRun(runId);
  }

  // -------------------------------------------------------------------------
  // Tasks and the task graph
  // -------------------------------------------------------------------------

  createTask(
    runId: string,
    input: {
      name: string;
      deps?: string[];
      resources: ResourceBudget;
      host?: HostId | null;
      isolation?: Isolation | null;
      model?: Partial<ModelRequirement>;
      route?: ModelRoute;
      maxAttempts?: number;
      claims?: string[];
    },
  ): OrchestrationTask {
    const run = this.requireRun(runId);
    assert(run.status === "active", `run ${runId} is ${run.status}; cannot add tasks`);
    assert(input.name.trim().length > 0, "task name must not be empty");
    assert(input.resources.cpu >= 0, "resource cpu must be non-negative");
    assert(input.resources.memoryMiB >= 0, "resource memoryMiB must be non-negative");
    assert(input.resources.diskMiB >= 0, "resource diskMiB must be non-negative");
    assert(input.resources.concurrency >= 1, "resource concurrency must be at least 1");
    assert(input.maxAttempts === undefined || input.maxAttempts >= 1, "maxAttempts must be at least 1");

    const deps = input.deps ?? [];
    for (const depId of deps) {
      assert(depId !== "", "dependency id must not be empty");
      const dep = this.getTask(depId);
      assert(dep, `task ${depId} referenced as dependency does not exist`);
      assert(dep.runId === runId, `dependency ${depId} is in a different run than ${runId}`);
    }

    const initialClaims = [
      ...new Set((input.claims ?? []).map((path) => path.trim()).filter((path) => path.length > 0)),
    ];
    const claimConflicts = this.claimConflicts(initialClaims, null);
    assert(
      claimConflicts.length === 0,
      `task claims overlap with other tasks: ${claimConflicts
        .map((conflict) => `${conflict.path} (claimed by ${conflict.taskId})`)
        .join(", ")}`,
    );

    const id = this.newId();
    const now = this.stamp();
    const capability: ModelCapability = input.model?.capability ?? "text";
    const costCeilingUsd = input.model?.costCeilingUsd ?? DEFAULT_COST_CEILING_USD;
    const route: ModelRoute = input.route ?? {
      primary: DEFAULT_TEXT_MODEL,
      paidFallback: null,
      paidCostCeilingUsd: null,
    };
    if (route.paidFallback) {
      assert(
        route.paidCostCeilingUsd !== null,
        `task ${id} routes to paid fallback ${route.paidFallback} without a cost ceiling; set paidCostCeilingUsd`,
      );
      assert(
        route.paidCostCeilingUsd > 0,
        `task ${id} paid cost ceiling must be positive, got ${route.paidCostCeilingUsd}`,
      );
    }

    const check = this.satisfied(deps);
    const state: TaskState = deps.length === 0 || check.ok ? "ready" : "blocked";

    const task: OrchestrationTask = {
      id,
      runId,
      name: input.name.trim(),
      state,
      version: 1,
      deps: [...deps],
      host: input.host ?? null,
      isolation: input.isolation ?? null,
      resources: { ...input.resources },
      model: { capability, costCeilingUsd },
      route,
      claims: initialClaims,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      retryable: false,
      nextRetryAt: null,
      error: null,
      leaseId: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };
    this.tx(() => {
      this.conn
        .prepare(
          `INSERT INTO orchestration_tasks (
            id, run_id, name, state, version, deps, host, isolation_kind, isolation_ref,
            resources, model, route, claims, attempts, max_attempts, retryable, next_retry_at,
            error, lease_id, created_at, updated_at, started_at, completed_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, NULL, NULL, NULL, ?, ?, NULL, NULL)`,
        )
        .run(
          task.id,
          task.runId,
          task.name,
          task.state,
          JSON.stringify(task.deps),
          task.host,
          task.isolation?.kind ?? null,
          task.isolation?.ref ?? null,
          JSON.stringify(task.resources),
          JSON.stringify(task.model),
          JSON.stringify(task.route),
          JSON.stringify(task.claims),
          task.maxAttempts,
          now,
          now,
        );
      this.writeClaims(task);
    });
    this.recordEvent(runId, id, "task.created", {
      name: task.name,
      state,
      deps: task.deps,
      model: task.model.capability,
    });
    if (initialClaims.length > 0) {
      this.recordEvent(runId, id, "task.claims_claimed", { paths: initialClaims });
    }
    return task;
  }

  addDependency(taskId: string, depId: string): OrchestrationTask {
    const task = this.requireTask(taskId);
    const dep = this.requireTask(depId);
    assert(dep.runId === task.runId, `dependency ${depId} is in a different run than ${taskId}`);
    assert(depId !== taskId, `task ${taskId} cannot depend on itself`);
    assert(!task.deps.includes(depId), `task ${taskId} already depends on ${depId}`);
    assert(!isTerminalState(task.state), `task ${taskId} is ${task.state}; cannot add dependencies`);

    // Adding taskId -> depId creates a cycle iff depId already reaches taskId.
    let reaches = false;
    const stack = [...dep.deps];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (current === taskId) {
        reaches = true;
        break;
      }
      if (seen.has(current)) continue;
      seen.add(current);
      const node = this.getTask(current);
      if (node) stack.push(...node.deps);
    }
    assert(!reaches, `dependency ${depId} -> ${taskId} would create a cycle`);

    task.deps.push(depId);
    if (task.state === "ready" && !this.dependenciesSatisfied(taskId).ok) {
      task.state = "blocked";
    }
    task.updatedAt = this.stamp();
    this.writeTask(task);
    this.recordEvent(task.runId, task.id, "task.dep_added", { dep: depId });
    return task;
  }

  validateGraph(runId: string): GraphValidation {
    this.requireRun(runId);
    const tasks = this.listTasks(runId);
    const errors: string[] = [];
    const byId = new Map(tasks.map((task) => [task.id, task]));

    for (const task of tasks) {
      for (const depId of task.deps) {
        if (!byId.has(depId)) {
          errors.push(`task ${task.id} depends on missing task ${depId}`);
        }
      }
    }

    const visited = new Set<string>();
    const onStack = new Set<string>();
    const visit = (taskId: string, path: string[]): void => {
      if (onStack.has(taskId)) {
        const cycleStart = path.indexOf(taskId);
        const cycle = [...path.slice(cycleStart), taskId];
        errors.push(`cycle detected: ${cycle.join(" -> ")}`);
        return;
      }
      if (visited.has(taskId)) return;
      visited.add(taskId);
      onStack.add(taskId);
      const task = byId.get(taskId);
      for (const depId of task?.deps ?? []) {
        visit(depId, [...path, taskId]);
      }
      onStack.delete(taskId);
    };
    for (const task of tasks) visit(task.id, []);

    return { ok: errors.length === 0, errors };
  }

  getTask(id: string): OrchestrationTask | null {
    const row = this.conn.prepare("SELECT * FROM orchestration_tasks WHERE id = ?").get(id);
    return row ? mapTask(row as Record<string, unknown>) : null;
  }

  listTasks(runId?: string): OrchestrationTask[] {
    const rows = runId
      ? (this.conn.prepare("SELECT * FROM orchestration_tasks WHERE run_id = ? ORDER BY created_at").all(
          runId,
        ) as Record<string, unknown>[])
      : (this.conn.prepare("SELECT * FROM orchestration_tasks ORDER BY created_at").all() as Record<
          string,
          unknown
        >[]);
    return rows.map(mapTask);
  }

  unblock(taskId: string): OrchestrationTask {
    const task = this.requireTask(taskId);
    assert(task.state === "blocked", `task ${taskId} is ${task.state}; only blocked tasks can be unblocked`);
    const check = this.dependenciesSatisfied(taskId);
    assert(
      check.ok,
      `task ${taskId} cannot be unblocked; unsatisfied deps: ${check.unsatisfied.join(", ")} (deps must be succeeded)`,
    );
    task.state = "ready";
    task.updatedAt = this.stamp();
    this.writeTask(task);
    this.recordEvent(task.runId, task.id, "task.unblocked", { byTask: null });
    return task;
  }

  // State mutation is intentionally exposed only through the domain methods
  // below. In-flight transitions require an active owner lease and terminal
  // transitions also maintain attempts, claims, and lease state atomically.
  // A generic public transition would bypass those invariants.

  // -------------------------------------------------------------------------
  // Leases
  // -------------------------------------------------------------------------

  leaseTask(
    taskId: string,
    input: { host: HostId; owner: string; ttlMs?: number },
  ): OrchestrationTask {
    const task = this.requireTask(taskId);
    this.assertTransition(task, "leased");
    const now = this.stamp();
    const ttlMs = input.ttlMs ?? DEFAULT_LEASE_TTL_MS;
    assert(ttlMs > 0, "lease ttlMs must be positive");
    assert(input.owner.trim().length > 0, "lease owner must not be empty");
    // I6.4: a task never has more than one live lease at a time.
    const live = this.conn
      .prepare("SELECT id FROM orchestration_leases WHERE task_id = ? AND released_at IS NULL")
      .get(taskId);
    assert(!live, `task ${taskId} already has a live lease`);
    const lease: TaskLease = {
      id: this.newId(),
      taskId,
      host: input.host,
      owner: input.owner,
      createdAt: now,
      expiresAt: isoAfter(now, ttlMs),
      releasedAt: null,
    };
    this.tx(() => {
      this.conn
        .prepare(
          `INSERT INTO orchestration_leases (id, task_id, host, owner, created_at, expires_at, released_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(lease.id, lease.taskId, lease.host, lease.owner, lease.createdAt, lease.expiresAt);
      task.state = "leased";
      task.host = input.host;
      task.leaseId = lease.id;
      task.updatedAt = now;
      this.writeTask(task);
    });
    this.recordEvent(task.runId, task.id, "task.leased", {
      leaseId: lease.id,
      host: input.host,
      owner: input.owner,
      expiresAt: lease.expiresAt,
    });
    return task;
  }

  private requireActiveLease(task: OrchestrationTask, owner: string, now: string): TaskLease {
    assert(task.leaseId, `task ${task.id} has no active lease`);
    const lease = this.getLease(task.leaseId);
    assert(lease, `lease ${task.leaseId} missing for task ${task.id}`);
    assert(lease.releasedAt === null, `lease ${lease.id} was already released`);
    assert(lease.owner === owner, `lease ${lease.id} is owned by ${lease.owner}, not ${owner}`);
    assert(lease.expiresAt > now, `lease ${lease.id} for task ${task.id} expired at ${lease.expiresAt}`);
    return lease;
  }

  renewLease(taskId: string, owner: string, ttlMs?: number): OrchestrationTask {
    const task = this.requireTask(taskId);
    assert(
      task.state === "leased" || task.state === "running" || task.state === "verifying",
      `task ${taskId} is ${task.state}; only leased, running, or verifying tasks can renew`,
    );
    const now = this.stamp();
    const lease = this.requireActiveLease(task, owner, now);
    const ttl = ttlMs ?? DEFAULT_LEASE_TTL_MS;
    assert(ttl > 0, "lease ttlMs must be positive");
    const expiresAt = isoAfter(now, ttl);
    const result = this.conn
      .prepare(
        "UPDATE orchestration_leases SET expires_at = ? WHERE id = ? AND released_at IS NULL AND expires_at = ?",
      )
      .run(expiresAt, lease.id, lease.expiresAt);
    assert(result.changes === 1, `stale write: lease ${lease.id} changed since read`);
    task.updatedAt = now;
    this.writeTask(task);
    this.recordEvent(task.runId, task.id, "task.lease_renewed", {
      leaseId: lease.id,
      expiresAt,
    });
    return task;
  }

  releaseLease(taskId: string, owner: string): OrchestrationTask {
    const task = this.requireTask(taskId);
    const now = this.stamp();
    const lease = this.requireActiveLease(task, owner, now);
    this.tx(() => {
      this.conn
        .prepare("UPDATE orchestration_leases SET released_at = ? WHERE id = ? AND released_at IS NULL")
        .run(now, lease.id);
      task.leaseId = null;
      task.host = null;
      if (task.state === "leased") {
        task.state = "ready";
      }
      task.updatedAt = now;
      this.writeTask(task);
    });
    this.recordEvent(task.runId, task.id, "task.lease_released", {
      leaseId: lease.id,
      reason: "explicit",
    });
    return task;
  }

  expireLeases(nowIso?: string): number {
    const now = nowIso ?? this.stamp();
    const rows = this.conn
      .prepare(
        `SELECT t.* FROM orchestration_tasks t
         JOIN orchestration_leases l ON l.task_id = t.id
         WHERE t.state IN ('leased','running','verifying')
           AND l.released_at IS NULL AND l.expires_at <= ?`,
      )
      .all(now) as Record<string, unknown>[];
    let expired = 0;
    for (const row of rows) {
      const task = mapTask(row);
      if (!task.leaseId) continue;
      const lease = this.getLease(task.leaseId);
      if (!lease || lease.releasedAt !== null) continue;
      this.tx(() => {
        this.conn
          .prepare("UPDATE orchestration_leases SET released_at = ? WHERE id = ? AND released_at IS NULL")
          .run(now, lease.id);
        this.finishAttempt(task.id, "failed", "lease expired", now);
        task.leaseId = null;
        task.host = null;
        task.retryable = false;
        task.nextRetryAt = null;
        task.updatedAt = now;
        if (task.state === "leased") {
          // Attempt never started: leased -> ready (I10.3 recovery, no budget spent).
          task.state = "ready";
          task.error = null;
          task.completedAt = null;
        } else {
          // running/verifying: the attempt failed. Move through `failed`, and
          // only back to `ready` while retry budget remains; otherwise the task
          // is terminal-failed (I6.5, I10.3).
          task.state = "failed";
          task.error = "lease expired";
          task.completedAt = now;
          if (task.attempts < task.maxAttempts) {
            task.state = "ready";
            task.error = null;
            task.completedAt = null;
          }
        }
        this.writeTask(task);
      });
      this.recordEvent(task.runId, task.id, "task.lease_expired", {
        leaseId: lease.id,
        owner: lease.owner,
        expiresAt: lease.expiresAt,
      });
      expired += 1;
    }
    return expired;
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  startTask(taskId: string, owner: string): OrchestrationTask {
    const task = this.requireTask(taskId);
    this.assertTransition(task, "running");
    const now = this.stamp();
    const lease = this.requireActiveLease(task, owner, now);
    task.state = "running";
    task.startedAt = task.startedAt ?? now;
    task.attempts += 1;
    task.updatedAt = now;
    const attempt: TaskAttempt = {
      id: this.newId(),
      taskId,
      index: task.attempts,
      status: "running",
      startedAt: now,
      endedAt: null,
      error: null,
    };
    this.tx(() => {
      this.writeTask(task);
      this.conn
        .prepare(
          `INSERT INTO orchestration_attempts (id, task_id, idx, status, started_at, ended_at, error)
           VALUES (?, ?, ?, 'running', ?, NULL, NULL)`,
        )
        .run(attempt.id, attempt.taskId, attempt.index, now);
    });
    this.recordEvent(task.runId, task.id, "task.started", {
      leaseId: lease.id,
      attempt: task.attempts,
    });
    this.recordEvent(task.runId, task.id, "attempt.started", {
      attemptId: attempt.id,
      index: attempt.index,
    });
    return task;
  }

  verifyTask(taskId: string, owner: string): OrchestrationTask {
    const task = this.requireTask(taskId);
    this.assertTransition(task, "verifying");
    const now = this.stamp();
    // Fencing: only the executor holding a valid, un-expired lease on this
    // task can move it from running to verifying (I25.1). The verifier takes
    // over from the executor; the lease stays live through the verification
    // phase so a subsequent succeed/fail/cancel remains fenced.
    const lease = this.requireActiveLease(task, owner, now);
    task.state = "verifying";
    task.updatedAt = now;
    this.writeTask(task);
    this.recordEvent(task.runId, task.id, "task.verifying", { leaseId: lease.id });
    return task;
  }

  succeedTask(taskId: string, owner: string): OrchestrationTask {
    const task = this.requireTask(taskId);
    this.assertTransition(task, "succeeded");
    const now = this.stamp();
    // Fencing: only the executor holding a valid, un-expired lease on this
    // task can mark it succeeded (I25.1).
    this.requireActiveLease(task, owner, now);
    task.state = "succeeded";
    task.error = null;
    task.completedAt = now;
    task.updatedAt = now;
    task.retryable = false;
    task.nextRetryAt = null;
    this.tx(() => {
      this.finishAttempt(taskId, "succeeded", null, now);
      this.releaseLeaseInternal(task, "succeeded", now);
      this.clearClaims(task);
      this.writeTask(task);
      this.recordEvent(task.runId, task.id, "task.succeeded", {
        attempts: task.attempts,
      });
      this.unblockDependents(taskId);
    });
    return task;
  }

  failTask(
    taskId: string,
    error: string,
    owner: string,
    opts: { retryable?: boolean; nextRetryAt?: string | null } = {},
  ): OrchestrationTask {
    const task = this.requireTask(taskId);
    this.assertTransition(task, "failed");
    assert(error.trim().length > 0, "failTask requires a non-empty error");
    const now = this.stamp();
    // Fencing: only the executor holding a valid, un-expired lease on this
    // task can fail it (I25.1).
    this.requireActiveLease(task, owner, now);
    task.state = "failed";
    task.error = error.trim();
    task.completedAt = now;
    task.updatedAt = now;
    // The retry decision is a durable task fact, written atomically with the
    // failure: `retryable` records whether another attempt is allowed and
    // `nextRetryAt` the earliest time that attempt may start. A `retryable`
    // failure without a `nextRetryAt` is treated as a permanent failure.
    task.retryable = opts.retryable === true;
    task.nextRetryAt = task.retryable ? (opts.nextRetryAt ?? null) : null;
    this.tx(() => {
      this.finishAttempt(taskId, "failed", error.trim(), now);
      this.releaseLeaseInternal(task, "failed", now);
      this.clearClaims(task);
      this.writeTask(task);
    });
    this.recordEvent(task.runId, task.id, "task.failed", {
      error: error.trim(),
      retryable: task.retryable,
      nextRetryAt: task.nextRetryAt,
    });
    return task;
  }

  retryTask(taskId: string): OrchestrationTask {
    const task = this.requireTask(taskId);
    assert(task.state === "failed", `task ${taskId} is ${task.state}; only failed tasks can be retried`);
    assert(task.attempts < task.maxAttempts, `task ${taskId} has exhausted ${task.maxAttempts} attempts`);
    task.state = "ready";
    task.error = null;
    task.completedAt = null;
    task.leaseId = null;
    task.host = null;
    // The retry is consumed: clear the durable decision so the next failure
    // starts from a clean slate.
    task.retryable = false;
    task.nextRetryAt = null;
    task.updatedAt = this.stamp();
    this.writeTask(task);
    this.recordEvent(task.runId, task.id, "task.retried", {
      attempts: task.attempts,
      maxAttempts: task.maxAttempts,
    });
    return task;
  }

  cancelTask(taskId: string, owner: string, reason?: string): OrchestrationTask {
    const task = this.requireTask(taskId);
    assert(!isTerminalState(task.state), `task ${taskId} is already ${task.state}; cannot cancel`);
    const now = this.stamp();
    // Fencing: cancel is a control-plane terminal transition; the caller must
    // still hold the live lease for the task it cancels (I25.1, I19.4).
    this.requireActiveLease(task, owner, now);
    task.state = "cancelled";
    task.completedAt = now;
    task.updatedAt = now;
    task.retryable = false;
    task.nextRetryAt = null;
    this.tx(() => {
      this.finishAttempt(taskId, "cancelled", reason ?? null, now);
      this.releaseLeaseInternal(task, "cancelled", now);
      this.clearClaims(task);
      this.writeTask(task);
    });
    this.recordEvent(task.runId, task.id, "task.cancelled", { reason: reason ?? null });
    return task;
  }

  // -------------------------------------------------------------------------
  // Attempts
  // -------------------------------------------------------------------------

  listAttempts(taskId: string): TaskAttempt[] {
    this.requireTask(taskId);
    const rows = this.conn
      .prepare("SELECT * FROM orchestration_attempts WHERE task_id = ? ORDER BY idx")
      .all(taskId) as Record<string, unknown>[];
    return rows.map(mapAttempt);
  }

  // -------------------------------------------------------------------------
  // File claims
  // -------------------------------------------------------------------------

  claimFiles(taskId: string, paths: string[], owner: string): OrchestrationTask {
    const task = this.requireTask(taskId);
    const now = this.stamp();
    this.requireActiveLease(task, owner, now);
    assert(!isTerminalState(task.state), `task ${taskId} is ${task.state}; cannot claim files`);
    const normalized = [...new Set(paths.map((path) => path.trim()).filter((path) => path.length > 0))];
    assert(normalized.length > 0, `task ${taskId} claimed no non-empty write paths`);

    const conflicts = this.claimConflicts(normalized, taskId);
    assert(
      conflicts.length === 0,
      `task ${taskId} claims overlap with other tasks: ${conflicts
        .map((conflict) => `${conflict.path} (claimed by ${conflict.taskId})`)
        .join(", ")}`,
    );

    task.claims = [...new Set([...task.claims, ...normalized])];
    task.updatedAt = now;
    this.tx(() => {
      this.writeTask(task);
      this.writeClaims(task);
    });
    this.recordEvent(task.runId, task.id, "task.claims_claimed", { paths: normalized });
    return task;
  }

  releaseClaims(taskId: string, owner: string): OrchestrationTask {
    const task = this.requireTask(taskId);
    const now = this.stamp();
    this.requireActiveLease(task, owner, now);
    task.updatedAt = now;
    this.tx(() => {
      this.clearClaims(task);
      this.writeTask(task);
    });
    return task;
  }

  conflictingClaims(paths: string[]): Array<{ path: string; taskId: string }> {
    return this.claimConflicts(paths, null);
  }

  // -------------------------------------------------------------------------
  // Artifacts
  // -------------------------------------------------------------------------

  addArtifact(
    taskId: string,
    input: { kind: string; path?: string | null; body?: string | null },
    owner: string,
  ): TaskArtifact {
    const task = this.requireTask(taskId);
    this.requireActiveLease(task, owner, this.stamp());
    assert(input.kind.trim().length > 0, "artifact kind must not be empty");
    assert(input.path?.trim() || input.body?.trim(), "artifact needs a path or a body");
    const artifact: TaskArtifact = {
      id: this.newId(),
      taskId,
      kind: input.kind.trim(),
      path: input.path?.trim() ? input.path.trim() : null,
      body: input.body?.trim() ? input.body.trim() : null,
      createdAt: this.stamp(),
    };
    this.conn
      .prepare(
        `INSERT INTO orchestration_artifacts (id, task_id, kind, path, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(artifact.id, artifact.taskId, artifact.kind, artifact.path, artifact.body, artifact.createdAt);
    this.recordEvent(task.runId, task.id, "artifact.created", {
      artifactId: artifact.id,
      kind: artifact.kind,
      path: artifact.path,
    });
    return artifact;
  }

  getArtifact(id: string): TaskArtifact | null {
    const row = this.conn.prepare("SELECT * FROM orchestration_artifacts WHERE id = ?").get(id);
    return row ? mapArtifact(row as Record<string, unknown>) : null;
  }

  listArtifacts(taskId: string): TaskArtifact[] {
    const rows = this.conn
      .prepare("SELECT * FROM orchestration_artifacts WHERE task_id = ? ORDER BY created_at")
      .all(taskId) as Record<string, unknown>[];
    return rows.map(mapArtifact);
  }

  // -------------------------------------------------------------------------
  // Events (the existing JSONL Event log; no orchestration_events table)
  // -------------------------------------------------------------------------

  events(runId?: string): OrchestrationEvent[] {
    if (runId !== undefined) {
      const run = this.requireRun(runId);
      return this.eventsFromLog(run.issueId).filter((event) => event.runId === runId);
    }
    const all: OrchestrationEvent[] = [];
    for (const issueId of this.issueLogIds()) {
      all.push(...this.eventsFromLog(issueId));
    }
    return all;
  }

  eventsForTask(taskId: string): OrchestrationEvent[] {
    const task = this.getTask(taskId);
    if (!task) return [];
    const run = this.getRun(task.runId);
    if (!run) return [];
    return this.eventsFromLog(run.issueId).filter((event) => event.taskId === taskId);
  }

  leases(runId?: string): TaskLease[] {
    const rows = runId
      ? (this.conn
          .prepare(
            "SELECT l.* FROM orchestration_leases l JOIN orchestration_tasks t ON t.id = l.task_id WHERE t.run_id = ? ORDER BY l.created_at",
          )
          .all(runId) as Record<string, unknown>[])
      : (this.conn.prepare("SELECT * FROM orchestration_leases ORDER BY created_at").all() as Record<
          string,
          unknown
        >[]);
    return rows.map(mapLease);
  }
}
