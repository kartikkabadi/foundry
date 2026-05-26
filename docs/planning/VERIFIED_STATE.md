# Foundry verified state (issues #1–#50)

**Purpose:** Single SSOT mapping GitHub issues → code on `main` → test proof → status. Do not trust planning docs without this table or a fresh code read.

**Last verified:** `cursor/full-cli-verification-c260` — `npm test` **233+ pass**, `scripts/full-cli-harness.sh` exit 0, live Composer plan verified in Cloud.

**Canonical open work:** verify on GitHub — slices #32, #34, #42–#48 targeted in PR `cursor/v5-open-issues-c260`. Duplicates #51–#90 are closed.

**Related:** [V2-V5_GITHUB_ISSUES.md](V2-V5_GITHUB_ISSUES.md), [../agents/README.md](../agents/README.md), [../agents/issue-tracker.md](../agents/issue-tracker.md). Historical alignment snapshot: `docs/archive/TRACKER_ALIGNMENT_2026-05-26.md` (pre–PR #103).

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

## V4 (#31–#40) — MIXED

| # | Slice | Primary code | Test proof | Status |
|---|-------|--------------|------------|--------|
| [31](https://github.com/kartikkabadi/foundry/issues/31) | Parallel build | `packages/planner/src/build/parallel-schedule.ts`, `packages/planner/src/build/orchestrate.ts`, `packages/cli/src/commands/build.ts` (`--parallel`) | `tests/build-parallel.test.ts`, `tests/parallel-build.test.ts` | **DONE** |
| [32](https://github.com/kartikkabadi/foundry/issues/32) | Exploration swarm | `packages/planner/src/plan/swarm.ts`, `plan/orchestrate.ts` | `tests/plan-swarm.test.ts`, `tests/plan-args.test.ts` | **DONE** — `--swarm-branches`, parallel fanout, provenance in research/synthesis |
| [33](https://github.com/kartikkabadi/foundry/issues/33) | Team spec TOML | `packages/core/src/team/spec.ts`, `packages/core/src/schema/team-spec.ts`, `packages/cli/src/commands/init.ts` | `tests/team-spec.test.ts` | **DONE** |
| [34](https://github.com/kartikkabadi/foundry/issues/34) | Comms contracts | `packages/planner/src/build/publish-handoffs.ts` | `tests/comms-contracts.test.ts`, `tests/build-handoffs.test.ts` | **DONE** — handoff template + `handoff_published` on build |
| [35](https://github.com/kartikkabadi/foundry/issues/35) | Loop detection + budget | `packages/core/src/loop/detection.ts`, `packages/planner/src/plan/agent-pass-policy.ts` | `tests/loop-detection.test.ts`, `tests/agent-pass-policy.test.ts`, `tests/budget-profiles.test.ts` | **DONE** |
| [36](https://github.com/kartikkabadi/foundry/issues/36) | Rate-limit checkpoint | `packages/adapters/src/agent-errors.ts`, `packages/planner/src/plan/orchestrate.ts`, `packages/planner/src/build/orchestrate.ts` | `tests/rate-limit-checkpoint.test.ts` | **DONE** |
| [37](https://github.com/kartikkabadi/foundry/issues/37) | Conflict artifacts | `packages/core/src/conflicts/conflict.ts` | `tests/conflict-artifacts.test.ts` | **PARTIAL** — wire into live plan/build/status blocking |
| [38](https://github.com/kartikkabadi/foundry/issues/38) | Browser capture adapter | `packages/adapters/src/browser-capture.ts`, `packages/doctor/src/checks/browser-capture.ts`, `packages/cli/src/commands/plan.ts` | `tests/browser-capture.test.ts` | **DONE** |
| [39](https://github.com/kartikkabadi/foundry/issues/39) | CuaDriver adapter | `packages/adapters/src/cuadriver.ts`, `packages/doctor/src/checks/cuadriver-computer-use.ts` | `tests/cuadriver-adapter.test.ts` | **DONE** |
| [40](https://github.com/kartikkabadi/foundry/issues/40) | Pi runtime adapter | `packages/adapters/src/pi-runtime.ts`, `packages/doctor/src/checks/pi-runtime.ts` | `tests/pi-runtime-adapter.test.ts` | **DONE** |

---

## V5 (#41–#50) — MIXED

| # | Slice | Primary code | Test proof | Status |
|---|-------|--------------|------------|--------|
| [41](https://github.com/kartikkabadi/foundry/issues/41) | TUI | `packages/cli/src/commands/tui.ts`, `packages/cli/src/tui/render.ts` | `tests/tui-render.test.ts` | **DONE** |
| [42](https://github.com/kartikkabadi/foundry/issues/42) | Background daemon | `packages/cli/src/commands/daemon.ts`, `daemon/process.ts` | `tests/daemon-lifecycle.test.ts` | **DONE** |
| [43](https://github.com/kartikkabadi/foundry/issues/43) | macOS notifications | `packages/adapters/src/notify/dispatch.ts`, `config/notifications.ts` | `tests/notifications-config.test.ts` | **DONE** |
| [44](https://github.com/kartikkabadi/foundry/issues/44) | Webhook notifications | `packages/adapters/src/notify/webhook.ts`, `config/notifications.ts` | `tests/notifications-config.test.ts` | **DONE** |
| [45](https://github.com/kartikkabadi/foundry/issues/45) | Marathon policy | `marathon/policy.ts`, `plan/agent-pass-policy.ts` | `tests/agent-pass-policy.test.ts` | **DONE** |
| [46](https://github.com/kartikkabadi/foundry/issues/46) | Agent-guided setup | `planner/setup/suggestions.ts`, `commands/setup.ts` | `tests/setup-agent.test.ts` | **DONE** |
| [47](https://github.com/kartikkabadi/foundry/issues/47) | GitHub private repo create | `adapters/github-create-repo.ts`, `commands/build.ts` | `tests/create-repo-adapter.test.ts` | **DONE** (HITL for live `gh`) |
| [48](https://github.com/kartikkabadi/foundry/issues/48) | npm distribution + self-update | `commands/update.ts`, `update-registry.ts` | `tests/npm-distribution.test.ts` | **DONE** |
| [49](https://github.com/kartikkabadi/foundry/issues/49) | Powerpack guide integration | `packages/core/src/constants/powerpack.ts`, setup/doctor messaging | `tests/powerpack-guide.test.ts` | **DONE** |
| [50](https://github.com/kartikkabadi/foundry/issues/50) | Production hardening / V5 verification | `docs/planning/V5_VERIFICATION_MATRIX.md` | `tests/v5-verification-matrix.test.ts` | **DONE** |

---

## Re-verify checklist

```bash
cd /path/to/foundry
git rev-parse HEAD
npm test
```

Update this file when closing #31–#50 or when test count / SHA changes.
