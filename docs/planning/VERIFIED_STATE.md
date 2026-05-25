# Foundry verified state (issues #1–#50)

**Purpose:** Single SSOT mapping GitHub issues → code on `main` → test proof → status. Do not trust planning docs without this table or a fresh code read.

**Last verified:** `main` @ `0fbd325` — `npm test` **156/156 pass** (no live Composer in CI).

**Canonical open work:** [#31–#50](https://github.com/kartikkabadi/foundry/issues?q=is%3Aissue+is%3Aopen) only. Duplicates #51–#90 are closed.

**Related:** [TRACKER_ALIGNMENT_2026-05-26.md](TRACKER_ALIGNMENT_2026-05-26.md), [V2-V5_GITHUB_ISSUES.md](V2-V5_GITHUB_ISSUES.md), master plan Part A in `docs/superpowers/plans/2026-05-25-foundry-verified-master-plan.md`.

---

## Legend

| Status | Meaning |
|--------|---------|
| **DONE** | Closed on GitHub; implementation + tests on `main` |
| **PARTIAL** | Code landed; issue open or AC not fully proven |
| **OPEN** | Not started or doctor probe only |

| Test | Meaning |
|------|---------|
| ✓ | Dedicated test file or script cited |
| ~ | Covered indirectly (e.g. via `plan.test.ts`) |
| — | No issue-named test on `main` |

---

## V1 (#1–#8) — DONE

| # | Title (short) | Primary code | Test proof | Status |
|---|---------------|--------------|------------|--------|
| [1](https://github.com/kartikkabadi/foundry/issues/1) | CLI bootstrap + local state | `packages/cli/src/cli.ts`, `packages/core/src/state/` | `tests/cli.test.ts`, `tests/state.test.ts` | **DONE** |
| [2](https://github.com/kartikkabadi/foundry/issues/2) | `foundry doctor` | `packages/doctor/src/`, `packages/cli/src/commands/doctor.ts` | `tests/doctor.test.ts`, `tests/doctor-expanded.test.ts`, `tests/doctor-fix.test.ts` | **DONE** |
| [3](https://github.com/kartikkabadi/foundry/issues/3) | `foundry setup` | `packages/cli/src/commands/setup.ts` | — (no dedicated setup tests; behavior via doctor) | **DONE** |
| [4](https://github.com/kartikkabadi/foundry/issues/4) | init, run state, pause/resume | `packages/core/src/state/run-store.ts`, `packages/cli/src/commands/init.ts`, `status.ts`, `pause.ts`, `resume.ts` | `tests/run-writer.test.ts`, `tests/resume-target.test.ts` | **DONE** |
| [5](https://github.com/kartikkabadi/foundry/issues/5) | Composer 2.5 preflight | `packages/adapters/src/foundry-agent.ts`, `packages/core/src/config/cursor-auth.ts`, `packages/planner/src/plan/orchestrate.ts` | `tests/cursor-auth.test.ts`, `tests/cursor-adapter.test.ts`, `tests/plan.test.ts` | **DONE** |
| [6](https://github.com/kartikkabadi/foundry/issues/6) | Plan Mode artifacts | `packages/planner/src/plan/` | `tests/plan.test.ts`, `tests/plan-resume.test.ts` | **DONE** |
| [7](https://github.com/kartikkabadi/foundry/issues/7) | Publish + approval gate | `packages/planner/src/publish/`, `packages/cli/src/commands/publish.ts` | `tests/approve.test.ts`, ~`tests/plan.test.ts` | **DONE** (note: publish may not read `run.status`; see master plan A.2) |
| [8](https://github.com/kartikkabadi/foundry/issues/8) | Installer, docs, smoke | `scripts/install.sh`, `scripts/demo.sh`, `README.md` | `tests/cli.test.ts`, `bash scripts/demo.sh` (CI) | **DONE** |

---

## V2 (#11–#20) — DONE

| # | Slice | Primary code | Test proof | Status |
|---|-------|--------------|------------|--------|
| [11](https://github.com/kartikkabadi/foundry/issues/11) | V2-1 merge V1 / hygiene | repo root, `scripts/demo.sh` | `tests/cli.test.ts`, `scripts/demo.sh` | **DONE** |
| [12](https://github.com/kartikkabadi/foundry/issues/12) | Schema validation | `packages/core/src/schema/` | `tests/schema-validation.test.ts` | **DONE** |
| [13](https://github.com/kartikkabadi/foundry/issues/13) | run-store split | `packages/core/src/state/run-store.ts` | `tests/run-writer.test.ts` | **DONE** |
| [14](https://github.com/kartikkabadi/foundry/issues/14) | secrets → config boundary | `packages/core/src/config/secrets.ts`, `packages/adapters/` | `tests/config-secrets.test.ts`, `tests/cursor-auth.test.ts` | **DONE** |
| [15](https://github.com/kartikkabadi/foundry/issues/15) | Plan checkpoint resume | `packages/planner/src/plan/orchestrate.ts` | `tests/plan-resume.test.ts` | **DONE** |
| [16](https://github.com/kartikkabadi/foundry/issues/16) | Budget profiles | `packages/core/src/budget-profiles.ts` | `tests/budget-profiles.test.ts` | **DONE** |
| [17](https://github.com/kartikkabadi/foundry/issues/17) | `foundry approve` | `packages/cli/src/commands/approve.ts` | `tests/approve.test.ts` | **DONE** |
| [18](https://github.com/kartikkabadi/foundry/issues/18) | Doctor expanded matrix | `packages/doctor/src/checks/` | `tests/doctor-expanded.test.ts` | **DONE** |
| [19](https://github.com/kartikkabadi/foundry/issues/19) | events.jsonl | `packages/planner/src/plan/` (events) | `tests/events.test.ts` | **DONE** |
| [20](https://github.com/kartikkabadi/foundry/issues/20) | Package boundaries | `packages/*` workspace | `tests/package-boundaries.test.ts` | **DONE** |

---

## V3 (#21–#30) — DONE

| # | Slice | Primary code | Test proof | Status |
|---|-------|--------------|------------|--------|
| [21](https://github.com/kartikkabadi/foundry/issues/21) | Build skeleton + preflight | `packages/cli/src/commands/build.ts`, `packages/planner/src/build/orchestrate.ts` | `tests/build-preflight.test.ts` | **DONE** |
| [22](https://github.com/kartikkabadi/foundry/issues/22) | Issue-plan DAG | `packages/planner/src/build/issue-plan-graph.ts` | `tests/issue-plan-graph.test.ts`, `tests/build-blocked-by.test.ts` | **DONE** |
| [23](https://github.com/kartikkabadi/foundry/issues/23) | Worktree adapter | `packages/adapters/src/worktree.ts` | `tests/worktree-adapter.test.ts` | **DONE** |
| [24](https://github.com/kartikkabadi/foundry/issues/24) | Serial worker | `packages/planner/src/build/worker.ts` | `tests/build-worker.test.ts` | **DONE** |
| [25](https://github.com/kartikkabadi/foundry/issues/25) | Proof registry | `packages/planner/src/build/proof-registry.ts` | `tests/proof-registry.test.ts` | **DONE** |
| [26](https://github.com/kartikkabadi/foundry/issues/26) | Autonomy taxonomy | `packages/planner/src/build/autonomy.ts` | `tests/build-autonomy.test.ts` | **DONE** (audit helper export unused — master plan T5) |
| [27](https://github.com/kartikkabadi/foundry/issues/27) | Orchestrator review | `packages/planner/src/build/review.ts` | `tests/orchestrator-review.test.ts` | **DONE** |
| [28](https://github.com/kartikkabadi/foundry/issues/28) | Defer + build goal | `packages/planner/src/build/defer.ts` | `tests/build-defer.test.ts` | **DONE** |
| [29](https://github.com/kartikkabadi/foundry/issues/29) | Build resume | `packages/planner/src/build/orchestrate.ts` | `tests/build-resume.test.ts` | **DONE** |
| [30](https://github.com/kartikkabadi/foundry/issues/30) | E2E plan→build fixture | `scripts/demo-build.sh` | CI `demo-build.sh`; build fixture tests | **DONE** |

---

## V4 (#31–#40) — OPEN

| # | Slice | Primary code | Test proof | Status |
|---|-------|--------------|------------|--------|
| [31](https://github.com/kartikkabadi/foundry/issues/31) | Parallel build | `packages/planner/src/build/parallel-schedule.ts`, `orchestrate.ts`, `packages/cli/src/commands/build.ts` (`--parallel`) | `tests/build-parallel.test.ts` (unit; no concurrent integration test) | **PARTIAL** — close after Phase 1 integration test |
| [32](https://github.com/kartikkabadi/foundry/issues/32) | Exploration swarm | — | — | **OPEN** |
| [33](https://github.com/kartikkabadi/foundry/issues/33) | Team spec TOML | — | — | **OPEN** |
| [34](https://github.com/kartikkabadi/foundry/issues/34) | Comms contracts | — | — | **OPEN** |
| [35](https://github.com/kartikkabadi/foundry/issues/35) | Loop detection + budget | — | — | **OPEN** |
| [36](https://github.com/kartikkabadi/foundry/issues/36) | Rate-limit checkpoint | partial in orchestrators | — | **OPEN** |
| [37](https://github.com/kartikkabadi/foundry/issues/37) | Conflict artifacts | — | — | **OPEN** |
| [38](https://github.com/kartikkabadi/foundry/issues/38) | Browser capture adapter | doctor check only | — | **PARTIAL** (doctor probe) |
| [39](https://github.com/kartikkabadi/foundry/issues/39) | CuaDriver adapter | doctor check only | — | **PARTIAL** (doctor probe) |
| [40](https://github.com/kartikkabadi/foundry/issues/40) | Pi runtime adapter | `packages/doctor/src/checks/pi-runtime.ts` | — | **PARTIAL** (doctor probe; no `packages/adapters` seam) |

---

## V5 (#41–#50) — OPEN

| # | Slice | Primary code | Test proof | Status |
|---|-------|--------------|------------|--------|
| [41](https://github.com/kartikkabadi/foundry/issues/41) | TUI | — | — | **OPEN** |
| [42](https://github.com/kartikkabadi/foundry/issues/42) | Background daemon | — | — | **OPEN** |
| [43](https://github.com/kartikkabadi/foundry/issues/43) | macOS notifications | — | — | **OPEN** |
| [44](https://github.com/kartikkabadi/foundry/issues/44) | Webhook notifications | — | — | **OPEN** |
| [45](https://github.com/kartikkabadi/foundry/issues/45) | Marathon policy | partial `budget-profiles.ts` | `tests/budget-profiles.test.ts` (~) | **OPEN** |
| [46](https://github.com/kartikkabadi/foundry/issues/46) | Agent-guided setup | — | — | **OPEN** |
| [47](https://github.com/kartikkabadi/foundry/issues/47) | GitHub private repo create | — | — | **OPEN** |
| [48](https://github.com/kartikkabadi/foundry/issues/48) | npm distribution + self-update | — | — | **OPEN** |
| [49](https://github.com/kartikkabadi/foundry/issues/49) | Powerpack guide integration | — | — | **OPEN** |
| [50](https://github.com/kartikkabadi/foundry/issues/50) | Production hardening / V5 verification | — | — | **OPEN** |

---

## Re-verify checklist

```bash
cd /path/to/foundry
git rev-parse HEAD
npm test
```

Update this file when closing #31–#50 or when test count / SHA changes.
