# V4-1 Parallel Build (Issue #31) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the issue-plan DAG has independent branches, run up to N issue workers in parallel (git worktrees), with path-conflict detection and serial fallback when branches would touch the same files.

**Architecture:** Extend `packages/planner/src/build/orchestrate.ts` (today serial via `nextPendingIssue` + `topologicalOrder`) with a **wave scheduler**: each wave = issues whose `blocked_by` are satisfied and that are mutually independent by predicted path overlap. Reuse `executeIssueWorker` + `packages/adapters/worktree.ts`; cap concurrency (default 3). CLI flag `foundry build --parallel N` threads through build command → `ExecuteBuildOptions`.

**Tech Stack:** TypeScript, Node test runner, existing `issue-plan-graph.ts`, worktree adapter, `FoundryAgentClient` / mock via `FOUNDRY_BUILD_MOCK`.

**Gate:** G4 live evidence is logged (2026-05-24). **Do not start implementation** until Kartik checks production-truth on [G4 log](../specs/2026-05-26-live-verification-log.md). This document is plan-only (no V4 code in G4 slice).

**Spec:** [V2-V5_GITHUB_ISSUES.md](../../planning/V2-V5_GITHUB_ISSUES.md) — V4-1 / [#31](https://github.com/kartikkabadi/foundry/issues/31).

---

## Task 0 — DAG + resume + run-store (GREEN before V4-1 code)

**Blocks:** All V4-1 implementation tasks below. Post-alignment PR2 adds `resolvePreflightOptions`; this task fixes orchestration correctness PR #98 deferred.

### 0.1 `nextPendingIssue` must respect `blocked_by`

**Problem:** [`orchestrate.ts`](../../packages/planner/src/build/orchestrate.ts) `nextPendingIssue` returns the first `pending` issue in topological order but does **not** check that all `blocked_by` deps are `complete` (or deferred). Parallel waves would amplify wrong ordering.

**Acceptance:**
- [ ] Unit test: plan with Issue 2 blocked by #1 does not run #2 until #1 is `complete`.
- [ ] `nextPendingIssue` skips pending issues whose `blocked_by` references are not satisfied in `build.issues`.

### 0.2 Resume hardening

**Problem:** `resumeBuildFromCheckpoint` calls `executeBuild` which re-runs preflight and may re-orchestrate from scratch without preserving completed issue state consistently (thermo waive from PR #98).

**Acceptance:**
- [ ] Resume from `paused` / `running` with partial `build.issues` does not re-execute completed issues.
- [ ] Test in `tests/build-preflight.test.ts` or new `tests/build-resume.test.ts`: mid-build pause → resume continues at next pending issue only.
- [ ] Document resume contract in `RUNNING_SPEC.md` (one paragraph).

### 0.3 Run-store split (optional if file >1k lines)

**Problem:** [`run-store.ts`](../../packages/core/src/state/run-store.ts) mixes read, write, and status helpers; parallel build adds concurrency-sensitive writes.

**Acceptance (pick one):**
- [ ] Split into `run-store-read.ts` / `run-store-write.ts` with re-exports, **or**
- [x] **Deferred (Task 0 PR):** ~466 LOC &lt; 1k; parallel executor must use `writeRunState` only. **Phase 4a** run-store split required before V4-1 if still deferred.

**Checkpoint (Task 0 GREEN):**

```bash
npm test   # includes new blocked_by + resume tests
```

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/planner/src/build/issue-plan-graph.ts` | DAG parse + `topologicalOrder` (existing) |
| `packages/planner/src/build/parallel-schedule.ts` | **New** — waves, independence, path overlap heuristic |
| `packages/planner/src/build/orchestrate.ts` | Serial loop → wave executor when `parallel > 1` |
| `packages/planner/src/build/worker.ts` | Per-issue worktree + agent (unchanged surface) |
| `packages/adapters/src/worktree.ts` | create/remove worktrees (existing) |
| `packages/cli/src/commands/build.ts` | `--parallel N` flag |
| `tests/build-parallel.test.ts` | **New** — RED first |

---

### Task 1: Failing tests — independence vs conflict

**Files:**
- Create: `tests/build-parallel.test.ts`

- [ ] **Step 1.1: Export pure scheduler API**

Add `computeBuildWaves(nodes: IssuePlanNode[], opts?: { maxParallel?: number }): number[][]` in `parallel-schedule.ts` (numbers = issue # per wave). No I/O.

- [ ] **Step 1.2: RED — two independent issues, one wave**

Fixture `issue-plan.md` body with two issues, no `Blocked by` lines, disjoint implied paths (e.g. Type: code, titles hint `src/a.ts` vs `src/b.ts` — or explicit `Paths:` line if we add parser field in V4-1 minimal form).

```bash
cd /Users/user/Documents/Projects/foundry && npm test -- tests/build-parallel.test.ts
```

Expected: FAIL — module or function missing.

- [ ] **Step 1.3: RED — shared path forces serial waves**

Two issues both targeting `src/shared.ts` → wave 1 has one issue, wave 2 the other (order preserved by topological tie-break).

- [ ] **Step 1.4: RED — integration with mock build**

Use `FOUNDRY_BUILD_MOCK=1`, inject `BuildDeps` with spy counting concurrent `runAgent` calls; `executeBuild({ parallel: 2 })` on 2-issue plan → max concurrency 2, then review pause behavior unchanged.

---

### Task 2: Wave scheduler (GREEN)

**Files:**
- Create: `packages/planner/src/build/parallel-schedule.ts`
- Modify: `packages/planner/src/build/issue-plan-graph.ts` (optional: export helper to list deps satisfied)

- [ ] **Step 2.1: Implement `computeBuildWaves`**

Rules (V4-1 minimal):
1. Start from `topologicalOrder(nodes)`.
2. Greedily pack next pending issues into current wave if: (a) all `blocked_by` completed, (b) no path overlap with any issue already in wave, (c) wave size ≤ `maxParallel` (default 3).
3. Path overlap: parse optional `Paths:` line from issue body; if absent, conservative default = whole repo root (forces serial) OR `Type: docs` → docs-only glob — **document choice in code comment**; prefer conservative serial default for v4-1 safety.

- [ ] **Step 2.2: Run unit tests**

```bash
npm test -- tests/build-parallel.test.ts
```

Expected: scheduler tests GREEN.

---

### Task 3: Orchestrator integration

**Files:**
- Modify: `packages/planner/src/build/orchestrate.ts`
- Modify: `packages/core/src/types/build.ts` (if `ExecuteBuildOptions` needs `parallel?: number`)

- [ ] **Step 3.1: Add `parallel` to `ExecuteBuildOptions`**

Default `1` (current behavior).

- [ ] **Step 3.2: Wave execution loop**

For each wave, `Promise.all` over `executeIssueWorker` calls with distinct worktrees; await all before next wave. On any worker failure, pause run + record event (match serial semantics).

- [ ] **Step 3.3: Preserve HITL review**

After all issues attempted, if `review_status === 'pending'` → final phase `build_review` (existing honest-build behavior).

- [ ] **Step 3.4: Run full test suite**

```bash
npm test
```

Expected: 140+ pass, no regression in `tests/orchestrator-review.test.ts`.

---

### Task 4: CLI surface

**Files:**
- Modify: `packages/cli/src/commands/build.ts`
- Modify: `docs/planning/RUNNING_SPEC.md` (flag doc, if required by acceptance)

- [ ] **Step 4.1: Parse `--parallel N`**

Validate N ∈ [1, 3] default cap per V4 spec (config override later).

- [ ] **Step 4.2: CLI verify**

```bash
npm run build
FOUNDRY_BUILD_MOCK=1 node packages/cli/bin/foundry.js build --help
# approved fixture run:
FOUNDRY_BUILD_MOCK=1 node packages/cli/bin/foundry.js build --parallel 2
```

Expected: help lists flag; mock build completes or pauses at review as today.

---

### Task 5: Docs + issue closure prep

- [ ] **Step 5.1:** Link this plan from #31 body comment when implementation starts.
- [ ] **Step 5.2:** Remove `blocked:g4-production-truth` from #31 only after Kartik production-truth + V4-1 PR merged to `main`.

---

## Risks

| Risk | Mitigation |
|------|------------|
| False independence (missed shared paths) | Conservative overlap default; serial fallback |
| Composer rate / cost | Cap `maxParallel` at 3; doctor budget note in RUNNING_SPEC later |
| Worktree cleanup on partial failure | `finally` remove worktrees per worker (extend worker.ts) |

## Out of scope (V4-1)

- Exploration swarm (#32)
- Changing Pi core or forking pi-cursor-sdk
- Production-truth claim without Kartik G4 sign-off
