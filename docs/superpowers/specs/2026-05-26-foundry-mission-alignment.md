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
| **G4** | Post-merge | Evidence + tiers A–E per `LIVE_VERIFICATION.md` (see three levels below) |

**Merge when:** G1 + G2 + G5.

**Post-merge truth levels (do not conflate):**

| Level | Status (2026-05-24) |
|-------|---------------------|
| Evidence logged | **Yes** — live plan, approve, build (no mock), Tiers B–E in [G4 log](2026-05-26-live-verification-log.md) |
| G4 complete | **Yes** — automated batch + `scripts/g4-live-rehearsal.sh` @ `c433096` |
| Production-truth | **No** — Kartik sign-off checkbox on G4 log only |

**`main` is production-truth only after G3 + Kartik production-truth sign-off** (G4 evidence ≠ Kartik sign-off).

## This week (status)

1. **Merge PR #98** — **Done** (`36018f9`).
2. **G3** — **Done** (140 tests after honest-build slice).
3. **G4** — **Evidence + G4 complete:** `g4-batch-verify.sh` + `g4-live-rehearsal.sh` (live plan/approve/build, Tier B/C/D). **Production-truth:** pending Kartik log sign-off.
4. **P0 `tests/cursor-adapter.test.ts`** — **Done**.
5. **`FoundryAgentClient`** — **Done** ([`foundry-agent.ts`](../../packages/adapters/src/foundry-agent.ts)).

## Stop list

- V4/V5 feature coding until **Kartik production-truth sign-off** on G4 log (evidence is logged; sign-off is separate).
- Pi **core** fork; npm dependency on pi-composer-powerpack.
- Node 22.19+ bump in same PR as G4 (slice C + DECISIONS first).

## Issue reprioritization (#21–#50)

| Priority | Issues | Action |
|----------|--------|--------|
| P0 | #21–#30 | Close after G4 sign-off (implementation on `main`) |
| P1 | #31–#40 | `blocked:v3-merge` until Kartik production-truth (G4 evidence done) |
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

- Closing **#30** ≠ full production-truth; extended gate only per `LIVE_VERIFICATION.md`.
- `foundry build` without `FOUNDRY_BUILD_MOCK=1` uses real `promptComposer` and pauses for review.
