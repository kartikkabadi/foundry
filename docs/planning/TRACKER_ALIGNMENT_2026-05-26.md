# Tracker alignment (2026-05-26)

**PR #98 merged** (`36018f9`); G4 harness on `main` after alignment PR. **Closed on `main`:** V1 **#1–#8**, V2 **#11–#20**, V3 **#21–#30** (implementation present; GitHub closed — add evidence comments after Kartik production-truth). **Canonical open work:** **#31–#50** only. Duplicates **#51–#90** remain closed.

## Doc fixes applied

- `docs/planning/V2-V5_GITHUB_ISSUES.md` — all `Blocked by` references updated from duplicate numbers (#51–#90) to canonical (#11–#50) via −40 mapping (e.g. #61→#21, #81→#41).
- `docs/agents/issue-tracker.md` — extended index for #21–#50 (see that file).

## PR #98 ↔ V3 issues (#21–#30)

| Issue | Title (short) | PR #98 signal |
|-------|---------------|---------------|
| #21 | build skeleton + preflight | `packages/cli/src/commands/build.ts`, `build/orchestrate.ts` |
| #22 | issue-plan graph | `issue-plan-graph.ts`, tests |
| #23 | worktree adapter | `packages/adapters` + `tests/worktree-adapter.test.ts` |
| #24 | serial worker | `build/worker.ts` |
| #25 | proof registry | `proof-registry.ts` |
| #26 | autonomy | `build/autonomy.ts`, `build-autonomy.test.ts` |
| #27 | orchestrator review | `build/review.ts`, `orchestrator-review.test.ts` |
| #28 | defer + goal | `build/defer.ts`, `build-defer.test.ts` |
| #29 | build resume | `build-resume.test.ts` |
| #30 | E2E fixture | `build-fixtures.ts`, multiple build tests; **G4 live catalog** in `LIVE_VERIFICATION.md` |

**#21–#30:** Code on `main`; optional closing comments after **G4 production-truth** sign-off (see live verification log).

## AC ↔ tests gap table (open issues)

Legend: **Covered** = tests or scripts exist on `main` or PR #98 branch; **Gap** = AC not fully proven in CI.

| Issue | Milestone | AC coverage | Gap / notes |
|-------|-----------|-------------|-------------|
| #21–#30 | V3 | PR #98 test files | Merge + G4 live rehearsal beyond fixture CI |
| #31 | V4-1 | partial | V4-1 parallel build on `main` (#102); label unblocked |
| #32 | V4-2 | — | No exploration swarm tests |
| #33–#40 | V4 | partial doctor | `pi-runtime` check only; V4-10 adapter missing |
| #41–#50 | V5 | — | TUI/daemon/npm not started |

### V2 issues (#11–#20) — closed on main

| Issue | Tests (main) |
|-------|----------------|
| #11 V2-1 | `cli.test.ts`, `scripts/demo.sh` |
| #12 V2-2 | `schema-validation.test.ts` |
| #13 V2-3 | `run-writer.test.ts`, `run-store` split |
| #14–#20 | `plan.test.ts`, `plan-resume.test.ts`, `events.test.ts`, `approve.test.ts`, `package-boundaries.test.ts`, etc. |

## Milestone sanity

- V4 (#31–#40): `blocked:g4-production-truth` removed 2026-05-25 after production-truth sign-off on G4 log.
- V5 (#41–#50) blocked on V4 orchestration + Pi runtime (#40) per roadmap.

## Suggested issue comment (post-merge template)

```markdown
Closed via PR #98 merge (<sha>). Verification: npm test on main (<count> pass); G4 log: docs/superpowers/specs/2026-05-26-live-verification-log.md
```
