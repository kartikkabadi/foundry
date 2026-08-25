# Multi-agent engineering — source research (foundry)

Unit 1 of the foundry multi-agent system delegation. Purpose: ground the
`docs/specs/multi-agent-system.md` architecture contract in primary sources —
repos read from source, not summaries — and turn the evidence into reusable
patterns, anti-patterns, and a build-vs-reuse table.

Target system recap (from the spec, `docs/specs/multi-agent-system.md`):
SQLite Issue tracker + append-only JSONL Event log on the operator machine;
GitHub gets PRs only; Walk `Intake → Research → Grill → Spec → Improve → Plan
pack → Council → Architecture → Execute → Evidence → Merge → Hygiene`; gates
`grill/plan/phase/evidence` (+ `cost`, `merge`); eve workers pinned to GLM
`zai/glm-5.2` via Blackbox; run mode `hitl` (default) or `oneshot`; Sandbox =
disposable Docker checkout; Size XS/S/M/L or forced-L. Multi-agent slice adds
a Task DAG per Walk stage, a pure scheduler, adapters, and independent
verification behind `FOUNDRY_MULTIAGENT=1`.

Section numbers (§) below refer to that spec.

---

## 0. Scope and material

### 0.1 Repos read from source

| Repo | What it is | What it gave this research |
|---|---|---|
| `kartikkabadi/foundry` (local) | the system being built | spec contract, locked vocabulary, existing helpers (`appendEvent`, `retry.ts`, `isSandboxedWorkDir`, `MAX_CONCURRENT_WORKERS`) |
| `chanakya-net/Maestro-AI` | Python orchestrator + sub-coordinators + pool | dependency completion, recovery budgets, liveness |
| `rainyulei/legion_cc` | Rust DAG task scheduler over git worktrees | DAG + checkpoint gates, crash-safe restart, base_commit |
| `gabrielkoerich/orch` | Rust multi-channel orchestration engine | orchestrator owns git, no auto-merge, conflict handling |
| `christianmeurer/Lula` | Python LangGraph planner + Rust sandbox runner | maker/verifier split, SharedReflectionPool, GLEAN, sandbox tiers |
| `devinrosen/conductor-ai` | Rust workflow engine (workflow DSL, gates) | gate types, bounded retry, hybrid estimation |
| `AkaraChen/luna` | Rust job orchestrator + web dashboard | retry attempt cap, dependency hardening, hot-reload workflow |
| `erishforg/git-parsec` | Rust stack-PR + worktree manager | JSONL exec log, merge-tree conflict simulation, PR sizing |
| `levi-tc/ruah` | TypeScript agent with path claims | claim sets, path-overlap rejection |
| `biw/cloudflare-github-actions-runner` | ephemeral Cloudflare Containers GH runner | Cloudflare machine profiles + limits, private-repo-only |
| `qaml-ai/camelAI` | Cloudflare-hosted coding agent | Durable Object agent loop + short-lived sandbox containers |

### 0.2 Supplied research material (YouTube / X / Cloudflare / MiniMax / Ox)

Not found. Searched foundry `docs/`, `~/Projects`, `~/.agents`, and `~/Desktop`
for those terms. MiniMax appears only as an LLM provider in the separate
`summarize` project, not as research notes. The only Cloudflare economics text
in the workspace is the foundry spec itself (§9.6). Cloudflare Containers
facts in this doc therefore come from the two starred repos above and the
spec's phase plan. The "Ox Alpha video capability" and "unlimited tokens"
claims were flagged as weak before this unit started; neither has a primary
source in reach, so both are recorded as rejected (§12). Treat anything
relying on them as unverified.

---

## 1. Worktree isolation (§11)

### Facts

- **legion_cc** (`crates/legion-core/src/orchestrate/engine.rs`): each cohort
  gets its own camp (worktree); workers run in parallel and declare deps via
  `--after`. `TaskTicket` carries `base_commit` — "Git commit SHA when worker
  started this ticket (for diff base)" (line 64). `set_base_commit` is called
  when the worker starts (line 398). `.gitignore` excludes `.legion/` and
  `.worktrees/`. Results auto-merge to the leader branch.
- **git-parsec** (`src/conflict/simulator.rs`): conflict detection is a
  two-pass `git merge-tree --write-tree` three-way simulation — each worktree
  vs its base branch, and each worktree pair (lines 57-61). Read-only; it
  surfaces real line-level conflicts before merge. The filename-overlap
  heuristic alone was not enough (CHANGELOG `#246`).
- **orch** (`src/engine/auto_merge.rs`, `docs/architecture.md`): the engine
  owns git; agents only commit. The engine pushes, opens PRs, merges after CI.
  Conflict path is `attempt_worktree_rebase_and_force_push`.
- **foundry already has**: `data/worktrees/<id>` per-task worktrees, the
  lexical `isSandboxedWorkDir` containment guard, and `removeWorkDir` teardown
  that swallows removal errors with one warning Event (§11.2). These are the
  reuse points; the spec adds per-task branch naming
  `foundry/<issueId>-<taskId>` (§18.3) so parallel tasks on one repo cannot
  collide on branches even with disjoint claims.

### Patterns

- Capture `base_commit` at worker start, not at dispatch. Gives every retry a
  known diff base and makes restart safe.
- Teardown on success and failure; partials quarantined, never published as
  succeeded (foundry §10.3, §11.4).
- Per-task workspace is never reused by another Task (§11.4, I11.4).

### Anti-patterns

- orch force-pushes after a worktree rebase. Foundry forbids force-push
  (§28.3). Fix conflicts with file claims and the `phase` gate instead.
- Filename-overlap heuristics miss real conflicts; parsec needed merge-tree
  simulation to catch line-level clashes. Foundry prevents the overlap at the
  source via file claims (§12) rather than repairing it after the fact.

---

## 2. DAG scheduling (§7-8)

### Facts

- **legion_cc** (`engine.rs`): tasks list `blocked_by` ids; `add_ticket`
  validates every dep exists (lines 314-318). `is_ready` distinguishes
  checkpoints from normal tickets: a checkpoint needs deps `Done` only (it
  merges itself), a normal ticket needs `Done` + `Merged`/`Skipped`
  (lines 351-361). Default `max_iterations = 5` (line 128). On restart,
  `Working → Queued`; state is reloaded from SQLite (`TicketRow`).
  `/split-tickets` inserts checkpoint tickets (build/test/lint gates) between
  functional modules — the direct analog of foundry's Gates.
- **Maestro-AI** (`assets/run-with-it-state.py`): `issue_dependencies_completed`
  = every dep is in the completed set (line 317). Auto-unblock clears a
  dependency-only blocking reason once the dep completes, quarantining stale
  blocked artifacts (lines 565-585). Stale-base requeue is deliberately
  stricter than the generic matcher (lines 471-474).
- **conductor-ai** (`conductor-core/src/workflow/`): `coordinator.rs`,
  `executors/`, `item_provider/`, `estimation.rs`, `batch_validate.rs`,
  `persistence_sqlite.rs`. `workflow/estimation.rs` blends an LLM
  `estimated_minutes` with historical run medians: 0 runs → LLM only; 1-2 →
  LLM else median; 3-9 → 40% LLM + 60% median; 10+ → median only. Pure
  functions, callers pass the data.
- **luna** (`crates/luna/src/orchestrator.rs`): tick loop with an mpsc
  unbounded events channel, `scheduler.max_concurrent` global cap plus
  `max_concurrent_by_state` per-state caps (lines 822-838), workflow YAML
  hot-reload via `reload_if_changed()` mtime compare (lines 120-127).

### Patterns

- Pure scheduler: same store snapshot + `now` → same decisions (foundry I8.1);
  idempotent tick, no in-memory queue state (§8.4).
- Every deferral recorded with a code and task id (foundry `scheduler.defer`,
  I8.2). A stalled Task always shows why (§21.1 deferral ledger).
- Checkpoint tickets as DAG gates (legion) map to foundry's grill/plan/phase/
  evidence/cost/merge gates blocking dispatch (`defer:gate`, §8.2 rule 2).
- Dependency failure cascades (foundry §7.2): required dep terminal-failed →
  dependents `cancelled` with `dependency_failed: <taskId>`.

### Anti-patterns

- Unbounded retry loops on a DAG (luna plan 005 documented the harm: an issue
  that can never succeed churns at the backoff ceiling forever). Foundry caps
  attempts at `maxAttempts` (I6.5) and treats budget exhaustion as park, not
  failure (§15.3).

---

## 3. Resource controls (§9.4)

### Facts

- **foundry host registry** (§9.2): seeded `mac` 8 CPU / 16384 MiB / 512000
  MiB / concurrency 2, `vps` 4 / 16384 / 200000 / 3, `box` 2 / 8192 / 100000
  / 1. These are reserved-capacity numbers; `vps` is a constrained 16 GB host
  and must not be overcommitted. Scheduler keeps `FOUNDRY_VPS_RESERVE_MIB`
  (default 2048 MiB) plus the dashboard process as untouchable headroom (§9.3).
- Overcommit is impossible by construction: dispatch grants a lease only when
  the resource reservation succeeds atomically with the lease (§9.4).
- **cfrunner** (`README.md` lines 32-39, 61-63): Cloudflare Containers machine
  shapes run `cloudflare-lite` 1/16 vCPU / 256 MiB / 2 GB up to
  `cloudflare-standard-4` 4 vCPU / 12 GiB / 20 GB. Custom shapes: 1-4 whole
  vCPUs, up to 12,288 MiB memory, up to 20,000 MB disk; memory must be ≥ 3,072
  MiB per vCPU; disk ≤ 2 GB per GiB of memory. Invalid requests fail visibly
  before repo code runs.
- **luna**: `max_concurrent` and `max_concurrent_by_state` in workflow YAML;
  disk/workspace reservation is part of dispatch in foundry (§9.4).

### Patterns

- Reserve headroom for protected state (foundry VPS reserve, §9.3) — a
  dispatch that would violate it is `defer:resources`, never a breach.
- Budget cpu/memory/disk/concurrency per Task, sum live tasks against host
  capacity minus reserve (§9.4, I8.5).
- Cloudflare custom-shape rules (memory-per-vCPU floor, disk-per-memory cap)
  are a real precedent for validating `ResourceBudget` at dispatch.

### Anti-patterns

- Treating machine-spec ceiling as free capacity. Cloudflare's smallest shape
  is 256 MiB with 2 GB disk — far below the 16 GB VPS. Burst is not a VPS
  replacement (foundry §9.6, §27 Phase 4).

---

## 4. Host placement (§9.5)

### Facts

- **foundry placement policy**: text/engineering → `vps`; visual/UI (screens,
  design review, image/video analysis, browser QA) → `mac`; burst/heavy
  full-isolation → `box` only when enabled + budgeted; anything needing
  `vision` routes to a vision-capable host only (§9.5). The Mac is never a
  general text-compute target; the VPS is never a visual target without a
  vision model. Placement is a scheduler rule (`defer:placement`), not an
  adapter choice.
- **camelAI** (`README.md`): a coding agent loop runs in a Cloudflare Durable
  Object (`ChatThreadDO`); Linux is reserved for short-lived jobs — builds,
  notebooks, SQL — in dedicated Cloudflare sandbox containers; credentials
  stay outside the execution sandbox. Design rationale in the cited blog post.
- **cfrunner**: ephemeral runner is provisioned per `workflow_job` webhook and
  torn down after; repo visibility checked before scheduling and again before
  JIT runner creation (README lines 21-25).

### Patterns

- Separate control plane from execution: scheduler lives in the Next.js
  process on the VPS; hosts run executors only (§23.1 single writer).
- Placement as a pure rule with a visible deferral code, so the operator sees
  why a Task is not on its default host.

### Anti-patterns

- Letting agents pick their host. Hosts are seeded and operator-editable only;
  no agent registers or edits a Host (§9.1, I25.4).

---

## 5. PR sizing (§18)

### Facts

- **git-parsec**: stack-based workflow — `start --on <base>`, `stack sync`,
  `stack submit` in topological order (root first). Each stack layer is a
  reviewable PR. `.parsec` conflict simulation runs before ship.
- **foundry policy** (§18.1): a product-changing Task targets ≤ 400 changed
  lines and ≤ 20 files (`FOUNDRY_PR_MAX_LINES`, `FOUNDRY_PR_MAX_FILES`,
  operator-overridable). A Task whose expected scope exceeds the policy MUST
  be decomposed into child Tasks before creation (decomposition is a planning
  Task). Scheduler refuses to dispatch an over-size Task as-is
  (`defer:pr_size`, §8.2 rule 7). Adapter-side diff measurement parks the
  Task at a `phase` gate with a split suggestion (§18.2). No auto-split, no
  auto-merge.
- **conductor-ai** (`workflow/estimation.rs`): hybrid LLM + historical
  duration blending is a workable model for "is this Task too big" decisions
  before dispatch, though conductor uses it for time, not PR size.

### Patterns

- Make "too big" a scheduler deferral, not an after-the-fact surprise: the
  Task is not dispatched as-is; it is reported for decomposition (§8.2 rule 7).
- One coherent PR per Task chain; never assemble a PR from unverified partials
  (§18.1).
- Branch names are Task-scoped (`foundry/<issueId>-<taskId>`) so sizing
  decisions and parallel claims cannot collide (§18.3).

### Anti-patterns

- Auto-merge. orch merges after CI automatically; foundry's `merge` gate is
  human-only (§18.4, §19.1, S8). No component merges a PR.

---

## 6. Visual verification (§16)

### Facts

- **foundry**: visual/UI work routes to the `mac` host and a vision-capable
  model (§9.5). A vision Task must route to a vision-capable model and MUST
  NOT silently fall back to a text model; if no vision route exists on a
  reachable host, the Task is `defer:model`, never misrouted (§14.1 rule 2,
  I14.2). Verification tiers: `contract` (always), `static` (lint/type/test in
  the sandbox), `exec` (every `VERIFY.md` command exits zero, gated on the
  sandbox runtime; §16.3).
- **Lula** (`rs/runner/src/snapshots.rs`): a snapshots module exists in the
  sandbox runner — the sandbox can capture and compare snapshots as part of
  verification. (Read as inventory; snapshot comparison semantics not
  re-derived here.)
- Star `browser-use/macos-harness` confirms the pattern of driving the Mac for
  browser/UI work via a harness, matching foundry's `mac` host role.

### Patterns

- Maker/verifier separation: the executor never verifies its own Task; only
  the verifier reaches `succeeded` (§16.1, I6.3). Review agents outnumber
  build agents for quality bar (foundry design principle 5).
- VerifyContract with five fields (measurable artifact, verify command, write
  scope, stop condition, pause condition); a Task missing any field fails
  closed and parks (§16.2).

### Anti-patterns

- Route image/video analysis to a text model because it is cheaper. Foundry
  makes that a hard routing error (§14, S6-adjacent). The claimed "Ox Alpha
  video capability" is unverified (§12) and is not a basis for a vision path.

---

## 7. Event logs (§20)

### Facts

- **git-parsec** (`src/execlog.rs`): append-only JSONL at `.parsec/execlog.jsonl`
  (line 5, 87-88). Entry: `execution_id` (UUIDv4), `command`, `ticket`,
  `started_at`/`finished_at` UTC, `duration_ms`, status, error, `steps[]`
  with per-step ms (lines 27-31). `parsec log --export` emits it verbatim for
  pipelines (cli/mod.rs 1101-1124). This is the exact shape of foundry's Event
  log design.
- **foundry** (§20): every orchestration event goes to the existing
  append-only Event log via `appendEvent(issueId, kind, payload, actor)`
  (`data/logs/<issueId>.jsonl`). `OrchestrationEvent` rows are a typed
  projection for the dashboard; there is no second event trail and no
  `orchestration_events` table. New kinds cover state changes, leases, claims,
  budget deltas, gates, dispatch/deferral, fusion, cost, model route
  (§20.2). Payloads never contain secrets; `redactSecrets` runs at the
  `appendEvent` boundary (§25.3, I20.3).
- **Maestro-AI**: events land in `status/events.log`; pool state in
  `.run-with-it/main-state.json`.

### Patterns

- One append-only JSONL trail per Issue; nothing edited or deleted (I20.2).
- Every transition, lease, claim, budget delta, and gate action has exactly
  one Event-log entry (I20.1, S2). The log is the accounting and observability
  source; no separate metrics store in v1 (§21.3).

### Anti-patterns

- A second database for events. Foundry keeps the single writer and single
  trail (§23.1, §20.1). Parsec shows a single JSONL file is enough to drive
  pipelines and post-mortems.

---

## 8. Retries (§8.4, §10)

### Facts

- **luna** (`plans/005-retry-attempt-cap.md`): `max_attempts` default 5;
  exponential backoff `10_000 * 2^(attempt-1)` capped at
  `retry_backoff_ms` (lines 68-74). Two retry flavors: `RetryDelay::Continuation`
  (a normal multi-turn continuation, attempt reset, never capped) vs
  `RetryDelay::Backoff` (failure-class: failed / timed out / stalled).
  Non-failure re-schedules (busy scheduler, flaky tracker) must NOT consume
  the failure budget (lines 78-82, tests 217-227). Give-up is log-only —
  a dead-letter path, not a silent drop.
- **conductor-ai** (`conductor-core/src/retry.rs`): `RetryConfig` defaults
  `max_attempts: 3`, `initial_backoff: 1s`, `backoff_multiplier: 2.0`,
  `max_backoff: 30s` (lines 12-30). `is_retriable` classifies errors: transient
  → retry, permanent → fail immediately (lines 55-56, 84). `is_cancelled` is
  checked before each retry and during backoff sleep every 100 ms (lines 58,
  77).
- **legion_cc** (`engine.rs`): `iteration >= max_iterations` → `Error`
  terminal (lines 438-441); `retry_ticket` resets to `Queued`.
- **Maestro-AI**: failure vs contracted-stop budgets are separate —
  `MAX_SUB_COORD_RECOVERY_ATTEMPTS = 2` (failure) vs
  `MAX_SUB_COORD_COMPACTION_HANDOFFS = 6` (a compaction handoff is a
  contracted stop, not a failure). Requeue resets both counters
  (state.py lines 802-804).
- **foundry**: `DEFAULT_MAX_ATTEMPTS = 3`, capped by `FOUNDRY_MAX_ATTEMPTS`
  (§5.3); backoff reuses existing `retry.ts` (`nextRetryAt`/`backoffMs`);
  `failed → ready` only after `nextRetryAt` passes (§8.4). Leases: default
  `FOUNDRY_LEASE_MS` 30 min, renewal CAS, fencing by lease id (§10).
  Watchdog recovery is idempotent (§10.3).

### Patterns

- Separate continuation (not a failure) from failure retries; only failure
  consumes the budget (luna 005, Maestro). Foundry's `failed` is the only
  retryable failure state; `cancelled` and `succeeded` are terminal (I6.5).
- Bounded attempts + capped backoff + log-only give-up. No silent drops
  (§26).
- Classify transient vs permanent (conductor `is_retriable`); foundry's
  provider rate-limit markers do the same (§26).

### Anti-patterns

- Unbounded retry churn (luna 005 documents the original harm).
- Counting a non-failure wait (no free slot, tracker flake) against the
  failure budget (luna 005 tests 3-4).

---

## 9. Learning (§22)

### Facts

- **Lula** (`docs/architecture.md`): `SharedReflectionPool` — the planner
  queries a pool of similar past failures and injects lessons into the
  planning prompt, cross-iteration failure learning. Long-term memory is
  tripartite: semantic / episodic / procedural, SQLite FTS5 + WAL, sqlite-vec
  ANN. `GLEAN` is a pre/post tool-call invariant veto wired into the executor.
  pgvector backend available.
- **ruah** (`packages/core/src/core/`): no learning module exists. The core is
  workflow, workspace, state, reconcile, contract-validator, executor, git,
  integration(s), artifact, claims, config, planner, CLI. Its value to foundry
  is path claims (§12 analog), not learning.
- **foundry** (§22): on Task success or terminal failure, harvest lessons as
  structured rows (no markdown) keyed to the Issue, emitted as `task.lesson`
  events. Promotion to gate/lint/skill requires the pattern to recur ≥ 3 times
  across distinct Issues OR explicit operator promotion, plus operator approval
  (a `plan`-style Decision ticket). Nothing auto-installs; no agent promotes
  its own lesson. Anti-reward-hacking: learning runs after the Task is
  terminal; a lesson that would relax a gate or budget is rejected by default.
  Learning is observability and policy input, not a runtime controller in v1.

### Patterns

- Learn after the fact, keyed to the Issue, structured not prose (foundry
  design principles 1 and 8: Environment Over Documentation, Anti-Slop Is
  Engineering).
- Operator-approved promotion with a recurrence threshold; no agent promotes
  its own lesson (I22.1, I22.2).
- Feed past failures back into planning (Lula SharedReflectionPool) rather
  than into a runtime controller.

### Anti-patterns

- Auto-installing lessons, or letting a lesson relax a gate or budget
  (foundry rejects both by default, §22.3).
- Learning inside the Sandbox (I22.3): lessons never read or write a
  workspace.

---

## 10. Cloudflare Containers economics (§9.6, §27 Phase 4)

### Facts

- **foundry** (§9.6): `mac` and `vps` are the operator's existing hardware;
  the scheduler does not bill them. Cloudflare Containers and Box VMs are
  optional burst compute only, never assumed free VPS replacements. Enabling
  `box` requires (1) an operator Decision ticket with a per-run
  `burstCostCeilingUsd` and (2) the `cost` gate answered. Without both, the
  scheduler emits `defer:placement`. A burst Task's projected cost is charged
  against the run budget like any paid model; exceeding the ceiling stops the
  Task and parks for the human.
- **cfrunner** (README): ephemeral Cloudflare Containers runner for GitHub
  Actions. Private repositories only — visibility is checked before scheduling
  and again before JIT runner creation; unsupported repos get a failed
  "Cloudflare runner eligibility" Check (lines 21-25). Optional R2 bucket for
  dependency cache. Machine shapes (lines 32-39): 1/16 vCPU / 256 MiB / 2 GB
  up to 4 vCPU / 12 GiB / 20 GB; custom shape limits 1-4 vCPU, ≤ 12,288 MiB,
  ≤ 20,000 MB disk, ≥ 3,072 MiB per vCPU, ≤ 2 GB disk per GiB memory.
- **camelAI** (README): state (chat threads, files) lives in Durable Objects;
  only short-lived compute (build, notebook, SQL) goes to Cloudflare sandbox
  containers. This is the economic shape that works: persistent state off
  burst compute, burst only for the short-lived step.

### Patterns

- Keep the always-on workload off burst compute; burst only for short-lived,
  disposable steps (camelAI).
- Gate burst behind an explicit per-run cost ceiling + `cost` gate; budget
  exhaustion parks, never silently continues on a more expensive route
  (foundry §15.4, §9.6).

### Anti-patterns

- Treating Cloudflare Containers as free or as a VPS substitute. The smallest
  shape is 256 MiB / 2 GB; custom shapes are capped at 12,288 MiB / 20 GB.
  foundry keeps burst out of v1 entirely (§27 Phase 4).

---

## 11. Build-vs-reuse decision table

Each row: the foundry concern, the decision (build / reuse / defer), the
evidence, and the specific reuse point or model.

| Concern (spec §) | Decision | Evidence | Reuse / model |
|---|---|---|---|
| Worktree isolation (§11) | reuse + extend | foundry already has `data/worktrees/<id>`, `isSandboxedWorkDir`, `removeWorkDir` (§24.2 reuses by reference) | add per-task branch `foundry/<issueId>-<taskId>` (§18.3); model `base_commit` capture on legion `engine.rs:64,398`; conflict pre-check on parsec `simulator.rs:57-61` |
| DAG scheduling (§7-8) | build (pure scheduler) | nothing in-repo is a pure scheduler; legion/maestro are the models | legion `is_ready` checkpoint gate (engine.rs:351-361); foundry keeps scheduler pure (I8.1), deferral ledger (I8.2), CAS leases (I8.3) |
| Resource controls (§9.4) | build | host registry is foundry-specific; cfrunner shapes validate the shape of budgets | `ResourceBudget {cpu, memoryMiB, diskMiB, concurrency}` (§5.2); VPS reserve (§9.3); atomic reservation-with-lease (§9.4) |
| Host placement (§9.5) | build (rule in scheduler) | placement is a pure rule with `defer:placement` | mac=visual/UI, vps=text, box=burst-off-by-default (§9.5); single writer on VPS (§23.1) |
| PR sizing (§18) | build (defer + gate) | foundry gates are the enforcement; parsec shows the stack alternative | ≤400 lines / ≤20 files; `defer:pr_size`; `phase`/`evidence` gates; no auto-merge (§18, S8) |
| Visual verification (§16) | build (mac host + vision routing) | vision must not fall back to text (§14.1 rule 2); Lula snapshots.rs exists as a sandbox snapshot precedent | `VerifyContract` five fields (§16.2); verification tiers contract/static/exec (§16.3) |
| Event log (§20) | reuse (existing `appendEvent`) | foundry already has the JSONL log; parsec execlog confirms the shape | `data/logs/<issueId>.jsonl`; add new kinds (§20.2); `redactSecrets` at write (§25.3); no second trail (I20.1) |
| Retries (§8.4, §10) | reuse (existing `retry.ts`) | foundry already has backoff; luna/conductor confirm the cap+classify pattern | `DEFAULT_MAX_ATTEMPTS = 3`; continuation ≠ failure (luna 005); transient/permanent classify (conductor retry.rs:55-56) |
| Learning (§22) | build (Phase 3) | no in-repo learning; Lula SharedReflectionPool is the model | structured lessons keyed to Issue; promote ≥3 recurrences + operator approval; nothing auto-installs (§22) |
| Cloudflare Containers economics (§9.6) | defer (Phase 4) | burst is out of v1 (§27); cfrunner/camelAI give the shape when it lands | Decision ticket + `burstCostCeilingUsd` + `cost` gate; burst never assumed free (§9.6, §27) |

---

## 12. Rejected and unverified claims

| Claim | Verdict | Why |
|---|---|---|
| "Ox Alpha video capability" | rejected | No primary source found in reach. The only video handling in the target is foundry's own vision-only routing rule (§14.1 rule 2), which does not depend on Ox. |
| "unlimited tokens" (context or budget) | rejected | Every budget in foundry is finite: task/run/issue/run-mode ceilings (§15.1), soft stop at 90%, hard stop at 100% (§15.3). Nothing in the researched repos supports an unlimited-token assumption. |
| Cloudflare Containers as a free VPS replacement | rejected | cfrunner shapes are small (256 MiB up to 12,288 MiB) and billed; foundry §9.6 and §27 Phase 4 explicitly forbid the assumption. |

## 13. Sources

Primary (read from source):

- https://github.com/kartikkabadi/foundry — `docs/specs/multi-agent-system.md`; `DELEGATION.md`; `CONTEXT.md`; `PLAN.md`; `docs/design-principles.md`; `docs/design-system.md`; `docs/inspiration/*`; `docs/specs/oneshot-v2-minimal-v1-runtime-spec.md`
- https://github.com/chanakya-net/Maestro-AI — `technical_requirements.md`; `assets/run-with-it-state.py`; `assets/run-with-it-router.py`; `assets/run-with-it-pool.sh`
- https://github.com/rainyulei/legion_cc — `crates/legion-core/src/orchestrate/engine.rs`; `api.rs`; README; CHANGELOG
- https://github.com/gabrielkoerich/orch — `docs/architecture.md`; `src/engine/auto_merge.rs`
- https://github.com/christianmeurer/Lula — `docs/architecture.md`; repo layout (rs/runner, py/, schemas/, prompts/)
- https://github.com/devinrosen/conductor-ai — `conductor-core/src/retry.rs`; `conductor-core/src/workflow/gate_types.rs`; `conductor-core/src/workflow/estimation.rs`; `conductor-core/src/workflow/`; `docs/workflow/engine.md`
- https://github.com/AkaraChen/luna — `crates/luna/src/{job,workflow,orchestrator}.rs`; `plans/005-retry-attempt-cap.md`; `plans/006-dependency-hardening-batch.md`; `crates/asahi/`
- https://github.com/erishforg/git-parsec — `src/execlog.rs`; `src/conflict/simulator.rs`; `src/cli/mod.rs`; `src/cli/commands/{diff,ship,history,workspace}.rs`; docs (stack submit, `parsec log --export`)
- https://github.com/levi-tc/ruah — `packages/core/src/core/claims.ts`; `packages/core/src/core/{reconcile,contract-validator,state-migrations,workflow}.ts`
- https://github.com/biw/cloudflare-github-actions-runner — `README.md`
- https://github.com/qaml-ai/camelAI — `README.md`; repo layout (workers/, sandbox/)

Starred-repo sweep (kartikkabadi stars) that fed this doc:
`biw/cloudflare-github-actions-runner`, `qaml-ai/camelAI` (as `/tmp/librarian-camelai`),
`browser-use/macos-harness`, `deepseek-ai/deepseek-harness`, `owainlewis/neo`,
`ReviewStage/luke`, `AnicetNgrt/hpc-sandbox-benchmarks`, `wafer-ai/gpu-perf-engineering-resources`.

Research clones were kept under `/tmp/librarian-*` during the unit and removed
after; no files outside `docs/research/multi-agent-sources.md` were touched.
