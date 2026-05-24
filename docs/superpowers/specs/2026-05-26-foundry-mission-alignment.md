# Foundry mission alignment (2026-05-26)

Merge session output from swarm Phase A deliverables. **North star:** AFK E2E — plan → approve → build → merge with minimal human touch.

## Verification gates (SSOT)

| Gate | When | Pass criteria |
|------|------|---------------|
| **G0** | Before V3 work | `npm test` green on `main` |
| **G1** | Pre-merge | PR #98 CI green on `v3/build-mode-mvp` |
| **G2** | Pre-merge | Thermo review of PR #98 diff; waive list accepted |
| **G5** | Pre-merge | Explicit `merge PR #98` in chat |
| **G3** | Post-merge | Full `npm test` on `main` with V3 code |
| **G4** | Post-merge | **Complete** exhaustive live log per `LIVE_VERIFICATION.md` (not “started”) |

**Merge when:** G1 + G2 + G5. **`main` is production-truth only after G3 + G4 complete.**

## This week (status)

1. **Merge PR #98** — **Done** (`36018f9`).
2. **G3** — **Done** (140 tests after honest-build slice).
3. **G4** — **Partial:** automated Tier A/E via `scripts/g4-batch-verify.sh`; live Composer plan/build + Tier D manual per log.
4. **P0 `tests/cursor-adapter.test.ts`** — **Done**.
5. **`FoundryAgentClient`** — **Done** ([`foundry-agent.ts`](../../packages/adapters/src/foundry-agent.ts)).

## Stop list

- V4/V5 feature coding until **G4 live sign-off** (Kartik).
- Pi **core** fork; npm dependency on pi-composer-powerpack.
- Node 22.19+ bump in same PR as G4 (slice C + DECISIONS first).

## Issue reprioritization (#21–#50)

| Priority | Issues | Action |
|----------|--------|--------|
| P0 | #21–#30 | Close after G4 sign-off (implementation on `main`) |
| P1 | #31–#40 | `blocked:v3-merge` until G4 complete |
| P2 | #41–#50 | No work until V4 path clear |

## SDK gate

- **Default:** `FoundryAgentClient` in `packages/adapters` (extract complete).
- **Fork pi-cursor-sdk:** ADR-gated only ([`0000-pi-cursor-sdk-and-powerpack-gate.md`](../../adr/0000-pi-cursor-sdk-and-powerpack-gate.md)).

## Pointers

| Doc | Path |
|-----|------|
| Architecture audit | `docs/superpowers/specs/2026-05-26-foundry-architecture-audit.md` |
| G4 checklist | `docs/planning/LIVE_VERIFICATION.md` |
| G4 log | `docs/superpowers/specs/2026-05-26-live-verification-log.md` |

## G0 / G3 baseline

- **G0** `b994de2`: 106 tests (pre-V3).
- **G3** post-merge: **140 tests** (`npm test`).

## Risks

- Live Composer tiers in G4 log still **SKIP** until manual run in isolated worktree.
- `foundry build` without `FOUNDRY_BUILD_MOCK=1` uses real `promptComposer` and pauses for review.
