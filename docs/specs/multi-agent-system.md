# Foundry Multi-Agent Engineering System — Architecture Spec

**Status:** Architecture contract (locked for implementation).
**Owner branch:** `agent/foundry-multi-agent-system`.
**Language:** [CONTEXT.md](../CONTEXT.md) terms are law. New orchestration
primitives are named here and in `lib/foundry/orchestration-types.ts`; they
extend Foundry, they do not rename it.

This spec is the single cross-component contract for the multi-agent system.
Implementers MUST satisfy the interfaces and invariants in §§5–16 exactly as
written; the module owners are enumerated in §30. Where this spec and an
existing locked decision conflict, the conflict is resolved here (§3) and any
touch on a locked v1 decision requires a Decision ticket before code.

---

## 0. One-sentence contract

Give a Foundry Issue a **Task DAG** per Walk stage. The **scheduler** turns
ready Tasks into **pure dispatch decisions**; **executors** (adapters) lease
them, run them on a **Host** under **isolation**, and hand results to an
independent **verifier**. Every transition, lease, claim, cost, and gate action
lands in the existing **Event log**. The operator's **Gate** is a hard stop and
no outward action (PR, merge, deploy, paid model, external write) ever happens
without human approval.

In v1, a stage runs as a one-Task DAG end to end behind a feature switch; the
existing single-worker Walk keeps working unchanged when the switch is off.

---

## 1. Scope

### Ships now (in the implementation Issues that follow this contract)

- `OrchestrationRun`, `OrchestrationTask`, `TaskAttempt`, `TaskLease`,
  `TaskArtifact`, `FileClaim`, `OrchestrationEvent`, and the `Host` registry,
  persisted in the existing SQLite store (no second database).
- Task state machine with optimistic concurrency (CAS on `task_id`), legal
  transition enforcement, stale-write rejection.
- DAG model with validation (acyclic, defined deps, no self-deps) and a
  fail-fast cascade for required dependencies.
- Pure scheduler: dependency-aware dispatch honoring host capacities,
  resource budgets, model routing, file claims, cost ceilings, concurrency
  caps, and fairness. Output is a decision; it never executes.
- Execution adapters: `omp-runner` (safe argv-based OMP execution) and
  `workspace` (per-task isolated workspace with containment guards).
- Lease/heartbeat/recovery: grants, renewals, expiry, fencing, watchdog
  reconciliation of dead executors and stale Tasks.
- File claims with overlapping-write-path rejection.
- Model router: text defaults to OMP DeepSeek v4 Flash; image/video analysis
  routes only to vision-capable models; paid fallback requires an explicit
  cost ceiling.
- Cost controls: per-task, per-DAG, per-run budgets; soft stop and hard stop;
  cost-ceiling approval gate.
- Verification: maker/verifier separation; `VerifyContract` (the same five
  interview-gate fields as the oneshot goal); contract-tier always,
  exec-tier when a sandbox runtime is present.
- Event log integration: all orchestration events as new `task.*`, `dag.*`,
  `host.*`, `scheduler.*`, `fusion.*`, `cost.*`, `model.*` kinds via
  `appendEvent`. One audit trail.
- Small-PR policy enforcement at the evidence gate.
- Continual-learning harvest and promote-to-gate rules (v1: recorded and
  operator-approved; never auto-installed).

### Deferred (explicitly not v1)

- Cross-host live migration of a running Task (a killed Task retries; it does
  not migrate mid-flight).
- Automatic Box/Cloudflare burst provisioning (explicit enable + economics
  required; §9.6, §27 Phase 4).
- Full auto-resume of the oneshot Walk after crash (§24).
- Rich model-authored episode/progress prose.
- Multi-host dashboard clustering (single-writer control plane in v1).

### Never in scope

- No auto-merge, no auto-deploy, no destructive cleanup (§19, §28).
- No Foundry data inside any Sandbox (§11.3).
- No second database, no second accounting path, no second event trail
  (§5, §20).

---

## 2. Relationship to current Foundry

The multi-agent system is an **extension behind a feature switch**, in the same
replace-in-place style as oneshot v2 (`FOUNDRY_MULTIAGENT=1`). The existing
Walk, gates, dashboard, and single-worker stages keep working unchanged when
the switch is off. No locked v1 decision is reopened here.

| Current Foundry construct | Multi-agent system construct |
|---|---|
| `Issue` (Issue tracker) | unchanged; a Task's `runId` belongs to an Issue |
| `Walk` (serial stages) | unchanged; remains the single driver per Issue (§4.2) |
| `Gate` (grill/plan/phase/evidence) | unchanged; `cost` and `merge` gates added (§19) |
| `Decision ticket` | unchanged; used for paid-fallback, box-enable, and policy overrides |
| `Sandbox` (Docker checkout) | isolation modes extended: `git-worktree`, `container`, `vm` (§11) |
| `Event log` (`appendEvent`) | every orchestration event is a new kind on the same JSONL (§20) |
| `IssueJob` / `issue_jobs` | `TaskAttempt` + `TaskLease` (§5.3, §5.4) |
| `startStageWorker` / `eve-host` | executor adapter (`omp-runner`) behind the scheduler (§13) |
| `worktreesRoot` / `isSandboxedWorkDir` | `git-worktree` isolation adapter, same containment guard (§11.2) |
| `STALE_JOB_MS` / `watchdog` / `withHeartbeat` | lease expiry + watchdog reconcile (§10) |
| `retry.ts` (`decideRetry`, `nextRetryAt`) | attempt retry with backoff (`failed → ready`) (§6) |
| `MAX_CONCURRENT_WORKERS` / `withWorkerSlot` | host concurrency budget + global budget (§8, §9) |
| oneshot Walk tick (`tickOneshot`) | Run DAG executed **within** a tasked stage (§4.2) |
| `goals` interview gate (five items) | `VerifyContract` (same five fields, §16.2) |
| GLM 5.2 via Blackbox (oneshot v1 lock) | unchanged for oneshot mode; multi-agent router defaults to OMP DeepSeek v4 Flash (§14) |

---

## 3. Lock handling

The oneshot v2 lock (`docs/specs/oneshot-v2-minimal-v1-runtime-spec.md`) and
the v1 lock (issue #1) constrain this spec in three places:

1. **Single scheduler per Issue.** The oneshot lock §4 forbids a second
   scheduler competing for the same Issue. The multi-agent scheduler is not a
   competing per-Issue Walk driver: it executes **inside a tasked stage** the
   Walk has already entered, and it never auto-advances past a Gate. The Walk
   remains the only stage sequencer. (§4.2.)
2. **Model lock.** The oneshot agent stays `zai/glm-5.2` via Blackbox in
   oneshot mode. Multi-agent task routing is a **separate** path behind the
   switch and does not change the oneshot agent. (§14.)
3. **`complete` and `VERIFY.md` exec.** The oneshot goal's `complete` stays
   unreachable until the Sandbox runtime exists. The multi-agent Task state
   `succeeded` requires the verifier to pass; the verifier's **exec tier** is
   gated on the same sandbox runtime and is contract-only until then (§16.4).

Any implementation that must touch a locked decision files a Decision ticket
first (per v1 lock policy). This spec does not reopen those decisions.

---

## 4. Components

The system is five components plus the operator surface. Each has one owner
and one boundary; none executes another's work.

### 4.1 Component inventory

| Component | Responsibility | Owns | Consumes |
|---|---|---|---|
| **Store** (`orchestration-store.ts`) | persisted Task graph, runs, leases, attempts, claims, artifacts, events; CAS transitions | all orchestration tables, transition enforcement | — |
| **Scheduler** (`scheduler.ts`) | pure dispatch decisions; deferral ledger | the decision function, fairness | Store |
| **Adapters** (`omp-runner.ts`, `workspace.ts`) | the only thing that executes Tasks; workspace creation/teardown with containment guards | execution, workspaces | Scheduler decisions, Store |
| **Verifier** (`verification.ts`) | independent pass/fail on Task output; `VerifyContract` | verdicts, evidence | Store, Adapters (exec tier) |
| **Model router** (`model-router.ts`) | capability routing, paid-fallback ceilings | routes | Store, Scheduler |
| **Operator surface** (dashboard + server actions) | intake, gates, budget raises, cancel, evidence review | UI | Store, Event log |

### 4.2 Sequencing rule

The Walk stays the only per-Issue driver. A stage is either `direct` (current
behavior: one worker job, unchanged) or `tasked` (a Run holds a Task DAG). The
Walk transitions a tasked stage to `active`; the orchestrator then iterates
the DAG under the scheduler; when every Task is terminal and the DAG verdict
is complete, the Walk records the stage artifact and advances to the next
stage — never past a Gate. **No component may start a Task outside a tasked
stage, and no component may advance a Walk past a Gate.**

### 4.3 Data flow

```
Issue → Walk → tasked stage → OrchestrationRun (DAG of Tasks)
   Store: tasks/leases/attempts/claims/events (single source of truth)
   Scheduler: ready tasks → DispatchDecision[] (pure, no side effects)
   Adapters: lease → execute in workspace → report
   Verifier: verdict (contract tier; exec tier behind sandbox)
   Event log: every step as appendEvent kinds
   Human: Gates at grill/plan/phase/evidence/cost/merge
```

---

## 5. Data model and schemas

All new orchestration primitives use **string IDs** (uuid) and **ISO-8601
UTC timestamps**. Existing Foundry rows keep their formats; new orchestration
tables use ISO text timestamps throughout.

Storage rules (hard):

- One database: the existing SQLite store at `data/foundry.sqlite`
  (`node:sqlite` `DatabaseSync`, WAL), via `store.ts` `SCHEMA`/`migrate()`.
  **No better-sqlite3. No second database.**
- One event trail: the existing append-only Event log (`appendEvent`). No
  `orchestration_events` table (§20).
- No Foundry data in any Sandbox (§11.3).

### 5.1 Tables (all new, created through the existing migrate path)

```sql
CREATE TABLE IF NOT EXISTS orchestration_runs (
  run_id      TEXT PRIMARY KEY,
  issue_id    TEXT NOT NULL,
  stage       TEXT NOT NULL,              -- StageId
  name        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN
                ('active','succeeded','failed','cancelled')),
  created_at  TEXT NOT NULL,              -- ISO-8601 UTC
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orchestration_tasks (
  task_id     TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL,
  name        TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN
                ('blocked','ready','leased','running','verifying',
                 'succeeded','failed','cancelled')),
  deps        TEXT NOT NULL DEFAULT '[]', -- JSON array of task_ids
  dep_kinds   TEXT NOT NULL DEFAULT '[]', -- JSON array of 'required'|'optional'
  host        TEXT,                        -- HostId or NULL
  isolation_kind  TEXT,                    -- IsolationKind or NULL
  isolation_ref  TEXT,
  cpu         INTEGER NOT NULL,
  memory_mib  INTEGER NOT NULL,
  disk_mib    INTEGER NOT NULL,
  concurrency INTEGER NOT NULL DEFAULT 1,
  capability  TEXT NOT NULL,               -- 'text' | 'vision'
  cost_ceiling_usd REAL,                   -- NULL = no paid fallback
  route_primary TEXT NOT NULL,
  route_paid_fallback TEXT,
  route_paid_ceiling_usd REAL,
  claims      TEXT NOT NULL DEFAULT '[]',  -- JSON array of write paths
  attempts    INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  retryable   INTEGER NOT NULL DEFAULT 0,  -- durable retry decision
  next_retry_at TEXT,                      -- earliest retry time (ISO-8601 UTC)
  error       TEXT,
  lease_id    TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  started_at  TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_ready ON orchestration_tasks (state, run_id);
CREATE INDEX IF NOT EXISTS idx_tasks_run   ON orchestration_tasks (run_id);

CREATE TABLE IF NOT EXISTS orchestration_attempts (
  attempt_id  TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  attempt_no  INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN
                ('running','succeeded','failed','cancelled')),
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempts_task ON orchestration_attempts (task_id);

CREATE TABLE IF NOT EXISTS orchestration_leases (
  lease_id    TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  host        TEXT NOT NULL,
  owner       TEXT NOT NULL,              -- executor identity
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  released_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leases_task ON orchestration_leases (task_id);

CREATE TABLE IF NOT EXISTS orchestration_artifacts (
  artifact_id TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  path        TEXT,
  body        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON orchestration_artifacts (task_id);

CREATE TABLE IF NOT EXISTS hosts (
  host_id     TEXT PRIMARY KEY,           -- HostId: mac | vps | box
  cpu_total   INTEGER NOT NULL,
  memory_mib_total INTEGER NOT NULL,
  disk_mib_total  INTEGER NOT NULL,
  concurrency_max INTEGER NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',-- JSON array of ModelCapability
  isolation    TEXT NOT NULL DEFAULT '[]', -- JSON array of IsolationKind
  healthy     INTEGER NOT NULL DEFAULT 1,
  last_heartbeat TEXT NOT NULL,
  notes       TEXT
);
```

`hosts` rows are seeded at migration (mac, vps, box with the capacities in
§9.2); the operator may edit via the dashboard, never by an agent.

### 5.2 Shared TypeScript contracts

These types are the **authoritative cross-component interface**. They are
defined in `lib/foundry/orchestration-types.ts` (already landed on this
branch) and are reproduced here verbatim as the contract; any change to them
requires this spec to change too.

```ts
export const HOSTS = ["mac", "vps", "box"] as const;
export type HostId = (typeof HOSTS)[number];

export const TASK_STATES = ["blocked","ready","leased","running",
  "verifying","succeeded","failed","cancelled"] as const;
export type TaskState = (typeof TASK_STATES)[number];
export const TERMINAL_TASK_STATES = ["succeeded","failed","cancelled"] as const;
export type TerminalTaskState = (typeof TERMINAL_TASK_STATES)[number];

export const RUN_STATUSES = ["active","succeeded","failed","cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const ISOLATION_KINDS = ["git-worktree","container","vm"] as const;
export type IsolationKind = (typeof ISOLATION_KINDS)[number];

export const MODEL_CAPABILITIES = ["text","vision"] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export type AttemptStatus = "running" | "succeeded" | "failed" | "cancelled";

export type ResourceBudget = { cpu: number; memoryMiB: number;
  diskMiB: number; concurrency: number };

export type Isolation = { kind: IsolationKind; ref: string };

export type ModelRequirement = { capability: ModelCapability;
  costCeilingUsd: number | null };

export type ModelRoute = { primary: string;
  paidFallback: string | null; paidCostCeilingUsd: number | null };

export type FileClaim = { taskId: string; writePaths: string[] };

export type OrchestrationTask = {
  id: string; runId: string; name: string; state: TaskState;
  deps: string[]; host: HostId | null; isolation: Isolation | null;
  resources: ResourceBudget; model: ModelRequirement; route: ModelRoute;
  claims: string[]; attempts: number; maxAttempts: number;
  // Durable retry decision: whether the last failure was retryable and the
  // ISO timestamp after which the task may be retried. Written atomically with
  // `failTask`, cleared by `retryTask` and every terminal/cancel path. The
  // coordinator reconstructs a due retry from these fields on the task snapshot,
  // so the decision survives driver invocations and store reconnects.
  retryable: boolean; nextRetryAt: string | null;
  error: string | null; leaseId: string | null;
  createdAt: string; updatedAt: string;
  startedAt: string | null; completedAt: string | null;
};

export type TaskAttempt = { id: string; taskId: string; index: number;
  status: AttemptStatus; startedAt: string; endedAt: string | null;
  error: string | null };

export type TaskLease = { id: string; taskId: string; host: HostId;
  owner: string; createdAt: string; expiresAt: string; releasedAt: string | null };

export type TaskArtifact = { id: string; taskId: string; kind: string;
  path: string | null; body: string | null; createdAt: string };

export type OrchestrationRun = { id: string; name: string;
  status: RunStatus; createdAt: string; updatedAt: string };

export type OrchestrationEvent = { seq: number; ts: string; runId: string;
  taskId: string | null; kind: string; payload: Record<string, unknown> };

export type GraphValidation = { ok: boolean; errors: string[] };

export const DEFAULT_TEXT_MODEL = "omp/deepseek-v4-flash";
export const DEFAULT_COST_CEILING_USD = 0.1;
export const DEFAULT_MAX_ATTEMPTS = 3;

export const LEGAL_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  blocked: ["ready","cancelled"],
  ready: ["leased","cancelled"],
  leased: ["running","ready","cancelled"],
  running: ["verifying","failed","cancelled"],
  verifying: ["succeeded","failed","cancelled"],
  succeeded: [],
  failed: ["ready","cancelled"],
  cancelled: [],
};
export function canTransition(from: TaskState, to: TaskState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}
```

### 5.3 Task lifecycle records

One Task has many `TaskAttempt`s (one per retry), at most one live `TaskLease`,
zero or more `TaskArtifact`s. The `attempts` counter on the Task equals the
count of attempts started. `maxAttempts` defaults to `DEFAULT_MAX_ATTEMPTS`
and is capped by `FOUNDRY_MAX_ATTEMPTS` (existing constant).

### 5.4 Lease records

A `TaskLease` is a time-bounded exclusive grant. `expiresAt` is ISO-8601;
renewal extends it. `releasedAt` is set on orderly release (success, failure,
cancel). A lease whose `expiresAt` has passed and `releasedAt` is NULL is an
**expired lease** → recovery (§10).

### 5.5 Store function surface

The store MUST expose (implementation in `orchestration-store.ts`; exact
signatures may vary, behavior must not):

- `createRun(issueId, stage, name): OrchestrationRun`
- `getRun(runId)`, `updateRunStatus(runId, status)`
- `createTask(task: OrchestrationTask): void`
- `getTask(taskId)`, `listTasksByRun(runId): OrchestrationTask[]` — returns
  each Task's `deps` plus its dependency kinds (the `dep_kinds` column,
  defaulting to `"required"`), so the scheduler can evaluate the DAG without a
  separate table
- `transitionTask(taskId, from: TaskState, to: TaskState, opts): void`
  — rejects when `state !== from` (CAS) or `!canTransition(from, to)`; bumps
  `updatedAt`; records a `task.state_change` event. **Stale writes are
  rejected** (mirrors the goals `goal_id` compare-and-set).
- `listTasksInState(state): OrchestrationTask[]`
- `createAttempt(taskId): TaskAttempt`; `completeAttempt(attemptId, status, error)`
- `grantLease(taskId, host, owner, leaseMs): TaskLease`
- `renewLease(leaseId, leaseMs): void` (CAS on `expiresAt`)
- `releaseLease(leaseId): void`
- `listExpiredLeases(now): TaskLease[]`
- `acquireClaim(taskId, writePaths): void`; `releaseClaim(taskId): void`;
  `listActiveClaims(): FileClaim[]`
- `saveTaskArtifact(artifact): void`
- `appendOrchestrationEvent(runId, taskId, kind, payload): void` — writes to
  the Event log via `appendEvent` (§20)
- `validateGraph(tasks): GraphValidation`
- `listReadyTasks(now): OrchestrationTask[]`
- `reconcileLeases(now): number`; `reconcileStaleTasks(now): number` (watchdog)

The store also exposes the lifecycle transitions as fenced methods with
durable retry semantics (implemented as `startTask` / `verifyTask` /
`succeedTask` / `failTask` / `retryTask` / `cancelTask` / `expireLeases` in
`orchestration-store.ts`; names may vary, behavior must not):

- `startTask(taskId, owner)` — `→ running`, requires the live lease (fencing),
  increments `attempts`, creates the `TaskAttempt` row, and records
  `task.started` + `attempt.started` events.
- `verifyTask(taskId)` — `→ verifying`; the verifier takes over from the
  executor.
- `succeedTask(taskId, owner)` — `→ succeeded`; requires the live lease,
  clears the retry decision, finishes the attempt, releases the lease,
  releases claims, and unblocks dependents. Only the verifier reaches this.
- `failTask(taskId, error, owner, { retryable, nextRetryAt })` — `→ failed`;
  requires the live lease and a non-empty error, finishes the attempt,
  releases the lease and claims. The retry decision is written **atomically
  with the failure**: `retryable` records whether another attempt is allowed
  and `nextRetryAt` the earliest time that attempt may start. A `retryable`
  failure **without** a `nextRetryAt` is treated as permanent.
- `retryTask(taskId)` — `failed → ready` when `attempts < maxAttempts`;
  clears the durable retry decision (the retry is consumed) and records a
  `task.retried` event. Never fires when `attempts >= maxAttempts`.
- `cancelTask(taskId, owner, reason)` — `→ cancelled` (terminal); requires the
  live lease (control-plane fencing), finishes the attempt, releases the
  lease and claims, and clears the retry decision.
- `expireLeases(now)` — the watchdog recovery path (§10.3): re-readies
  `leased` Tasks with no started attempt, and fails + possibly re-readies
  `running`/`verifying` Tasks, idempotently.

---

## 6. Task state machine

States: `blocked, ready, leased, running, verifying, succeeded, failed,
cancelled`. Transitions are exactly `LEGAL_TRANSITIONS` (§5.2). No other
transition is legal; a store transition attempt outside the table fails with
a clear error.

| Transition | Who/What | Notes |
|---|---|---|
| `blocked → ready` | orchestrator | all `required` deps `succeeded`; gates passed |
| `blocked → cancelled` | orchestrator | required dep failed/cancelled, or DAG aborted |
| `ready → leased` | scheduler + adapter | lease granted (CAS on `state = ready`) |
| `leased → running` | adapter | executor confirms start; heartbeat begins |
| `leased → ready` | watchdog | lease revoked before start (executor died) |
| `running → verifying` | adapter | executor reports completion; verifier takes over |
| `running → failed` | adapter | runtime failure (transient/permanent) |
| `running → cancelled` | operator/orchestrator | cancel mid-run; attempt cancelled |
| `verifying → succeeded` | verifier | all contract gates pass |
| `verifying → failed` | verifier | a gate fails |
| `failed → ready` | orchestrator | retry within `maxAttempts`, after backoff |
| `failed → cancelled` | operator | operator aborts retries |
| `succeeded / cancelled → (none)` | — | terminal |

Invariants (testable):

- **I6.1** A Task is `ready` only when every `required` dep is `succeeded` and
  no human gate for the Task is pending.
- **I6.2** A Task in `verifying` is never verified by the executor that ran
  it (§16.1 maker/verifier separation).
- **I6.3** `succeeded` is reachable only from `verifying`, and only by the
  verifier — never by the executing adapter.
- **I6.4** A Task never has more than one live lease at a time
  (`grantLease` rejects when an unexpired, unreleased lease exists).
- **I6.5** `attempts` never exceeds `maxAttempts`; when a failed attempt would
  exceed it, the Task stays `failed` (terminal) with `error` set.
- **I6.6** Every transition emits exactly one `task.state_change` event with
  `{ from, to, actor }`.
- **I6.7** Terminal states are never left except via operator recreation of a
  new Task (a new `task_id`); no terminal row is mutated.

---

## 7. Runs and the dependency graph

### 7.1 Run

A Run is one tasked stage for one Issue. It holds the Task DAG for that stage.
`OrchestrationRun.status`: `active` while the DAG is incomplete; `succeeded`
when every Task is `succeeded`; `failed` when the DAG is permanently failed
(required dep terminal-failed or budget-stop); `cancelled` when the operator
or Walk aborts the stage.

### 7.2 DAG rules

- A Task lists `deps: string[]` (task IDs within the same run) and parallel
  `depKinds` of `"required" | "optional"` (default `required`).
- `validateGraph` rejects (returns `ok: false` with errors) when: any dep ID
  is missing from the run; any self-dependency; any cycle; an empty run; a
  duplicate dep. **A rejected graph is not persisted.**
- A required dep that terminates `failed` or `cancelled` cascades: all
  dependent Tasks move to `cancelled` with `error = "dependency_failed:
  <taskId>"`. Optional deps that fail do not block dependents.
- Leaf depth: the orchestrator SHOULD keep Tasks atomic and context-window-
  sized (~200k tokens per Foundry design principle 7). A Task whose expected
  scope exceeds one context window MUST be decomposed into a child DAG before
  creation (the decomposition itself is a planning Task).
- The DAG is a DAG: no node may write to a path claimed by another
  concurrently-active node on the same repo (§12).

### 7.3 DAG verdict (derived, not stored)

- `complete` iff every Task is `succeeded`.
- `failed` iff a required-dep cascade or a terminal `failed` Task remains and
  no ready Task exists to change it.
- `blocked` iff a human gate is pending.
These are computed by the orchestrator from the Task rows; they are never a
separate stored verdict (structured over unstructured).

---

## 8. Scheduler

The scheduler is a **pure function**: `(store snapshot, now) → DispatchDecision[]`
plus a deferral record. It MUST NOT execute, spawn, clone, or write outside the
store. Its only side effect is writing its decisions and deferrals to the store
(and hence the Event log). Executors are the only thing that runs Tasks.

### 8.1 Dispatch decision

```ts
export type DispatchDecision = {
  runId: string;
  taskId: string;
  host: HostId;
  isolation: Isolation;
  model: ModelRoute;
  attempt: number;            // attempt index the adapter must start
  leaseId: string;
  leaseExpiresAt: string;     // ISO-8601
  claims: FileClaim[];        // claims granted with this dispatch
};
```

The decision is **conditional**: it is honored only if the store still shows
the Task `ready` and the lease grants (`grantLease` CAS). A decision that
fails to grant (already leased, cancelled, state moved) is dropped and logged
as `scheduler.defer` `{ reason: "stale_decision" }`. This makes the scheduler
safe to re-run at any time (idempotent tick).

### 8.2 Rule order (evaluated per ready Task, in order)

A Task is dispatched only when every rule passes; the first failing rule
produces a deferral with its code. Rules run in this fixed order so deferrals
are deterministic and testable.

1. **DAG-ready** — `state === "ready"` (already true by selection).
2. **Gate** — no pending human gate for the Task's stage/run
   (`grill`, `plan`, `phase`, `evidence`, `cost`, `merge`; §19). Pending →
   `defer:gate`.
3. **Resource capacity** — the chosen host has CPU/mem/disk/concurrency headroom
   for `task.resources`, AND the global budget is not exceeded (§9.4). →
   `defer:resources`.
4. **Model routing** — `routeModel(task.model)` yields a route whose primary
   model capability is satisfiable on the chosen host; vision work only on a
   vision-capable host; no silent text fallback for vision. →
   `defer:model`.
5. **Cost** — projected cost (budget-consumed-to-date + this Task) stays under
   the run budget and the Task's ceiling; paid fallback only when
   `costCeilingUsd` set and approved. → `defer:cost` or `defer:cost_ceiling`.
6. **File claims** — no overlap between this Task's `writePaths` and any
   active claim on the same target repo ref (§12). → `defer:claim_conflict`.
7. **Small-PR policy** — a Task that would exceed the PR-size policy is not
   dispatched as-is; it is reported for decomposition. → `defer:pr_size`.
8. **Placement policy** — text/engineering → `vps` default; visual/UI → `mac`;
   burst → `box` only when enabled and budgeted (§9.5). →
   `defer:placement`.
9. **Concurrency caps** — per-host and global `MAX_CONCURRENT` not exceeded.
   → `defer:concurrency`.

### 8.3 Fairness

Among ready Tasks that pass every rule, dispatch order:

1. Operator priority (`priority` field, default 0; higher first).
2. Earliest `createdAt`.
3. Least dependency depth (roots first) to keep pipelines feeding.

Fairness across Issues: no single Issue may hold more than
`FOUNDRY_MAX_ISSUE_SHARE` (default 50%) of concurrent running Tasks when other
Issues have ready Tasks, unless the operator sets priority. This prevents one
Issue from starving the factory.

### 8.4 Tick loop

The orchestrator ticks on: Walk stage enter, Task terminal, lease expiry,
gate answer, budget raise, and a fixed interval (`FOUNDRY_SCHEDULER_TICK_MS`,
default 5s) while a run is `active`. Each tick recomputes from the store —
there is no in-memory queue state. Retry backoff uses the existing
`nextRetryAt`/`backoffMs` from `retry.ts`; a Task whose `failed` transition is
retryable is marked `ready` only after `nextRetryAt` passes (checked by
`listReadyTasks(now)`).

### 8.5 Scheduler invariants (testable)

- **I8.1** Output is a pure function of the store snapshot and `now` (same
  inputs, same decisions; no hidden state).
- **I8.2** Every deferral is recorded with a code and the Task id
  (`scheduler.defer` event); a Task never silently stalls.
- **I8.3** No two dispatch decisions ever grant leases for the same Task
  (CAS on `grantLease`).
- **I8.4** The scheduler never writes outside the orchestration tables and
  Event log; it never calls adapters.
- **I8.5** Aggregate dispatched resources never exceed host capacity or the
  global budget at any instant (§9.4).
- **I8.6** Re-running the tick with the same snapshot yields the same
  decisions (idempotent; stale decisions dropped).

---

## 9. Hosts and placement

### 9.1 Host registry

Hosts are registered in the `hosts` table (seeded, operator-editable). A Host
is a placement target with capacity, capabilities, and isolation support. An
agent never registers or edits a Host.

### 9.2 Seeded capacities (v1)

| Host | CPU | memory MiB | disk MiB | concurrency | capabilities | isolation |
|---|---|---|---|---|---|---|
| `mac` | 8 | 16384 | 512000 | 2 | `text`,`vision` | `git-worktree` |
| `vps` | 4 | 16384 | 200000 | 3 | `text` | `git-worktree`,`container` |
| `box` | 2 | 8192 | 100000 | 1 | `text` | `vm` |

Capacities are **reserved-capacity**: `vps` is a constrained 16 GB host and
must not be overcommitted (§9.3). `mac` is reserved for visual/UI work and is
not a general compute target (§9.5).

### 9.3 Protected state (hard rule)

The current VPS 16 GB capacity, the current remote dirty checkout, and the
running Eve containers on the VPS are **protected state**:

- The scheduler reserves `FOUNDRY_VPS_RESERVE_MIB` (default 2048 MiB) plus the
  memory of the dashboard process as untouchable headroom. Tasks budget against
  the remaining capacity. A dispatch that would violate the reserve is
  `defer:resources`, never a breach.
- The remote dirty checkout paths and the running Eve containers are never
  claimed, never written, never cleaned by any orchestration Task. Orchestrated
  work runs in its own workspaces (§11). There is no destructive cleanup
  anywhere (§19, §28).
- `box` capacity is not assumed available; it is off unless the operator
  enables it with an explicit budget (§9.6).

### 9.4 Budgets and overcommit

The scheduler tracks a **global resource budget** per host and overall:

- `resources` of every live Task (leased + running + verifying) summed against
  the host's capacity minus reserve.
- `concurrency` = count of live Tasks per host, capped by
  `hosts.concurrency_max` and the global `FOUNDRY_MAX_CONCURRENT_WORKERS`
  (existing constant; default 20).
- Disk claims are accounted at dispatch (workspace reservation) and released at
  teardown.
- Overcommit is impossible by construction: dispatch grants a lease only when
  the reservation succeeds atomically with the lease.

### 9.5 Placement policy

| Work kind | Default host | Why |
|---|---|---|
| text/engineering (default) | `vps` | the engine room; Tailscale to it |
| visual/UI (screenshots, design review, image/video analysis, browser QA) | `mac` | the Mac is reserved for visual/UI work |
| burst/heavy one-off, full-isolation | `box` | only when enabled + budgeted (§9.6) |
| anything needing `vision` capability | a vision-capable host only | routing rule §14 |

The Mac is never a general text-compute target. The VPS is never a visual
target unless it gains a vision-capable model (then placement may allow it,
still defaulting text to `vps`).

### 9.6 Economics

- `mac` and `vps` cost is the operator's existing hardware; the scheduler does
  not bill them.
- **Cloudflare Containers** and **Box VMs** are optional burst compute only.
  They are never assumed to be free VPS replacements. Enabling `box` (or any
  burst pool) requires: (1) an operator Decision ticket with a per-run
  `burstCostCeilingUsd`, and (2) the `cost` gate answered. Without both, the
  scheduler emits `defer:placement` for burst work.
- A burst Task's projected cost is charged against the run budget like any
  paid model (§15); exceeding the burst ceiling stops the Task and parks for
  the human.

---

## 10. Leases, heartbeat, recovery

### 10.1 Lease lifecycle

1. Dispatch grants a lease: `grantLease(taskId, host, owner, leaseMs)` with
   `expiresAt = now + leaseMs`. Default `FOUNDRY_LEASE_MS` = 30 min; a Task may
   specify a longer lease (long builds) via `task.leaseMs`, capped at 4 h.
2. The adapter reports start → `leased → running`; heartbeat begins.
3. Renewal: the adapter renews the lease every `min(HEARTBEAT_MS,
   leaseMs/3)` (existing `HEARTBEAT_MS` default 10 min). Renewal is a CAS on
   `expiresAt`.
4. Orderly end: success/failure/cancel releases the lease (`releasedAt` set)
   and the Task leaves `running`.

### 10.2 Fencing

`TaskLease.owner` is the executor identity; `lease_id` is the fencing token.
Any write the adapter performs on behalf of a Task must carry the lease id and
is rejected by the store if the lease is expired or released (CAS). A stale
executor (recovered-after-expiry) cannot write: its lease is gone, its writes
fail, its attempt is recorded `failed`. This prevents split-brain double
execution side effects.

### 10.3 Watchdog recovery

The watchdog (`reconcileLeases(now)` + `reconcileStaleTasks(now)`, run by the
existing watchdog loop) handles:

- **Expired lease, Task `leased`** → `leased → ready`, attempt not started;
  `task.lease_revoked` event.
- **Expired lease, Task `running`** → record the attempt `failed`
  (`error: "lease_expired"`), `running → failed`; if `attempts < maxAttempts`,
  `failed → ready` (backoff applies); else stays `failed` (terminal). Partial
  artifacts of that attempt are quarantined (marked, never published as
  succeeded).
- **Expired lease, Task `verifying`** → verifier is the owner; if the verifier
  died, the attempt returns to the failed/retry path with
  `error: "verifier_lease_expired"`.
- **Stale heartbeat** (`heartbeatAt` older than `STALE_JOB_MS`, existing
  constant) → same recovery as expired lease.

Recovery is idempotent: reconciling twice yields the same end state. Every
recovery step emits one `task.lease_revoked`/`task.attempt_failed` event.

**Durable retry decision.** The retry decision is a Task fact, not a process
fact: `failTask` writes `retryable` + `nextRetryAt` atomically with the
failure, and the coordinator reconstructs a due retry from the Task snapshot
on every invocation. This is what lets a retry survive a driver crash, a
store reopen, or a scheduler restart — the next tick sees the failed Task with
its retry time and re-readies it after backoff (`waiting` until `nextRetryAt`).
A retryable failure without a `nextRetryAt` is permanent (§5.5).

### 10.4 Recovery invariants (testable)

- **I10.1** A Task is never `running` with no live lease; watchdog converges
  any such row.
- **I10.2** An expired lease never permits a store write (fencing).
- **I10.3** Recovery never resurrects a `succeeded` or `cancelled` Task.
- **I10.4** After recovery, `attempts` is incremented exactly once per started
  attempt; no attempt is counted twice.
- **I10.5** A retryable Task never dispatches before `nextRetryAt`, and its
  retry decision survives store reopen and fresh driver invocations.

---

## 11. Isolation and Sandboxes

### 11.1 Isolation kinds

| Kind | What | Used for | Same as current |
|---|---|---|---|
| `git-worktree` | per-Task git worktree under a sanctioned root | PR-scoped edits, file-claim-scoped work | `data/worktrees/<id>` + `isSandboxedWorkDir` |
| `container` | Docker per-Task sandbox (env, filesystem, network policy) | code execution, test runs, untrusted steps | the Eve containers (protected, §9.3) |
| `vm` | disposable Box VM | full-isolation heavy or burst work | new; box only |

### 11.2 Containment guards (hard)

- Every workspace root is under a sanctioned root (per Host). Teardown uses
  the existing lexical no-symlink-follow containment check (`isSandboxedWorkDir`
  pattern): it refuses to remove anything outside the sanctioned tree, the root
  itself, or a filesystem root.
- Teardown runs on success and failure, and the guard swallows removal errors
  while logging exactly one warning Event (existing `removeWorkDir` behavior).
- A containment violation is a Task failure with a `containment_violation`
  error, never a silent rm.
- **No destructive cleanup.** No agent, adapter, or Task deletes or resets
  anything outside its own sanctioned workspace; hygiene of protected state is
  never orchestrated (§9.3).

### 11.3 No Foundry data in Sandbox (CONTEXT.md rule, extended)

A Sandbox receives only product artifacts. The Task row, leases, attempts,
claims, budgets, the Event log, `GOAL.md`, `PROGRESS.md`, and all
`orchestration_*` rows never enter any Sandbox. Workspaces get the target repo
plus the declared product inputs; everything Foundry stays in
`data/foundry.sqlite` and `data/logs/`.

### 11.4 Workspace lifecycle

1. Dispatch reserves disk (§9.4) and creates the workspace under the host's
   sanctioned root.
2. The adapter materializes the target repo at the Task's base ref and checks
   out `foundry/<issueId>-<taskId>` (branch naming §18.3).
3. The adapter enforces the Task's write scope: writes outside
   `task.claims`/`writePaths` (or outside the workspace) are rejected as a
   containment violation.
4. On success, the adapter produces the diff + artifacts and hands to the
   verifier; the workspace is torn down (guarded).
5. On failure/cancel, partial output is quarantined and the workspace torn
   down.

### 11.5 Isolation invariants (testable)

- **I11.1** Every workspace path resolves strictly inside its sanctioned root
  (guard returns true).
- **I11.2** Teardown never touches protected state (VPS checkout, Eve
  containers) — those paths are outside every sanctioned root.
- **I11.3** No orchestration table, no Event log entry, and no budget number
  is ever written into a workspace.
- **I11.4** A workspace is created for exactly one Task and never reused by
  another Task.

---

## 12. File claims

### 12.1 Claim semantics

A Task declares `claims: string[]` — the write paths (repo-relative globs or
prefixes) it will touch. Claims are acquired with the lease and released at
Task end. Claims are scoped to a target repo ref (the base ref the Task
checkout uses).

### 12.2 Overlap rejection

- Claims are normalized before comparison: resolve `.`/`..`, collapse
  duplicates, reject paths that escape the repo root, and expand each path to
  a prefix for prefix-intersection checks.
- The scheduler rejects dispatch when a Task's normalized write paths
  intersect any **active** claim (leased/running/verifying) on the same repo
  ref. A reject is `defer:claim_conflict` (rule 6, §8.2) and names the
  conflicting Task id.
- Within the adapter, the executor's writes are checked against the granted
  claims; a write outside them is a containment violation (§11.2).
- Claims release on success, failure, and cancel. Release is part of teardown
  and is idempotent.

### 12.3 Claim invariants (testable)

- **I12.1** At no time do two active claims on the same repo ref overlap after
  normalization.
- **I12.2** A released claim never blocks a later dispatch.
- **I12.3** A Task never writes outside its granted claims (enforced in the
  adapter).
- **I12.4** Claims are normalized identically by scheduler and adapter (shared
  `normalizeClaims` helper; single implementation).

---

## 13. Execution adapters

### 13.1 Boundary

Adapters are the **only** code that executes anything. The scheduler produces
decisions; the adapter consumes a decision, runs the Task, and reports.
Adapters never decide; the scheduler never runs.

### 13.2 `omp-runner` (OMP execution)

- Executes a Task's OMP session via **argv** only — no shell interpolation, no
  string-built commands. Args are passed as an array; each arg is
  `argv`-escaped and length-checked against `FOUNDRY_MAX_ARGV_BYTES`.
- Spawns the OMP worker with: the Task objective (from the run/stage brief),
  the steering fragment (budget, status, write scope), the workspace path, and
  the model route. No secrets in argv (§25.3).
- Streams turn boundaries to the Event log (`task.turn_delta` for token
  accounting, §15.2).
- Honors the cancel signal: on `cancelled`, it terminates the child and reports
  `cancelled`, never `succeeded`.

### 13.3 `workspace`

- Creates/tears down the isolated workspace (§11) with containment guards.
- Provides `materialize(ref)`, `write-scope guard`, `diff()`, `run(cmd, args)`
  (argv array), and `teardown()`.
- `run` executes inside the workspace with a timeout (`FOUNDRY_EXEC_TIMEOUT_MS`),
  resource limits (RLIMIT on CPU/memory/disk where the Host supports them),
  and no network egress unless the Task declares `network: true` (default
  deny; §25.3).

### 13.4 Adapter interface (contract)

```ts
export type AdapterReport =
  | { kind: "completed"; artifacts: TaskArtifact[]; diff: string }
  | { kind: "failed"; error: string; retryable: boolean }
  | { kind: "cancelled" };

export interface Executor {
  run(decision: DispatchDecision, task: OrchestrationTask,
      workspace: Workspace): Promise<AdapterReport>;
}
```

The adapter reports `completed` → store moves Task `running → verifying`.
`failed` with `retryable: true` → the retry path (§8.4). `failed` with
`retryable: false` or `cancelled` → terminal.

### 13.5 Adapter invariants (testable)

- **I13.1** The adapter never transitions a Task to `succeeded` (verifier
  only).
- **I13.2** Every execution carries a live lease id; a revoked lease aborts
  execution (fencing, §10.2).
- **I13.3** All subprocess execution is argv-array based; no shell string is
  ever built from task input.
- **I13.4** On cancel, the adapter always reports `cancelled`, never
  `succeeded` or a partial `completed`.

---

## 14. Model routing

### 14.1 Rules (contract)

1. **Text/engineering is the default.** Any Task without a
   `capability: "vision"` requirement routes to **OMP DeepSeek v4 Flash**
   (`DEFAULT_TEXT_MODEL = "omp/deepseek-v4-flash"`). No stronger model is
   chosen for text by default.
2. **Vision work routes only to vision-capable models.** A Task whose
   `capability` is `vision` (screenshot inspection, image/video analysis,
   design review) must route to a vision-capable model; it MUST NOT silently
   fall back to a text-only model. If no vision-capable route exists on a
   reachable host, the Task is `defer:model`, never misrouted.
3. **Paid fallback requires an explicit cost ceiling.** A route with
   `paidFallback` is used only when `ModelRequirement.costCeilingUsd` is set
   AND the `cost` gate is approved (§19). Otherwise `paidFallback` is null.
4. **The oneshot agent is untouched.** Oneshot mode keeps `zai/glm-5.2` via
   Blackbox (§3); multi-agent routing is a separate path behind the switch.

### 14.2 Router contract

```ts
export function routeModel(req: ModelRequirement,
  context: { visionHosts: HostId[] }): ModelRoute;
```

- `req.capability === "text"` → `{ primary: DEFAULT_TEXT_MODEL,
  paidFallback: null, paidCostCeilingUsd: null }` unless a cost ceiling is set
  and approved, in which case `paidFallback` is the configured stronger model
  with `paidCostCeilingUsd = req.costCeilingUsd`.
- `req.capability === "vision"` → `primary` is the configured vision-capable
  model; `paidFallback` follows the same ceiling rule.
- Never returns a text model as `primary` for a vision requirement.

### 14.3 Model invariants (testable)

- **I14.1** A text Task's `route.primary` defaults to `DEFAULT_TEXT_MODEL`.
- **I14.2** A vision Task's `route.primary` is vision-capable; a text-only
  model is never selected for it.
- **I14.3** `paidFallback` is non-null only when `costCeilingUsd` is set and
  the `cost` gate is approved.
- **I14.4** `routeModel` is pure (same inputs, same route).

---

## 15. Cost controls

### 15.1 Budget levels

Budgets exist at four levels, each a ceiling on the one below:

1. **Task** — `costCeilingUsd` (paid fallback only) and a token budget.
2. **Run/DAG** — sum of its Tasks' budgets (operator-set at stage intake).
3. **Issue** — per-Walk ceiling (reuses the oneshot `token_budget` model).
4. **Run mode** — oneshot's global token budget (§11 of the oneshot spec).

### 15.2 Accounting

- Token and cost accounting derives from the existing Event log token counts
  (CONTEXT.md: the Event log records token counts). Deltas land as
  `task.budget_delta` events. **No second accounting path.**
- Accounting is approximate (no cached/non-cached split today, same caveat as
  the oneshot spec §11). This is documented, not a release blocker.
- Wall-clock is paired with tokens, per Task and per Run, elapsed while
  `running`/`verifying`.

### 15.3 Soft stop and hard stop

- **Soft stop** at 90% of the nearest budget: inject wrap-up steering, stop
  starting new work, park at the current gate.
- **Hard stop** at 100% (or ceiling crossed): the Run parks in `active` with
  no further dispatch (`defer:cost`); the Task/run is not failed and not
  cancelled. A human raises the budget and resumes.
- **Budget exhaustion is never success and never a verdict.** A Run that hits
  its budget is not `succeeded`; `succeeded` requires the verifier.
- A budget reminder is injected at a configurable interval while a Task is
  `running` (default 10% of its token budget).

### 15.4 Cost-ceiling approval

- Using a `paidFallback` model or a burst host requires an answered `cost`
  Decision ticket naming the amount and scope. Unanswered → `defer:cost_ceiling`
  and a dashboard prompt. Answered-approve → route proceeds; answered-decline →
  route stays on the default.
- Exceeding an approved ceiling stops the Task, records `cost.exceeded`, and
  parks for the human; it never silently continues on a more expensive route.

### 15.5 Cost invariants (testable)

- **I15.1** No dispatch happens when the sum of live Task costs plus the new
  Task's projected cost exceeds the Run budget.
- **I15.2** A paid-fallback or burst Task is dispatched only after a `cost`
  gate answer of approve.
- **I15.3** Budget exhaustion never writes `succeeded` (verifier only) and
  never writes `failed` for the Run (parked, human-resumable).
- **I15.4** Every accounting delta has exactly one `task.budget_delta` event.

---

## 16. Verification

### 16.1 Maker/verifier separation

The executor that ran a Task never verifies it. `verifying` is entered from
`running` and only the verifier transitions it to `succeeded` (I6.3). The
verifier is an independent role: a separate agent identity (review agents
outnumber build agents 3–4x per Foundry design principle 5/quality bar), or a
non-model check (lint/type/test) for mechanical Tasks.

### 16.2 `VerifyContract`

Every Task that produces product change carries a contract with the same five
fields as the oneshot interview gate (§9 of the oneshot spec):

```ts
export type VerifyContract = {
  measurableArtifact: string;   // what must exist and be measurable
  verifyCommand: string;        // becomes VERIFY.md when exec turns on
  writeScope: string;           // paths + branch
  stopCondition: string;        // when the Task must stop (not succeed)
  pauseCondition: string;       // e.g. N identical failures, paid action,
                                // missing credential
};
```

A Task missing any field fails closed at the gate: it cannot enter
`verifying`, the missing fields are surfaced in the dashboard, and it parks
(human supplies them). The contract is **operator-supplied**, never parsed from
the brief (§9 of the oneshot spec).

### 16.3 Verification tiers

| Tier | What runs | Available in v1 |
|---|---|---|
| `contract` | measurable artifact exists + well-formed; write scope honored; stop/pause conditions inspected | always |
| `static` | lint/typecheck/test where the repo provides them, inside the sandbox | when a sandbox runtime exists |
| `exec` | every `VERIFY.md` command runs in the sandboxed runtime, all exit zero | gated behind the Sandbox runtime (oneshot lock §2) |

`succeeded` requires at least the `contract` tier to pass; `static` and `exec`
tiers gate on their runtimes. A Task never reports `succeeded` by
self-attestation.

### 16.4 Verdict recording

The verifier records `verify.passed`/`verify.failed` events with the evidence
(list of checks run, exit codes, artifact measurements). Evidence is stored as
`TaskArtifact`s on the Task (`kind: "verify_evidence"`) and surfaced at the
`evidence` gate.

### 16.5 Verification invariants (testable)

- **I16.1** `verifying → succeeded` only from the verifier; the executor's
  `completed` report only reaches `verifying`.
- **I16.2** A Task with an incomplete `VerifyContract` cannot enter
  `verifying` (fails closed).
- **I16.3** Every `succeeded` Task has at least one `verify.passed` event and
  a `verify_evidence` artifact.
- **I16.4** `exec`-tier `succeeded` requires every `VERIFY.md` command to have
  exited zero in the sandbox (no exceptions in v1).

---

## 17. Agent fusion stages

Fusion is how multiple agent outputs combine into one artifact. It is itself a
Task whose `deps` are the N producer Tasks; it consumes their artifacts and
emits one fused artifact plus provenance.

### 17.1 Fusion kinds

| Kind | Producers → combine | Used for | Foundry mapping |
|---|---|---|---|
| `council` | N independent agent views → synthesis + dissent note | design/architecture decisions | `council` stage |
| `review` | 1 build agent → ≥3 review agents (N≥3 for M+ sizes) | code quality, evidence | `evidence`, quality bar |
| `arena` | N parallel candidates → pick base, graft strongest parts | competing designs/implementations | new |
| `synthesis` | N research/inspection outputs → one structured brief | research/plan | `research`, `plan_pack` |
| `verify` | producer + independent verifier → verdict | every product change | `verification` (§16) |

### 17.2 Fusion rules

- A fusion Task is `blocked` until all producer Tasks are `succeeded`; a
  required producer failure cancels the fusion (`dependency_failed`).
- Producers run on distinct agent identities; no agent is both producer and
  fusion combiner for the same artifact (maker/verifier separation).
- The fused artifact records provenance: producer task ids, model routes,
  budgets, and the combine rule. Provenance is a `TaskArtifact`
  (`kind: "fusion_provenance"`).
- Fusion output is subject to the same `VerifyContract` and small-PR policy as
  any product change.

### 17.3 Fusion invariants (testable)

- **I17.1** A fusion Task consumes exactly its declared producer artifacts.
- **I17.2** No agent identity appears as both producer and combiner of the
  same artifact.
- **I17.3** Every fused artifact has a `fusion_provenance` artifact listing
  producers, routes, and combine rule.
- **I17.4** Fusion never overrides a Gate; a fused recommendation still parks
  at the human gate.

---

## 18. Small-PR policy

### 18.1 Policy

- A product-changing Task targets a **small PR**: default ≤ 400 changed lines
  and ≤ 20 files (`FOUNDRY_PR_MAX_LINES`, `FOUNDRY_PR_MAX_FILES`; operator
  overridable per Issue).
- A Task whose expected scope exceeds the policy MUST be decomposed into child
  Tasks before creation (decomposition is a planning Task, §7.2). The scheduler
  refuses to dispatch an over-size Task as-is (`defer:pr_size`, §8.2).
- A PR is one coherent unit produced by one Task chain; it is never assembled
  from unverified partials.

### 18.2 Enforcement

- Adapter-side: the diff is measured after execution; over-size diff is
  reported and the Task parks at a `phase` gate with the split suggestion.
- Evidence gate: the operator reviews the diff; approve, or require
  decomposition before merge. Over-size never auto-splits and never auto-merges.

### 18.3 Branch naming

`foundry/<issueId>-<taskId>` (replacing the execute-stage
`foundry/<issueId>-<ts>` pattern; one Task chain owns one branch). Branch names
are Task-scoped so parallel Tasks on the same repo cannot collide on branches
(even when their file claims are disjoint).

### 18.4 No auto-merge

No component merges a PR. Merge is a human `merge` gate (§19) with the diff
and evidence in front of the operator. This is a hard rule (§28).

---

## 19. Human gates

### 19.1 Gate inventory

Existing `GateKind = "grill" | "plan" | "phase" | "evidence"` is extended with
two kinds (forward-compatible):

| Gate | Kind | Blocks | Cleared by |
|---|---|---|---|
| Grill | `grill` | the Walk after research | all Decision tickets answered |
| Plan | `plan` | the Walk after plan_pack | operator approval |
| Phase | `phase` | a Task's PR/diff | operator approval |
| Evidence | `evidence` | merge | verifier evidence review + diff review |
| Cost | `cost` | paid fallback / burst hosts | operator Decision ticket (approve/decline) |
| Merge | `merge` | the final merge | operator approval (no auto-merge) |

### 19.2 Hard-stop rules

- Workers do not continue past a Gate until the operator acts (CONTEXT.md
  definition of Gate). In multi-agent terms: a pending gate on a Run keeps the
  Run's Tasks `blocked` (`defer:gate`), including a **pause** of further
  dispatch while the gate is open.
- Every **outward action** requires approval: PR creation, merge, deploy,
  external API writes, paid model usage, burst-host rental, GitHub writes.
  None of these happens by default; each is its own explicit operator action.
- Pause/resume/cancel are always available from the dashboard, per Issue, Run,
  or Task. Cancel cascades to dependents (fail-fast) and releases leases and
  claims.
- One shot: grill Decision tickets still auto-answer with the worker
  recommendation (consistent with the filed oneshot Decision ticket), but that
  answers a Decision ticket, never a Task verdict or goal status.

### 19.3 Gate invariants (testable)

- **I19.1** No dispatch for a Task whose Run has a pending gate.
- **I19.2** No outward action without its explicit operator approval event in
  the Event log.
- **I19.3** Merge happens only through the `merge` gate; no auto-merge path
  exists in code.
- **I19.4** Cancel always terminates the Task's lease and releases its claims.

---

## 20. Event log

### 20.1 One audit trail

Every orchestration event is written to the existing append-only Event log via
`appendEvent(issueId, kind, payload, actor)` (`data/logs/<issueId>.jsonl`),
with `runId` and `taskId` in the payload. `OrchestrationEvent` rows (§5.2) are
a typed projection of the log for the dashboard; there is **no second event
trail and no `orchestration_events` table**.

### 20.2 Kinds added

- `task.created`, `task.state_change` (`{ from, to, actor }`), `task.budget_delta`
  (`{ delta, tokens_used, budget }`), `task.soft_stop`, `task.lease_granted`,
  `task.lease_revoked`, `task.claim_acquired`, `task.claim_released`,
  `task.attempt_started`, `task.attempt_failed`, `task.turn_delta`,
  `task.verify_passed`, `task.verify_failed`, `task.cancelled`.
- `dag.created`, `dag.completed`, `dag.failed`, `dag.blocked`, `dag.cancelled`.
- `host.registered`, `host.capacity_change`, `host.unreachable`,
  `host.recovered`.
- `scheduler.dispatch` (`{ decisions }`), `scheduler.defer`
  (`{ taskId, reason, code }`).
- `fusion.created`, `fusion.completed` (`{ producers, combineRule }`).
- `cost.ceiling_approval`, `cost.exceeded`, `cost.stop`.
- `model.route`, `model.fallback_denied`.

Actor reuses `EventActor` (`{ source: "system" | "operator"; reason? }`).

### 20.3 Event log invariants (testable)

- **I20.1** Every state transition, lease, claim, budget delta, gate action,
  and dispatch/deferral has exactly one Event-log entry.
- **I20.2** Events are append-only; nothing is ever edited or deleted.
- **I20.3** Payloads never contain secrets (§25.3).

---

## 21. Observability

### 21.1 Dashboard surfaces

- **Task board** — per Issue/Run: task cards with state, host, model, budget
  bar, attempts, lease countdown, and deferral reason when stalled. Attention
  dots on active Tasks (NAC pattern).
- **Deferral ledger** — why Tasks are not dispatching, grouped by code
  (`gate`, `resources`, `model`, `cost`, `claim_conflict`, `pr_size`,
  `placement`, `concurrency`). A stalled Task must always show a reason.
- **Host panel** — capacity vs live load per host, health, reserve usage
  (VPS reserve visible), heartbeat age.
- **Fusion provenance** — producers, routes, combine rule per fused artifact.
- **Event log viewer** — per Issue (existing Event log surface).
- **Budget bars** — task/run/issue/run-mode ceilings and consumed.
- **Cost ledger** — per task/run spend, ceiling approvals.

### 21.2 Health

- Host health via heartbeat (`host.unreachable` on missed beats; scheduler
  stops dispatching to it, running Tasks recover by lease expiry, §10).
- Health output never leaks store paths or secrets (NAC health-check rule).
- Scheduler exposes `scheduler.tick` stats (decisions/deferrals per tick).

### 21.3 Metrics

Dispatch latency, lease-expiry rate, retry rate, success rate by stage and
model, cost per task/run, fusion fan-out, gate dwell time. These derive from
the Event log; no separate metrics store in v1.

---

## 22. Continual learning

### 22.1 Harvest

On Task success or terminal failure, the learning pass extracts lessons:

- **Pattern** — what the Task did (from the diff + artifacts) and the outcome.
- **Evidence** — the Event log span and the verifier evidence for the Task.
- **Retention rule** — a candidate rule (lint, gate, skill, prompt) that would
  have caught the failure or made the success cheaper.

Lessons are structured rows (no markdown) under `data/`, keyed to the Issue,
and emitted as `task.lesson` events.

### 22.2 Promotion

A lesson becomes a **gate**, **lint rule**, or **skill** only when:

1. The same pattern recurs ≥ `FOUNDRY_LESSON_PROMOTE_THRESHOLD` (default 3)
   times across distinct Issues, OR the operator explicitly promotes it; and
2. The operator approves the promotion (a `plan`-style Decision ticket).

Promotion encodes the rule in structure (lint/check/gate), never as prose
(design principles 1 and 8: Environment Over Documentation,
Anti-Slop Is Engineering). **Nothing auto-installs**; no agent promotes its own
lesson.

### 22.3 Anti-reward-hacking

- Learning runs after the Task is terminal; the Task's own outcome never
  rewards the lesson or the agent that produced it.
- A lesson that would relax a gate or budget is rejected by default.
- Continual learning is observability and policy input, not a runtime
  controller, in v1.

### 22.4 Learning invariants (testable)

- **I22.1** A lesson is never installed without operator approval.
- **I22.2** A lesson promotion does not change any runtime behavior until the
  next operator-approved policy update.
- **I22.3** Learning never reads or writes inside a Sandbox (§11.3).

### 22.5 Execute-learning adapter (implemented)

`lib/foundry/execute-learning.ts` implements the learning pass for terminal
`execute` runs. It exposes a class `ExecuteLearning` with
`submit(input: ExecuteLearningInput)`.

- **Input** — `ExecuteRunEvidence` (issueId, taskId, runId, outcome, pattern,
  refs, retentionRule?, author?) plus a `LessonReview` (reviewer, verdict) and
  an explicit `operatorApproved` flag. Missing or blank task/issue ids, hollow
  evidence (no concrete pattern), and evidence with no refs are rejected
  without appending a row.
- **Harvest** — strong terminal evidence becomes a durable `lesson` record in
  the shared learning ledger (`lib/foundry/learning.ts`; real persistence via
  `createLearningStore()` from `store.ts`). The run reference is the first
  evidence ref.
- **Promotion gates** — a `promotion` record requires (a) an **approved
  independent review** by a reviewer distinct from the author and (b) either
  the operator's explicit `operatorApproved` or the lesson key recurring
  across ≥ `LESSON_PROMOTE_THRESHOLD` distinct issues (default 3). Self-review
  and policy-relaxing retention rules (`relaxesPolicy`) are rejected **even
  with** `operatorApproved`.
- **Decisions only** — a promotion is a record, never an install. Nothing in
  the adapter writes prompts, source, config, gates, or skills; the caller
  retains effects and human authorization (§22.2).
- **Replay-safe** — the ledger dedups by stable key; replaying the same input
  over the same store appends nothing and emits no audit events. Audit events
  (`lesson.harvested`, `lesson.promoted`) fire exactly once per appended
  record.

### 22.6 Recursive improvement loop (implemented)

`lib/foundry/improvement-loop.ts` is the **pure policy** for recursive
improvement. `decideImprovement(candidates, state)` returns a plain
serializable `ImprovementDecision`: `start` (with only a `candidateId`),
`wait` (with a reason), or `stop` (with a reason). It never executes effects,
never mutates state, and never authorizes itself.

- **Scope** — candidates target `IMPROVEMENT_STAGES` (`research`, `improve`,
  `plan_pack`, `council`, `architecture`, `execute`, `evidence`).
  `FORBIDDEN_ACTIONS` — `merge`, `hygiene`, `gates`, `host_configuration` —
  are operator-only and permanently out of scope; a candidate proposing one
  stops the loop.
- **Evidence-backed** — a candidate must carry lesson ids and evidence refs
  and a finite positive `estimatedCostUsd`. Its proposal must not relax
  policy, its target stage must be eligible, and its reviewer must be distinct
  from its author with an approved review. Paid work requires explicit
  `paidAuthorization` — the loop never grants it to itself.
- **Stop / wait** — `stop` on: no candidates, iteration bound reached, spend
  budget exhausted, top candidate over the remaining budget or the
  per-candidate ceiling, forbidden stage/action, policy-relaxing proposal,
  missing evidence, non-finite/negative cost or policy fields, self-review.
  `wait` on: a pending human gate, a missing or unapproved review, unresolved
  candidate dependencies, or paid work without explicit authorization.
- **Deterministic** — highest priority first; ties on `createdAt`, then `id`;
  input order is irrelevant and inputs are never mutated.
- **Decisions only** — output is a decision record; the caller owns effects
  and human authorization.

### 22.7 Unattended selection (implemented)

`lib/foundry/unattended.ts` is the pure, data-only selector for unattended
work: `selectUnattended(snapshots, limit)` returns
`{ selected: string[], exclusions: UnattendedExclusion[] }`, with
`unattendedExclusionFor(snapshot)` exposing the per-issue reason. It never
reads or writes the store, never answers a gate, and never starts a worker —
every input is injected, so identical input yields identical output.

- **Eligible stages** — `UNATTENDED_ELIGIBLE_STAGES`: `research`, `improve`,
  `plan_pack`, `council`, `architecture`, `execute`, `evidence`.
- **Never selected** — `UNATTENDED_EXCLUDED_STAGES`: `intake`, `grill`,
  `spec` (human-shaped), `merge` (no auto-merge policy), `hygiene`
  (operator-driven post-merge cleanup).
- **Exclusion reasons** (one per issue, fixed priority) —
  `disallowed-stage`, `disallowed-target`, `pending-human-gate` (a gate is
  never auto-answered), `active-job`, `oneshot-walking`, `walk-held`,
  `grill-held`, `unresolved-dependencies`.
- **Bounded** — `limit` must be a finite positive integer, hard-capped at
  `UNATTENDED_LIMIT_CAP = 20`. Selection is oldest-first (`createdAt`, then
  `id`), independent of input order, and inputs are never mutated.
- **Decisions only** — persistence and effects belong to the caller, under
  human authorization.

---

## 23. Deployment topology

### 23.1 v1 topology

```
            operator (Mac, Tailscale)
                    │
         ┌──────────┴──────────┐
         │  control plane      │        on vps :3100 (Next.js + eve + store)
         │  dashboard          │
         │  Walk driver        │
         │  scheduler          │   ← pure decisions
         │  store (SQLite WAL) │   ← single writer
         │  event log (JSONL)  │
         └──────────┬──────────┘
                    │ Tailscale / local
    ┌───────────────┼──────────────────┐
    │               │                  │
  host: vps      host: mac          host: box (off by default)
  containers +   git-worktrees      vm burst (needs enable + cost gate)
  git-worktrees  (visual/UI only)
```

- **Single writer**: the control plane on the VPS is the only writer to the
  store. Hosts run executors that read decisions and report; they never write
  orchestration rows directly (adapter reports go through the control plane
  with lease fencing, §10.2).
- **No new service**: the scheduler and watchdog run inside the existing
  Next.js process (same as the current oneshot tick). The task table doubles
  as the queue (existing `queue.ts` drain pattern).
- The Mac connects over Tailscale to the VPS control plane; visual/UI Tasks
  run locally on the Mac via the `mac` host adapter.
- Box/Cloudflare burst is not in the v1 topology until Phase 4 (§27).

### 23.2 Protected-state coexistence

The VPS's running Eve containers and the remote dirty checkout are untouched
by the orchestration plane (§9.3). The control plane and the orchestration
workspaces use separate roots from protected state; the sanctioned workspace
roots never include protected paths (§11.5).

### 23.3 Topology invariants (testable)

- **I23.1** Exactly one writer process holds the store at any time
  (single-writer; verified by the lease fencing + CAS, not by trust).
- **I23.2** Executors can read the store (via the control plane) but cannot
  transition Tasks except through lease-fenced reports.
- **I23.3** The scheduler and watchdog are in-process; no separate scheduler
  service competes for the same Issue (§3.1, §4.2).

---

## 24. Migration from current Foundry

### 24.1 Strategy

Replace-in-place behind `FOUNDRY_MULTIAGENT=1`, exactly like oneshot v2.
Migration is **additive**: new tables, new modules, feature-gated entry.
Nothing existing is deleted, renamed, or resequenced in this slice.

### 24.2 Steps

1. Land the orchestration tables through the existing migrate path
   (`CREATE TABLE IF NOT EXISTS` + `ensureColumn` style; no destructive DDL).
2. Land the store, scheduler, adapters, verifier, and model router as new
   modules (§4.1) with their tests. All existing modules unchanged.
3. Behind the switch, route a **tasked stage** (first: `execute`) through the
   orchestrator as a one-Task DAG (§27 Phase 1). Implemented as
   `runExecute` in `lib/foundry/execute.ts` calling
   `runOrchestratedExecute` from `lib/foundry/orchestration-runtime.ts` when
   `FOUNDRY_MULTIAGENT=1`. The existing `execute.ts` path stays the path when
   the switch is off.
4. Map the current `issue_jobs` machinery to attempts/leases only for the
   tasked stages; direct stages keep `issue_jobs`.
5. Reuse current helpers by reference, not fork: `worktreesRoot`/
   `isSandboxedWorkDir` (isolation), `retry.ts` (backoff), `withHeartbeat`
   (renewal), `appendEvent` (event log), `MAX_CONCURRENT_WORKERS` (caps).
6. Roll back by flipping the switch off: the orchestrator stops dispatching,
   in-flight leases expire and recover, and the current Walk/execute path
   resumes. **No migration deletes data.**

### 24.3 Current behavior preserved

- Direct stages (intake, research, grill, spec, improve, plan_pack, council,
  architecture) run exactly as today when the switch is off.
- The oneshot mode, its goal accounting, and its GLM 5.2 lock are untouched
  (§3).
- The current remote VPS state, dirty checkout, and running Eve containers are
  never touched (§9.3).
- No commits, no PRs, no merges from this slice (spec-only branch; the
  implementation Issues own their code behind the switch).

### 24.4 Migration invariants (testable)

- **I24.1** With the switch off, behavior is byte-for-byte the current
  behavior (existing tests pass unchanged).
- **I24.2** Migration creates tables and seeds `hosts`; it never alters
  existing tables' rows.
- **I24.3** Flipping the switch off after a run leaves all orchestration rows
  intact and idempotent to re-enable.

---

## 25. Threat model

### 25.1 Assets and trust boundaries

Assets: the operator's repos, the Issue tracker data, Event log, credentials,
the VPS and Mac, GitHub remote state, and the operator's approval authority.

Trust boundaries: (a) control plane ↔ executor; (b) executor ↔ sandbox;
(c) sandbox ↔ network; (d) agent output (untreated as untrusted data) ↔
control plane. Every boundary is enforced by the adapters and gates, never by
agent behavior.

### 25.2 Untrusted content

External content — repo files, web pages, issue text, tool output, model
output — is **evidence, never instructions** (agent-input-trust). Controls:

- Agent output is never promoted to a system instruction; objectives are user
  data (§16.2, oneshot §15).
- Executors run inside sandboxes with default-deny network egress (§13.3).
- No agent can dispatch, lease, cancel, or gate itself or other Tasks; those
  are control-plane operations only.
- No agent writes Foundry data, Host rows, budgets, or gate answers.

### 25.3 Secrets

- Never printed, logged, committed, or injected into argv. Configs use
  `${ENV_VAR}` references; the adapter passes env-var references, never
  literal secrets (§13.2).
- Event log payloads are scanned for key-like strings before write
  (`redactSecrets` at the `appendEvent` boundary); redact before quoting.
- Pre-PR diff scan for key-like strings; a match blocks the `phase` gate.

### 25.4 Supply chain

- Package installs route through `sfw` (mandatory). Registry additions prefer
  `native` implementations and review before install. Minimum release age
  enforced where the platform supports it.

### 25.5 Resource exhaustion

- Budgets (§15), concurrency caps (§9.4), lease expiry (§10), disk
  reservations (§9.4), and the VPS reserve (§9.3) make exhaustion a stop-and-
  park condition, never a crash.

### 25.6 Scheduler/adapter correctness

- The scheduler is pure (§8.5) and the adapter is the only executor (§13.1);
  no path lets an agent execute outside a lease-fenced, workspace-contained
  context.
- CAS on every transition and lease renewal makes stale/fenced writes
  impossible (§10.2).
- No auto-merge, no destructive cleanup, no external writes without a gate
  (§19, §28).

### 25.7 Threat-model invariants (testable)

- **I25.1** A fenced (expired-lease) executor write is rejected by the store.
- **I25.2** No agent-initiated action can reach GitHub, deploy, or spend
  money without an operator gate event in the log.
- **I25.3** The Event log contains no literal secret strings (redaction
  applied at the write boundary; tested with known key patterns).
- **I25.4** A prompt-injected instruction in any external content never
  changes a gate answer or a Host row (both control-plane-only).

---

## 26. Failure modes

| Failure | Detection | Recovery | Stop condition |
|---|---|---|---|
| Executor dies mid-Task | lease expiry / stale heartbeat | attempt `failed`, `failed → ready` (backoff) or terminal; partials quarantined | after `maxAttempts` |
| Scheduler crash | process restart | idempotent tick recomputes from store; leases in DB survive | none (self-healing) |
| Provider rate limit / quota | transient error markers (`retry.ts`) | backoff retry; `usage_limited` → park, human resume | human resume |
| Dependency permanent failure | required dep terminal | fail-fast cascade to `cancelled` | DAG `failed` → operator |
| File-claim conflict | scheduler rule 6 | `defer:claim_conflict`, one Task waits | human resolves or reorders |
| Budget exhausted | soft/hard stop | park at gate, human raises budget | human resume |
| Cost ceiling exceeded | `cost.exceeded` | Task stops, parked | human approves/raises |
| Host unreachable | missed heartbeats | stop dispatch to host; running Tasks recover by lease expiry | host re-registers healthy |
| Split-brain double-execution | fencing CAS | fenced writes rejected; one winner | — |
| Oversize PR | diff measured | parks at `phase` gate | operator splits or approves |
| Clock skew | lease expiry tolerance | ISO comparisons; skew tolerance `FOUNDRY_SKEW_MS` default 5 min | — |
| Partial artifact published | — (prevented) | partials quarantined, never `succeeded` | — |
| Provider account/lockout | auth failure marker | Task `failed` permanent; operator action | operator resolves |

Every failure path ends in one of: retry (bounded), park-for-human, or
terminal-with-event. No failure mode silently drops a Task: each has an event
and a dashboard state.

---

## 27. Rollout phases

| Phase | Ships | v1? |
|---|---|---|
| 0 | This spec; orchestration types; store schema | yes |
| 1 | Store + scheduler + adapters + verifier + model router behind `FOUNDRY_MULTIAGENT=1`; `execute` stage as a one-Task DAG end to end on `vps` (`container` + `git-worktree`); lease/recovery; small-PR branch naming | yes — **v1 minimal end-to-end** |
| 2 | File claims with overlap rejection; model routing (text → OMP DeepSeek v4 Flash, vision-only, paid-fallback ceilings); cost gates | yes |
| 3 | Fusion stages (council/review/arena/synthesis), verification exec tier (when sandbox runtime lands), continual learning harvest + promotion | no |
| 4 | Multi-host placement active: `mac` visual/UI host; Box/Cloudflare burst enabled per Decision ticket with explicit economics | no |
| 5 | Full DAG decomposition of `execute` and `evidence`; multi-issue pipelines | no |

**v1 scope (Phases 0–2):** one Issue, one tasked stage (`execute`), a one-Task
DAG, scheduler → adapter → verifier → evidence, human gates intact, event log
complete, model routing and cost ceilings live, file claims live, small-PR
policy enforced. End to end and minimal. Everything beyond is additive.

Phase-gate rule: each phase ends with its own verification against the real
artifact (live E2E on :3100), the existing suite passing unchanged with the
switch off (I24.1), and its invariants (§28) green.

---

## 28. Invariants and stop conditions (testable)

The following are the system-wide invariant and stop-condition list. Each MUST
have a test; the implementation Issues own the specific tests.

### 28.1 System invariants

- **S1** Every Task transition respects `LEGAL_TRANSITIONS`; any other
  transition is rejected (I6.0).
- **S2** Every transition, lease, claim, budget delta, and gate action has one
  Event-log entry (I20.1).
- **S3** The scheduler never executes; adapters never decide (I8.4, I13.1).
- **S4** No two active claims overlap on the same repo ref (I12.1).
- **S5** A Task is `succeeded` only via the verifier (I6.3, I16.1).
- **S6** Live Task resources never exceed host capacity minus reserve
  (I8.5, I9.3).
- **S7** No outward action without an operator approval event (I19.2).
- **S8** No auto-merge, no destructive cleanup, anywhere (I19.3, §28.3).
- **S9** No Foundry data inside any Sandbox (I11.3).
- **S10** Budget exhaustion never yields `succeeded` or `failed`; it parks
  (I15.3).
- **S11** A fenced executor write is rejected (I25.1).
- **S12** With the switch off, current behavior is unchanged (I24.1).
- **S13** Protected state (VPS 16 GB reserve, dirty checkout, running Eve
  containers) is never claimed, written, or cleaned (I9.3, I11.2).

### 28.2 Stop conditions

The orchestrator stops dispatching (parks, never cancels or fails the Run)
when:

- A human gate is pending (gate open → no further dispatch; §19.2).
- The Run or Task budget is exhausted (soft/hard stop; §15.3).
- A cost ceiling requires approval that is not yet given (§15.4).
- A required dependency is permanently failed and no decomposition is in
  flight (the Run is then `failed`, operator reviews).

A Run is `succeeded` only when every Task is `succeeded` (verifier-passed).
A Task never stops because of budget and is never allowed to stop early and
claim success (I15.3).

### 28.3 Never

- Never merge, never deploy, never open an external PR without the operator.
- Never let a promotion, the recursive improvement loop, or the unattended
  selector install policy or perform effects: each emits a **decision only**;
  the caller applies effects under human authorization (§22.5–§22.7).
- Never run destructive cleanup (no `rm -rf` outside sanctioned, guarded
  workspace roots; no force-push; no resource delete).
- Never let an agent set a Gate answer, a Host row, or its own verdict.
- Never use a paid model or burst host without a cost gate.
- Never route vision work to a text model.
- Never let budget exhaustion count as completion.

---

## 29. Acceptance criteria — this Issue (spec contract only)

This Issue delivers the architecture contract only. The behavioral criteria
describe what the implementation Issues must satisfy; this Issue satisfies
them by locking the contract.

| # | Criterion | Where fixed |
|---|---|---|
| 1 | Foundry domain language preserved; new primitives named and mapped (§2) | §2, §3, CONTEXT.md |
| 2 | Every cross-component interface explicit and implementable (types, tables, function surface, dispatch/adapter/router/verify contracts) | §5, §8, §13, §14, §16 |
| 3 | Task state machine with legal transitions; stale writes rejected; testable invariants | §6 |
| 4 | DAG model with validation and fail-fast cascade | §7 |
| 5 | Scheduler is pure; output is a dispatch decision; deferrals recorded; fairness; no execution | §8 |
| 6 | Hosts mac/vps/box with capacities; VPS 16 GB + dirty checkout + running Eve containers protected | §9 |
| 7 | Leases, heartbeat, fencing, watchdog recovery | §10 |
| 8 | Isolation kinds + containment guards; no Foundry data in Sandbox | §11 |
| 9 | File claims reject overlapping write paths | §12 |
| 10 | Adapters are the only executors; argv-safe OMP; workspace guards | §13 |
| 11 | Model routing: text → OMP DeepSeek v4 Flash; vision-only for image/video; paid fallback requires cost ceiling | §14 |
| 12 | Cost controls: budgets, soft/hard stop, ceiling approval; budget ≠ success | §15 |
| 13 | Maker/verifier separation; VerifyContract (five fields); exec tier gated on sandbox | §16 |
| 14 | Fusion stages defined with provenance and non-self-combine | §17 |
| 15 | Small-PR policy enforced; no auto-merge | §18, §28 |
| 16 | Human gates incl. cost and merge; every outward action requires approval | §19 |
| 17 | Event log: one audit trail, new kinds, no second database | §20 |
| 18 | Observability surfaces and health | §21 |
| 19 | Continual learning with operator-approved promotion | §22 |
| 20 | Deployment topology with single writer; protected-state coexistence | §23 |
| 21 | Migration from current Foundry behind a switch; additive; rollback | §24 |
| 22 | Threat model with enforced boundaries | §25 |
| 23 | Failure modes all end in retry/park/terminal with an event | §26 |
| 24 | Rollout phases; v1 minimal but end-to-end | §27 |
| 25 | Invariants and stop conditions testable; no auto-merge / no destructive cleanup | §28 |
| 26 | Cloudflare Containers optional burst with explicit economics only; never assumed free VPS replacement | §9.6, §27 Phase 4 |
| 27 | No code, no git, no tests, no installs in this Issue; this document is the artifact | §24.3, this line |

---

## 30. Implementation ownership (for the follow-on Issues)

| Module | File(s) | Owns (§) |
|---|---|---|
| Orchestration domain types | `lib/foundry/orchestration-types.ts` | §5.2 |
| Orchestration store | `lib/foundry/orchestration-store.ts` | §5, §6, §10 |
| Scheduler | `lib/foundry/scheduler.ts`, `tests/scheduler.test.ts` | §8, §9.4, §12.2 |
| OMP runner adapter | `lib/foundry/omp-runner.ts` | §13.2 |
| Workspace adapter | `lib/foundry/workspace.ts`, `tests/workspace.test.ts` | §11, §13.3 |
| Verification | `lib/foundry/verification.ts`, `tests/verification.test.ts` | §16 |
| Model router | `lib/foundry/model-router.ts`, `tests/model-router.test.ts` | §14, §15 |
| Execute runtime + driver | `lib/foundry/orchestration-runtime.ts`, `lib/foundry/orchestration-execute.ts`, `lib/foundry/orchestration-execute-driver.ts`, `tests/orchestration-runtime.test.ts`, `tests/orchestration-execute.test.ts`, `tests/orchestration-execute-driver.test.ts` | §13, §16, §26 |
| Watchdog / recovery | extends `lib/foundry/watchdog.ts`, `heartbeat.ts` | §10 |
| Execute-learning adapter | `lib/foundry/execute-learning.ts`, `lib/foundry/learning.ts`, `tests/execute-learning.test.ts`, `tests/learning.test.ts` | §22 |
| Recursive improvement policy | `lib/foundry/improvement-loop.ts`, `tests/improvement-loop.test.ts` | §22 |
| Unattended selector | `lib/foundry/unattended.ts`, `tests/unattended.test.ts` | §22 |
| Improvement candidates | `lib/foundry/improvement-candidates.ts`, `tests/improvement-candidates.test.ts` | §22 |
| Autonomous policy driver | `lib/foundry/automation.ts`, `tests/automation.test.ts` | §22 |
| Automation driver | `lib/foundry/automation-driver.ts`, `tests/automation-driver.test.ts` | §22 |
| Automation runtime | `lib/foundry/automation-runtime.ts`, `tests/prove-automation.test.ts` | §22 |
| Automation control | `lib/foundry/automation-control.ts`, `tests/automation-control.test.ts` | §19, §22 |
| Live-proof harness | `scripts/prove-orchestration.ts`, `tests/prove-orchestration.test.ts`, `tests/prove-automation.test.ts` | §32 |
| Operator surface | `app/automation/page.tsx`, `app/actions.ts`, `app/_components/sidebar.tsx` | §19, §21 |

---

## 31. Implementation Issue gate checklist

When the implementation Issues open, each must clear this checklist before
merge, all behind `FOUNDRY_MULTIAGENT=1` with the existing path unchanged when
the switch is off:

- [ ] Orchestration tables created via `store.ts` `SCHEMA`/`migrate()`;
      `node:sqlite` only; no `better-sqlite3`; no second database.
- [ ] `hosts` seeded (mac/vps/box) and operator-editable; agents never edit.
- [ ] Task transitions enforce `LEGAL_TRANSITIONS` and CAS on `task_id`;
      stale writes rejected with a clear error.
- [ ] `validateGraph` rejects missing deps, self-deps, cycles; rejected graphs
      not persisted.
- [ ] Scheduler is pure; output is `DispatchDecision[]`; deferrals recorded
      with codes; no execution in the scheduler module.
- [ ] File claims normalized by one shared helper; overlap rejects dispatch;
      enforced in the adapter.
- [ ] Leases grant/renew/expire with fencing; watchdog reconciles expired
      leases and stale Tasks idempotently.
- [ ] Adapters argv-array only; cancel always reports `cancelled`; workspaces
      guarded by the containment check; no Foundry data in workspaces.
- [ ] `routeModel` pure; text → `DEFAULT_TEXT_MODEL`; vision never text-only;
      paid fallback only with ceiling + `cost` gate.
- [ ] Budgets at task/run/issue/run-mode; soft/hard stop parks; exhaustion
      never `succeeded`.
- [ ] Maker/verifier separation; `VerifyContract` fails closed on five fields;
      exec tier gated on the sandbox runtime.
- [ ] Small-PR policy enforced at the `phase`/`evidence` gates; branch naming
      `foundry/<issueId>-<taskId>`; no auto-merge.
- [ ] Every event to the existing Event log via `appendEvent`; redaction at
      the write boundary.
- [ ] Switch off ⇒ existing tests pass unchanged; switch on ⇒ live E2E on
      :3100 proves a one-Task `execute` DAG end to end.
- [ ] Durable retry: `retryable` + `nextRetryAt` written atomically with
      `failTask`, cleared by `retryTask`/terminal/cancel; a due retry is
      reconstructed from the Task snapshot after store reopen and fresh driver
      invocations (I10.5).
- [ ] Execute learning: `ExecuteLearning.submit` harvests terminal execute
      evidence, never promotes without an approved independent review, rejects
      self-review and policy-relaxing lessons, and installs nothing
      (decisions only, I22.1–I22.2).
- [ ] Recursive improvement: `decideImprovement` is pure, bounded, and
      evidence-backed; never self-authorizes (paid work needs explicit
      authorization); `merge`/`hygiene`/`gates`/`host_configuration` are
      forbidden actions.
- [ ] Unattended: `selectUnattended` is data-only; excludes
      intake/grill/spec/merge/hygiene and gate-/hold-/dependency-blocked
      issues; limit hard-capped at 20.
- [ ] Automation control: the durable operator record (`automation-control.ts`)
      is versioned integer CAS with fail-closed defaults; every mutation is
      operator-only; stale writes and out-of-bounds patches (limit 1–20,
      iteration ceiling, spend cap, per-candidate ceiling, paid
      authorization) are rejected (§19, §22).
- [ ] Control-before-pass: `automation-runtime.ts` reads the durable control
      and runs one bounded pass only when it is enabled; a disabled or
      operator-held control returns with no planning and no start effects,
      recording a single wait/stop audit event (§22).
- [ ] Automation driver: `runAutomationDriver` builds the plan once, fails
      closed before any effect on duplicate issue ids or more than
      `AUTOMATION_LIMIT_CAP` starts, applies start intents sequentially, and
      records exactly one outcome per intent through the audit sink (§22).
- [ ] Improvement candidates: `deriveImprovementCandidates` derives
      evidence-backed candidates from promoted lessons plus explicit operator
      proposals only; approval is never inferred, and self-review and forged
      evidence are excluded (§22).
- [ ] Automation dashboard: `/automation` renders truthful
      disabled/paused/enabled status from the durable control; toggles and
      settings mutate only through the integer-version CAS and never start
      work (§19, §21).
- [ ] Bounded and daemon-free: the per-pass issue limit is hard-capped at
      `AUTOMATION_LIMIT_CAP = UNATTENDED_LIMIT_CAP = 20`; the automation
      runtime is a caller-invoked one-pass — no hidden background loop or
      daemon, no remote publication, no deploy, no auto-merge (§22, §28).
- [ ] Live proof: `scripts/prove-orchestration.ts` runs the real store,
      scheduler, workspace preparation, verification, driver, and
      finalization plus retry recovery in one command with structured JSON
      output and no remote publication; `tests/prove-automation.test.ts`
      proves the bounded automation runtime under durable control (§32).
- [ ] Invariants S1–S13 and stop conditions §28 have tests.
- [ ] No destructive git commands, no force-push, no secrets, no commits from
      the spec Issue itself.
