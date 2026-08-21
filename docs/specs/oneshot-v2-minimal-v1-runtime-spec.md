# Oneshot v2 — Minimal v1 Runtime Spec (Foundry)

**Status:** Spec contract (locked for implementation). \
**This Issue delivers:** the spec contract only. \
**Stage scope:** execute stage of this Issue writes **no application code**
(acceptance #30). The Decision ticket at
`docs/specs/decisions/2026-08-oneshot-v2-grill-autoresolve.md` is filed with
this contract and is a hard prerequisite to any implementation Issue.

---

## 0. One-sentence contract

Give one Foundry Issue a bounded objective (its brief), a token budget, and a
verify command. The oneshot Walk pursues it across turns. The goal record
survives crashes. It may only mark the goal complete when a sandboxed runtime
has run every `VERIFY.md` command and all exited zero.

In this Issue, `complete` is **unreachable**. The verify-exec path is gated
behind a separate Sandbox Issue. This Issue ships the sandbox-independent runtime
contract only.

---

## 1. Scope

This contract defines the minimal Codex-shaped delta on Foundry's existing
oneshot mode. It is the v2 runtime **without** the worker/verifier/threads
machinery.

### Ships now (in the implementation Issue that follows this contract)

- Goal record with status machine and stale `goal_id` rejection.
- Budget accounting with soft stop, recorded to the existing Event log.
- Wall-clock cap, elapsed since the goal becomes active.
- `PROGRESS.md`, runtime-derived, under `data/`.
- Interview gate as an internal pre-active check.
- Active steering injection (budget, status, write-scope).
- Replace-in-place under the v1 lock, behind a feature switch.

### Deferred to a later Issue (the full v2)

- Orchestrator / worker / verifier role split.
- Threads, episodes, weaving.
- DAG batch dispatch.
- Structured requirements and `feature_list.json`.
- Evidence ledger.
- Blocked-audit 3-turn counter.
- `usage_limited` provider-quota detection.
- Crash-resilient auto resume-on-boot.
- Rich model-authored episode/progress prose.

### Gated behind a separate Sandbox Issue (hard prerequisite)

- The runtime-run `VERIFY.md` exec path.
- The `complete` transition.

> Do not build the worker/verify exec loop against a no-sandbox state. Unsafe
> worker mutation and a verifier flipping `passes` flags without isolation is an
> untrusted execution path.

---

## 2. Prerequisite and dependency

The Docker Sandbox is not built (CONTEXT.md: "Docker sandboxes are not in this
slice yet"). This contract does not build it. A separate Sandbox Issue must land
first before any worker or verifier can exec safely.

This Issue ships only sandbox-independent runtime. The verify-exec path and
`complete` are declared in this contract but **inert** until the Sandbox Issue
closes.

---

## 3. v1 lock handling

Foundry's v1 decisions are locked by issue #1 (see `README.md`, `PLAN.md`,
`GATES.md`). This contract evolves the existing oneshot **behind the lock**. The
current oneshot keeps working until v2 is verified.

One conflict required a Decision ticket before any code: v1 oneshot auto-resolves
grill Decision tickets using the worker's recommendation (`autoAnswerGrillTickets`
in `lib/foundry/oneshot.ts`). v2's permission split forbids the model from
changing goal status. The resolution is filed at
`docs/specs/decisions/2026-08-oneshot-v2-grill-autoresolve.md`: **grill
auto-resolve is preserved as a low-risk gate that answers Decision tickets, not a
goal-status write.** Resolving a grill ticket answers a Decision ticket
(`decision_tickets.answer`); it never writes `goals.status`.

The interview gate is an **internal runtime check**, not a new Walk stage. Adding
a stage would reopen the v1 lock (`STAGES` in `lib/foundry/types.ts` is
unchanged). No new stage is added here.

---

## 4. Single scheduler

The serial Walk/scheduler stays the single driver. `runOneshotWalk` →
`tickOneshot` → `tickStage` in `lib/foundry/oneshot.ts` is the one loop. The v2
goal accounting and soft stop fold into this loop's turn boundaries (turn start,
turn finish, gate-enter re-check). **No second scheduler competes for the same
Issue. No separate `MaybeContinueIfIdle` loop fires turns on its own.**

---

## 5. Integration points

- The v2 loop evolves `lib/foundry/oneshot.ts` in place, behind a feature switch.
- Operator controls extend `app/issues/[id]/oneshot-controls.tsx`.
- Server actions extend `app/actions.ts`.
- Goal storage extends the existing `lib/foundry/store.ts` SQLite layer under
  `data/` (via `lib/foundry/paths.ts`: `dataDir()` → `FOUNDRY_DATA ?? <cwd>/data`;
  `dbPath()` → `data/foundry.sqlite`).
- Goal-lifecycle events and token deltas are recorded to the existing append-only
  Event log (`lib/foundry/log.ts`: `appendEvent(issueId, kind, payload, actor)` →
  `data/logs/<issueId>.jsonl`).
- No new oneshot CLI binary. The control plane is the dashboard plus server
  actions.

---

## 6. Storage

All goal data lives in Foundry's existing SQLite store under `data/`, via
`store.ts`. No Foundry data lives in the sandbox checkout.

Reuse Foundry's existing SQLite driver: `DatabaseSync` from `node:sqlite`
(`store.ts` line 2). **Do not add `better-sqlite3`. No second database.** The
`goals` table is created through the existing `database()` → `SCHEMA`/`migrate()`
path (`CREATE TABLE IF NOT EXISTS` + `ensureColumn`), exactly like the other
v1.2 tables.

### Tables created in v1

- `goals` only.

### Tables NOT created in v1 (no empty schema-forward tables)

- `episodes`, `requirements`, `blocked_audit`. Empties invite implicit coupling
  and contradict the deferral. They arrive with their owning v2 role.

### Goal-lifecycle events fold into the existing append-only Event log

as new `goal.*` kinds. **No separate `goal_events` table.** Token-accounting
deltas also go to the existing Event log. **One audit trail. No second
accounting path.**

### `goals` table data contract

```sql
CREATE TABLE IF NOT EXISTS goals (
  goal_id             TEXT PRIMARY KEY,        -- optimistic-concurrency token
  issue_id            TEXT NOT NULL,           -- the Foundry Issue
  objective           TEXT NOT NULL,           -- derived from brief + interview inputs
  status              TEXT NOT NULL CHECK (status IN
                        ('active','paused','blocked',
                         'budget_limited','usage_limited','complete')),
  token_budget        INTEGER,
  tokens_used         INTEGER NOT NULL DEFAULT 0,
  time_used_seconds   INTEGER NOT NULL DEFAULT 0,
  wall_deadline_ts    INTEGER,
  created_at_ms       INTEGER NOT NULL,
  updated_at_ms       INTEGER NOT NULL,
  -- interview-gate inputs (all required before active):
  write_scope         TEXT,
  verify_command      TEXT,
  measurable_artifact TEXT,
  stop_condition      TEXT,
  pause_condition     TEXT,
  objective_version   INTEGER NOT NULL DEFAULT 1
);
```

### Event-log kinds added (all via `appendEvent`, keyed by `goal_id` + `issue_id`)

- `goal.status_change` — `{ goal_id, issue_id, from, to, actor }`
- `goal.budget_delta` — `{ goal_id, issue_id, delta, tokens_used, token_budget }`
- `goal.soft_stop` — `{ goal_id, issue_id, reason, tokens_used, gate }`
- `goal.interview_pass` — `{ goal_id, issue_id, items }`
- `goal.budget_raised` — `{ goal_id, issue_id, old_budget, new_budget }`
- `goal.objective_edit` — `{ goal_id, issue_id, old_goal_id, new_goal_id, objective_version }`

The actor field reuses `EventActor` (`{ source: "system" | "operator"; reason? }`).

---

## 7. Goal record and status machine

Status values declared in the `goals.status` CHECK constraint
(forward-compatible): `active`, `paused`, `blocked`, `budget_limited`,
`usage_limited`, `complete`.

### LIVE and transitionable in v1

`active`, `paused`, `budget_limited`.

### Declared but with NO live transition in v1

- `blocked` — needs the deferred 3-turn counter.
- `complete` — needs the deferred verify-exec/Sandbox.
- `usage_limited` — deferred; provider-quota errors stop the Walk with the goal
  row surviving and a human resume.

### Live v1 transitions

| Transition | Who |
|---|---|
| `active` ↔ `paused` | human, or runtime on interrupt |
| `active` → `budget_limited` | runtime soft stop |
| `budget_limited` → `active` | human (raise budget + resume) |

`complete` and `blocked` are declared only; no code path may write them in v1.

---

## 8. Stale goal_id and optimistic concurrency

Every goal update carries the expected `goal_id`. If it does not match the current
row, the update is **stale and rejected** (compare-and-set on `goal_id`). This
protects dashboard writes and runtime writes to the same row from racing; no
status flip is lost.

Replacing the objective allocates a **new `goal_id`** and bumps
`objective_version`. The old `goal_id` is recorded in the `goal.objective_edit`
event so the audit trail is continuous.

---

## 9. Interview gate

The interview gate is an **internal runtime pre-active check**. It refuses to
transition the goal to `active` until five items are present.

### Five items (columns on `goals`)

1. `measurable_artifact` — a measurable artifact.
2. `verify_command` — a verify command (this becomes `VERIFY.md` when exec turns
   on).
3. `write_scope` — a write scope (paths + branch).
4. `stop_condition` — a stop condition.
5. `pause_condition` — a pause condition (e.g. N identical failures, paid action,
   missing credential).

Items come from **explicit operator input** via the oneshot dashboard controls.
The gate does **not** parse the brief. The brief is context, not a structured
input.

If any item is missing, the gate **fails closed**. It surfaces the missing items
in the existing oneshot controls (`oneshot-controls.tsx`). This is a hard-stop for
the human: the goal cannot go `active` until the operator supplies all five.

This is an internal runtime check, **not a new Walk stage**. `STAGES` is
unchanged; no stage is added.

---

## 10. Objective

The goal objective is the **existing Issue brief** (`research_brief` artifact,
parsed via `parseResearchBrief`). No separately authored `GOAL.md` objective is
required.

`GOAL.md` is a **derived Foundry-data artifact under `data/`**. It composes the
brief objective plus the interview-gate inputs. If the brief is too broad for
autonomous pursuit, the operator tightens it via the edit-objective control
(which allocates a new `goal_id` and bumps `objective_version`, per §8).

One objective source. No divergence between the brief and the goal.

---

## 11. Budget accounting

The goal's `tokens_used` is accumulated from **eve's existing Event-log token
counts** (CONTEXT.md: the Event log records "every stage enter, worker tool call,
token count, and gate action"). This is the single source of truth.

Accounting is **approximate**. There is no cached/non-cached split (the v2
formula's `non_cached_input + output_tokens` is not exposed by eve today). The
soft stop may be imprecise. **This is documented, not a release blocker.** Do not
block the soft stop on a new eve capability.

Every accounting delta is recorded to the Event log as `goal.budget_delta`. **No
second accounting path.**

A wall-clock cap is paired with the token budget. Wall-clock is **elapsed since
the goal became `active`** (not since creation/intake). A `wall_deadline_ts` may
be stored; the runtime computes elapsed against `time_used_seconds` accumulated
while active.

A max-episode cap is **deferred** (episodes are deferred).

---

## 12. Accounting scope

`tokens_used` and `time_used_seconds` accumulate from the turn the goal becomes
`active` (interview gate passed → `goal.interview_pass` event). They do **not**
accumulate from intake. Pre-active stages (`intake`, `research`, `grill`, `spec`)
are HITL and must not burn the autonomous budget.

---

## 13. Soft stop behavior

The soft-stop check fires at **turn finish**. It re-checks at **gate-enter** as a
guard.

When it trips (token budget crossed **or** wall-clock cap crossed), the runtime:

1. Sets `status` to `budget_limited` and emits `goal.soft_stop`
   `{ reason, tokens_used, gate }`.
2. **Parks the Walk at the current gate.** It does **not** advance to the next
   gate. It does **not** silently finish the current gate first.
3. Injects wrap-up steering (remaining context + soft-stop wrap-up).
4. Stops starting new substantive work.

The Walk stays parked until the human raises the budget (`goal.budget_raised`)
and resumes (`budget_limited` → `active`).

**Budget exhaustion is never completion.** The model cannot mark the goal
`complete` because budget ran out. `complete` is unreachable in v1 anyway (§2).

A budget reminder is injected at a configurable interval (default 10% of
`token_budget`) while `active`, via the steering fragment (§15).

---

## 14. PROGRESS.md

`PROGRESS.md` is **Foundry data**. It lives under `data/`. It is **never** in the
sandbox checkout. It is **never** committed to the target repo.

The runtime derives each entry. It appends from the turn's Event-log records and
the committed git diff (the execute/worktree diff path that `lib/foundry/execute.ts`
already produces via `getDiff`). **No model-authored prose is written into Foundry
data.**

A v1 entry contains: status, budget (`tokens_used / token_budget`,
`time_used_seconds`), files touched, commands run, exit codes, and the inferred
next gate.

Rich model-authored episode/progress prose is a v2 capability; it ships with the
worker role.

`PROGRESS.md` is a **deterministic projection** of the Event log plus git. It is
not a second source of truth.

---

## 15. Active steering

The runtime injects a goal-context fragment into each continuation turn (a
user-role fragment, not a system-prompt promotion).

### Injected now

- Remaining budget (`tokens_used / token_budget`, `time_used_seconds` / wall cap).
- Current goal status.
- The interview-gate write-scope constraint (`write_scope`).
- The budget reminder, and the soft-stop wrap-up when `budget_limited`.

The objective (the brief) is **already in context** as the Issue's research brief.
It is **not duplicated** in the injection.

Goal/progress context reaches the agent via **injection only**. It does **not**
reach the agent via Foundry-data files rendered into the sandbox checkout.
Rendering `GOAL.md`/`PROGRESS.md` into the sandbox is **deferred** to the v2
worker role.

The full `continuation.md` completion-audit rules are **deferred** to the
Sandbox+verifier Issue. They are inert while `complete` is unreachable.

**The objective is user data. It is never promoted to a system instruction.**

---

## 16. Permission split

The permission split is narrowed to **goal-status writes** (`goals.status`).

### Model may request (accepted only under the rules)

- `complete` — needs the verifier pass (unreachable in v1).
- `blocked` — needs the 3-turn counter (unreachable in v1).

In v1 both are unreachable.

### Model may NOT write

- `paused`, `budget_limited`, `usage_limited`, or `clear`. **Only the runtime and
  the human own those.**

### Grill auto-resolve is NOT a goal-status write

Per the filed Decision ticket
(`docs/specs/decisions/2026-08-oneshot-v2-grill-autoresolve.md`), grill auto-resolve
is **excluded** from the permission split. The oneshot keeps auto-resolving grill
with the worker's recommendation, consistent with v1. Answering a grill Decision
ticket writes `decision_tickets.answer`, never `goals.status`.

---

## 17. Control plane

The control plane is the **existing oneshot dashboard controls and server
actions**, extended. No new oneshot CLI binary.

### Controls live in v1

- **start** — intake to oneshot + interview-gate inputs (the five items).
- **status** — oneshot status panel (goal status, budget, `PROGRESS.md` view).
- **pause / resume** — `active` ↔ `paused` (extends `setWalkHold` /
  `pauseOneshotAction` / `resumeOneshotAction`).
- **edit objective** — allocates new `goal_id`, bumps `objective_version`
  (§8).
- **raise budget** — `budget_limited` → `active` after a budget raise.

### Control gated behind Sandbox

- **verify** — runs `VERIFY.md` commands. Inert/unreachable in v1.

---

## 18. Crash resilience

v1 does **not** ship crash-resilient continuation. The existing
"keeps-walking-after-the-HTTP-request" mechanism (`runOneshotWalk` driven by
server actions / `kickOneshot`) continues to drive the Walk.

The goal record, status, and `tokens_used` are persisted to `store.ts`
(`data/foundry.sqlite`, WAL mode). **If the process dies, the goal row survives.**
A human can resume from the dashboard.

Full automatic resume-on-boot (snapshot + usage replay + auto-continuation) is
**deferred** to a later Issue.

The v1 contract is explicit: **the goal row survives a crash; the loop does not
auto-resume.** Closing the "sessions can die" gap is a **tracked follow-on**, not
a silently omitted feature.

---

## 19. Models

**One model only: GLM 5.2 via Blackbox** (`agent/instructions.md`,
`agent/agent.ts`: `model: "zai/glm-5.2"`). **Fast must not be used.**

Role-specific models (`planner-strong`, `coder-grind`, `skeptical-reviewer`) are
**not in scope**. The oneshot Walk agent is the only model in the loop.
Role-biased prompts are a v2 concern with the role split. **No multi-model
routing is introduced in v1.**

---

## 20. Gate policy

### Hard-stop for the human

- **Interview gate** — no `active` until five items present (§9).
- **`budget_limited`** — raise budget is human (§13).
- **`complete`** — verifier pass only; unreachable in v1 (§2).

### Auto-resolve (low-risk, consistent with v1 oneshot policy)

- **Grill Decision tickets** — worker recommendation accepted; **not a status
  write** (§16, Decision ticket).

### Provider-quota errors

The Walk stops, the goal row survives, a human resumes. **No `usage_limited`
transition is added in v1.**

---

## 21. Artifact ownership

### Product artifacts (about the target repo) — may live in the repo working tree

- `VERIFY.md` — the verify command. **Exec is gated behind the Sandbox.** In v1
  it is stored with the goal/interview inputs and is inert.

### Foundry data (under `data/`, never in the sandbox checkout, never committed to the target repo)

- `GOAL.md` — derived: brief + interview inputs (§10).
- `PROGRESS.md` — runtime-derived (§14).

In v1, `GOAL.md` and `PROGRESS.md` are **not rendered into the sandbox**. The v2
worker role introduces sandbox rendering.

### Arrives together in the v2 verifier/structured-requirements Issue

- `feature_list.json`, the evidence ledger, and the `requirements` table.

### No Foundry data in the Docker sandbox

`GOAL.md`, `PROGRESS.md`, the goal row, accounting, and any future threads/
episodes/evidence live under `data/`. The sandbox checkout (a Docker clone of
the target repo, per CONTEXT.md "Sandbox") receives only product artifacts.
**No Foundry data is written into the Docker sandbox.**

---

## 22. Known limitations (tracked follow-ons)

- Accounting is approximate until a cached/non-cached split is exposed by eve.
- `complete` is unreachable until the Sandbox Issue lands.
- The loop does not auto-resume after a crash (§18).
- One model fills all roles; planner/grind/judge quality may be uneven until
  multi-model routing is approved.
- `complete` produces a verified state, **not** a PR or merge. No merge path in
  this Issue (the oneshot stops before merge, `ONESHOT_MERGE_STOP`).
- `blocked` and `usage_limited` are declared for forward-compat only; no live
  transition in v1.

---

## 23. Acceptance criteria — this Issue (spec contract only)

This Issue delivers the **spec contract only**. The table below maps each
acceptance criterion to where it is fixed in this contract. The behavioral
criteria (#3–#29) describe what the **implementation Issue** must satisfy; this
Issue satisfies them by locking the contract, not by writing application code
(#30).

| # | Criterion | Where fixed in this contract |
|---|---|---|
| 1 | Decision ticket reconciling grill auto-resolve with v2 permission split, filed before code | Filed: `docs/specs/decisions/2026-08-oneshot-v2-grill-autoresolve.md`; §3, §16 |
| 2 | Current oneshot works unchanged behind v1 lock until v2 verified (replace-in-place, feature-gated, no regression) | §1, §3, §5 (feature switch on `oneshot.ts`; this Issue adds no application code, so the existing path is untouched) |
| 3 | `goals` table added to `store.ts` SQLite under `data/`; no `better-sqlite3`; no second database | §6 (node:sqlite `DatabaseSync`; `data/foundry.sqlite`) |
| 4 | No `episodes`, `requirements`, or `blocked_audit` tables (no empty schema-forward tables) | §6 "Tables NOT created in v1" |
| 5 | Goal-lifecycle events as new `goal.*` kinds in existing Event log; no `goal_events` table; no second accounting path | §6 event kinds; §11 |
| 6 | `goals.status` CHECK declares all six values; only `active`, `paused`, `budget_limited` live in v1 | §7 |
| 7 | `blocked`, `complete`, `usage_limited` have no live transition in v1 | §7 |
| 8 | Stale `goal_id` rejected; replacing objective allocates new `goal_id` + bumps `objective_version` | §8 |
| 9 | Interview gate refuses `active` until 5 items supplied via controls; missing items surfaced | §9 |
| 10 | Interview gate is an internal runtime check, not a new Walk stage | §3, §9 (`STAGES` unchanged) |
| 11 | Objective = existing Issue brief; `GOAL.md` derived under `data/`; one objective source | §10 |
| 12 | `tokens_used`/`time_used_seconds` accumulate only from `active`, not intake | §12 |
| 13 | `tokens_used` from eve Event-log counts; every delta to Event log; approximate caveat documented | §11 |
| 14 | Wall-clock cap (elapsed since active) with same soft-stop + human-resume behavior | §11, §13 |
| 15 | Soft stop parks at current gate in `budget_limited`; does not advance; does not silently finish current gate | §13 |
| 16 | Budget exhaustion does not mark complete | §13, §16 |
| 17 | Model cannot write `paused`/`budget_limited`/`usage_limited`/`clear`; only runtime + human | §16 |
| 18 | Grill Decision tickets still auto-resolved with worker recommendation; documented as not a status write | §16; Decision ticket |
| 19 | `PROGRESS.md` runtime-derived from Event log + committed git diff, under `data/`; no model-authored prose | §14 |
| 20 | No Foundry data (`GOAL.md`, `PROGRESS.md`) rendered into/persisted in sandbox in v1 | §14, §15, §21 |
| 21 | Runtime injects remaining budget, current status, write-scope into each continuation turn; objective not duplicated | §15 |
| 22 | Objective treated as user data; never promoted to system instruction | §15 |
| 23 | Serial Walk/scheduler remains single driver; no second scheduler / autonomous `MaybeContinueIfIdle` | §4 |
| 24 | `VERIFY.md` exec path and `complete` inert/unreachable in v1, gated behind Sandbox | §2, §7, §17, §21 |
| 25 | On crash, goal row survives in `store.ts`; loop does not auto-resume; human can resume; documented follow-on | §18 |
| 26 | Provider-quota errors stop Walk, goal row survives, human resume; no `usage_limited` in v1 | §20 |
| 27 | Control plane = existing dashboard controls/server actions extended; no CLI; verify gated behind Sandbox | §17 |
| 28 | Only GLM 5.2 via Blackbox; no Fast; no multi-model routing | §19 |
| 29 | No Foundry data written into Docker sandbox | §21 |
| 30 | No application code in this stage; this Issue delivers the spec contract only | This document is the deliverable. No `.ts`/`.tsx` runtime code is written in this Issue. |

---

## 24. Implementation Issue gate (for the follow-on that writes code)

When the implementation Issue opens, it must, at minimum, clear this checklist
before merge — all behind the feature switch, with the existing oneshot path
unchanged when the switch is off:

- [ ] `goals` table created via `store.ts` `SCHEMA`/`migrate()`; `node:sqlite`
      only; no `better-sqlite3`.
- [ ] No `episodes`/`requirements`/`blocked_audit` tables.
- [ ] `goal.*` event kinds emitted via `appendEvent`; no `goal_events` table.
- [ ] Status CHECK has all six; only `active`/`paused`/`budget_limited`
      transitionable; `blocked`/`complete`/`usage_limited` have no live write.
- [ ] Compare-and-set on `goal_id`; objective edit allocates new `goal_id` and
      bumps `objective_version`.
- [ ] Interview gate fails closed until all five items present; surfaced in
      `oneshot-controls.tsx`; not a new stage.
- [ ] `tokens_used`/`time_used_seconds` accrue only from `active`; deltas to
      Event log; approximate caveat in code comment + this contract.
- [ ] Wall-clock cap enforced with the same soft-stop + human-resume as tokens.
- [ ] Soft stop parks at the current gate; no advance; no silent finish; never
      marks `complete`.
- [ ] Model cannot write `paused`/`budget_limited`/`usage_limited`/`clear`;
      grill auto-resolve preserved (Decision ticket).
- [ ] `PROGRESS.md` projected from Event log + git diff under `data/`; no model
      prose; not in sandbox.
- [ ] Steering injects budget/status/write-scope; objective not duplicated;
      objective never a system instruction.
- [ ] Single scheduler; no autonomous `MaybeContinueIfIdle` loop.
- [ ] `complete` and `VERIFY.md` exec remain inert until the Sandbox Issue.
- [ ] Crash: goal row survives; no auto-resume; documented follow-on.
- [ ] Provider-quota stops the Walk; goal row survives; no `usage_limited`.
- [ ] Controls extend `oneshot-controls.tsx`/`actions.ts`; no CLI; verify gated.
- [ ] GLM 5.2 via Blackbox only; no Fast; no multi-model routing.
- [ ] No Foundry data in the Docker sandbox.
- [ ] The runtime tests required by the v2 design (stale `goal_id` rejected;
      model cannot write `paused`/`budget_limited`; budget crossing injects
      wrap-up and stops new work; budget crossing does not mark complete;
      human input preempts continuation; verifier required for complete;
      etc.) pass, scoped to the v1 subset.
