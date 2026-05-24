# Foundry architecture audit (2026-05-26)

Evidence-backed readonly audit of `main` at `b994de2` (106 tests green). V3 Build MVP lives on branch `v3/build-mode-mvp` ([PR #98](https://github.com/kartikkabadi/foundry/pull/98)); figures below cite `main` unless noted.

## Package boundaries

| Package | Role | Key imports |
|---------|------|-------------|
| `packages/cli` | Command dispatch, argv parsing | `@foundry/core`, `@foundry/planner`, `@foundry/doctor` |
| `packages/core` | Run state, schemas, config, events | No planner/cli/doctor |
| `packages/doctor` | Deterministic checks, fix | `@foundry/core`, `@foundry/adapters` |
| `packages/adapters` | Cursor SDK seam (`Agent.prompt`, smokes) | `@foundry/core` |
| `packages/planner` | Plan/publish orchestration; **build on PR #98 only** | `@foundry/core`, `@foundry/doctor`, `@foundry/adapters` |

Enforced by `tests/package-boundaries.test.ts`: planner must not import cli; doctor must not import planner/cli.

## LOC hotspots (thermo watchlist)

| File | LOC | Note |
|------|-----|------|
| `packages/core/src/state/run-store.ts` | 452 | Run CRUD, approve, pause/resume — split candidate post-V3 |
| `packages/planner/src/plan/orchestrate.ts` | 407 | Plan pipeline — split by phase after V3 merge |
| `packages/planner/src/build/orchestrate.ts` | 257 (PR #98) | New; acceptable if kept cohesive |

Legacy `src/state/run-store.ts` may still exist; **SSOT is `packages/core`**. README references to top-level `src/` should stay aligned with packages layout.

## Stale dist / build exports

- `packages/planner/package.json` exports `"./build/*": "./dist/build/*"` while **`packages/planner/src/build/` is absent on `main`** (only on V3 branch).
- CI runs `npm run build` after tests; planner build must emit `dist/build` on V3 branch or typecheck/export paths break on checkout.
- **Risk:** merging PR #98 without verifying `npm run build` produces `dist/build/*`.

## Dual Cursor APIs (code-judo)

| Call site | API | File |
|-----------|-----|------|
| Doctor smokes | `createCursorAdapter()` | `packages/doctor/src/deps.ts` |
| Plan agent passes | `promptComposer()` | `packages/planner/src/plan/orchestrate.ts` |

Both wrap `@cursor/sdk` `Agent.prompt` in `packages/adapters/src/cursor.ts`. **Defer `FoundryAgentClient` extract until post-V3 merge + G4** (see [`2026-05-26-pi-cursor-sdk-inhouse-options.md`](2026-05-26-pi-cursor-sdk-inhouse-options.md) and mission alignment).

## Ranked improvements

### Strong (do after V3 merge + G4)

1. **Unify adapter seam** — single `FoundryAgentClient` (or internal `promptOnce`) for doctor + plan + build; delete parallel public APIs.
2. **Split `run-store.ts`** — extract approve/find-active/pause into focused modules once V3 stabilizes.
3. **Planner build dist hygiene** — ensure `src/build` and `dist/build` stay in sync in CI `npm run build`.

### Moderate

4. **Parity tests** — `tests/cursor-adapter.test.ts` with fixtures mirroring pi-cursor-sdk auth/smoke semantics (no live network in default `npm test`).
5. **Remove legacy `src/` tree** if still duplicated — deletion test: no imports from `src/` in packages.

### Speculative (ADR-gated)

6. **Shared npm package** with pi-cursor-sdk — only if extract audit proves duplication across Pi extension and Foundry CLI.
7. **Node 22.19+ bump** — post-swarm slice C; not required for G4 while repo pins Node 20 (`.nvmrc`, `engines`).

## CI / verification snapshot

- `main`: `npm test` → 106 pass (2026-05-26; verified: `cd foundry && npm test` on `main` @ `b994de2`).
- PR #98: 134 tests on branch; CI `verify` was red on `approve.test.ts` — fixed in `8281987` on `v3/build-mode-mvp` (re-verify with `gh pr checks 98` before merge).
