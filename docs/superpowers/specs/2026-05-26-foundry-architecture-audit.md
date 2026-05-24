# Foundry architecture audit (2026-05-26)

Evidence-backed audit of `main` after PR #98 merge (`36018f9`). **G3:** 140 tests pass (post honest-build + `FoundryAgentClient` extract).

## Package boundaries

| Package | Role | Key imports |
|---------|------|-------------|
| `packages/cli` | Command dispatch, argv parsing | `@foundry/core`, `@foundry/planner`, `@foundry/doctor` |
| `packages/core` | Run state, schemas, config, events | No planner/cli/doctor |
| `packages/doctor` | Deterministic checks, fix | `@foundry/core`, `@foundry/adapters` |
| `packages/adapters` | `FoundryAgentClient`, cursor facade, worktree | `@foundry/core`, `@cursor/sdk` |
| `packages/planner` | Plan, publish, **build** (`src/build/`) | `@foundry/core`, `@foundry/doctor`, `@foundry/adapters` |

Enforced by `tests/package-boundaries.test.ts`.

## LOC hotspots (thermo watchlist)

| File | LOC | Note |
|------|-----|------|
| `packages/core/src/state/run-store.ts` | ~466 | Split candidate before V4 |
| `packages/planner/src/plan/orchestrate.ts` | ~407 | Split by phase when touching plan |
| `packages/planner/src/build/orchestrate.ts` | ~260 | Cohesive; review pause at `build_review` |

## Build / Cursor seam (post-merge)

| Path | Role |
|------|------|
| `packages/adapters/src/foundry-agent.ts` | **SSOT** — `FoundryAgentClient`, smokes, `prompt` |
| `packages/adapters/src/cursor.ts` | Thin facade for doctor + plan |
| `packages/adapters/src/build-agent.ts` | Build worker → `FoundryAgentClient` |
| `packages/planner/src/build/orchestrate.ts` | Default: real agent; `FOUNDRY_BUILD_MOCK=1` for CI/demo |

**CLI default:** `autoApproveReview: false` (HITL). **Demo/CI:** `FOUNDRY_BUILD_MOCK=1` enables mock agent + auto-review.

## Ranked improvements

### Strong (V4 prep)

1. Split `run-store.ts` before parallel build state grows.
2. Checkpoint resume without full `executeBuild` re-entry.
3. Complete exhaustive G4 live rows in `LIVE_VERIFICATION.md` (see live verification log).

### Moderate

4. Parity fixtures vs pi-cursor-sdk in `tests/cursor-adapter.test.ts` (extend with mocked SDK when Node mock.module available in CI).

### Done (this slice)

- `FoundryAgentClient` extract
- Honest build default + mock env for demos
- Dead defer branch removed
- Proof evidence includes agent output file

### Done (post-alignment PR2)

- `resolvePreflightOptions` — build `deep` when real agent; skip deep when `FOUNDRY_BUILD_MOCK=1`
- CI runs `FOUNDRY_BUILD_MOCK=1 bash scripts/demo-build.sh`
- G4 scripts on `main` (PR1)

### Remains before V4-1

- V4 Task 0: `nextPendingIssue` + `blocked_by`, resume hardening, optional `run-store` split

## CI / verification snapshot

- `npm test` → 143 pass
- `scripts/demo-build.sh` → uses `FOUNDRY_BUILD_MOCK=1`
- G4 automated batch: `scripts/g4-batch-verify.sh` → appends to live verification log
