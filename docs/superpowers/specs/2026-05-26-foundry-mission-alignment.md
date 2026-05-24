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

## This week (max 3 items)

1. **Merge PR #98** after **G1 + G2** + explicit `merge PR #98` — CI fix on `8281987` (approve test uses `mockDoctorDeps`).
2. **G3 + G4** on `main` after merge — full `npm test`; complete live log per `LIVE_VERIFICATION.md`.
3. **P0 test gap** — add `tests/cursor-adapter.test.ts` skeleton (auth + smoke fixtures, no network) as first post-merge code slice.

## Stop list

- V4/V5 feature coding until V3 merge + **G3 + G4 complete**.
- `FoundryAgentClient` / `foundry-agent.ts` extract until post-V3 + G4 (see [`2026-05-26-pi-cursor-sdk-inhouse-options.md`](2026-05-26-pi-cursor-sdk-inhouse-options.md)).
- Pi **core** fork; npm dependency on pi-composer-powerpack.
- New manager/registry layers without deletion test.
- Node 22.19+ bump in same PR as G4 (slice C + DECISIONS first).

## Issue reprioritization (#21–#50)

| Priority | Issues | Action |
|----------|--------|--------|
| P0 | #21–#30 | Close with proof **after** merge + **G3 + G4 complete** (full log) |
| P1 | #31–#40 | Label `blocked:v3-merge`; start V4-1 only after G4 |
| P2 | #41–#50 | No work until V4 orchestration path clear |
| Hygiene | V2 **#11–#20** | Closed on `main`; V1 **#1–#8** closed; **#9–#10** not in published index |

## SDK gate

- **Default:** extract portable core into `packages/adapters` (see [`2026-05-26-pi-cursor-sdk-inhouse-options.md`](2026-05-26-pi-cursor-sdk-inhouse-options.md)).
- **Fork pi-cursor-sdk:** only if extract/upstream fails ADR criteria ([`0000-pi-cursor-sdk-and-powerpack-gate.md`](../../adr/0000-pi-cursor-sdk-and-powerpack-gate.md)).
- **Defer:** hybrid Pi workers until post-V3.

## Architecture / tracker / tests (pointers)

| Doc | Path |
|-----|------|
| Architecture audit | `docs/superpowers/specs/2026-05-26-foundry-architecture-audit.md` |
| Tracker alignment | `docs/planning/TRACKER_ALIGNMENT_2026-05-26.md` |
| Testing strategy | `docs/superpowers/specs/2026-05-26-testing-strategy.md` |
| G4 checklist SSOT | `docs/planning/LIVE_VERIFICATION.md` |
| PR #98 thermo | `docs/superpowers/specs/2026-05-26-pr98-thermo-review.md` |

## G0 / G3 baseline (recorded)

- **G0** `main` @ `b994de2`: **106 tests pass** (pre-V3).
- **G3** `main` @ `36018f9` (PR #98 merged 2026-05-24): **134 tests pass**, `npm test` exit 0.
- Docs commit on `main`: `332cc19` (swarm alignment + thermo gate fixes).

## Risks

- `main` not production-truth until **G3 + G4 complete** despite merge.
- Dual `promptComposer` vs `createCursorAdapter` until post-V3 unify.
- Planner `dist/build` export without `src/build` on `main` until PR #98 merges.
- PR #98 build path uses **mock agent by default** — waive until post-merge wiring (see PR #98 thermo doc).
