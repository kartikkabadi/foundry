# Delegation plan
Units: 4

| # | Unit | Files (mine) | Worker (subagent) | Acceptance | Status |
|---|---|---|---|---|---|
| 1 | Physical claim identities | `lib/foundry/physical-claims.ts`, `tests/physical-claims.test.ts` | PhysicalClaims | Sanctioned-root physical identities collapse symlink aliases and reject escapes or missing roots | verified |
| 2 | Gate-aware scheduling | `lib/foundry/scheduler.ts`, `tests/scheduler.test.ts` | GateScheduling | Pending required gates defer ready tasks deterministically without side effects | verified |
| 3 | Publication contract | `lib/foundry/execute.ts`, `lib/foundry/walk.ts`, `app/issues/[id]/walk-doc-panel.tsx`, `tests/execute.test.ts`, `tests/walk-doc-panel.test.ts`, `vitest.config.ts` | PublicationContract | Local execution remains useful and safe; no automatic push, PR, merge, or deployment | verified |
| 4 | Behavioral release gates | `GATES.md`, `scripts/check-orchestration.ts` | ReleaseGates | One runnable behavioral gate proves retries, learning, automation, fencing, waiting, and no publication | verified |

## Shared contracts

- Physical identity resolution is an async adapter outside the pure scheduler. It returns canonical absolute physical paths for claim strings relative to an existing sanctioned root.
- Scheduler receives gate state as pure input. It emits `blocked-by-pending-gate`; it never answers or mutates gates.
- Execute results remain local artifacts with `prUrl: ""`; the UI labels this honestly rather than claiming a PR exists.
- Release gate script runs existing tests or public APIs behaviorally. It does not grep source strings as proof.

## Evidence

- Parent focused verification after physical-claim runtime wiring: physical/runtime/driver 49 tests; scheduler 52 tests; orchestration store 33 tests.
- Parent repository verification on 2026-08-25: `npm test` passed 29 files and 609 tests; `npm run typecheck` passed; `npm run build` passed; disposable orchestration + automation proof passed 9 tests.
- Focused automation verification: 67 tests pass across the automation control, driver, runtime, and improvement-candidate units.
- Parent behavioral release gate: `node_modules/.bin/tsx scripts/check-orchestration.ts` printed all seven section markers followed by `ORCHESTRATION_GATES_OK`.
- Live operator dashboard: browser loaded `/automation` and exercised disabled → enabled → paused with a screenshot.
- Independent grades: architecture PASS (0.92 confidence); correctness PASS (0.90 confidence); fresh post-integration security PASS with no material findings.
