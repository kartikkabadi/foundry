# PR #98 thermo-nuclear review (2026-05-26)

**PR:** [feat(v3): Build Mode MVP](https://github.com/kartikkabadi/foundry/pull/98)  
**Branch:** `v3/build-mode-mvp`  
**Diff:** ~1,857 insertions / 23 deletions (31 files) vs `main`  
**Verdict:** **Merge with waive list** after **G1 + G2** — await explicit `merge PR #98`.

## Gates (aligned with mission alignment)

| Gate | Status |
|------|--------|
| G1 CI | Green on `8281987` (`verify` pass) |
| G2 thermo | This doc + second pass 2026-05-26 |
| G5 merge | Not performed — needs explicit `merge PR #98` |

## G1 CI

| Check | Status |
|-------|--------|
| Historical CI (`3d77cc2`) | `verify` FAIL — `approve.test.ts` CLI `build --dry-run` hit real doctor in CI |
| Fix (`8281987`) | Approve gate test uses `executeBuild` + `mockDoctorDeps`; pushed to origin |
| Local `npm test` (v3) | 134 pass |

## Structural findings

| Finding | Severity | Notes |
|---------|----------|-------|
| New `build/orchestrate.ts` (257 LOC) | OK | Cohesive module; under 1k LOC rule |
| `run-store.ts` +14 LOC | OK | Minor; watch total ~466 LOC on branch |
| Test fixtures `build-fixtures.ts` | Good | Mock doctor pattern reusable |
| Dual Cursor APIs unchanged | Defer | Unify post-merge per [`2026-05-26-pi-cursor-sdk-inhouse-options.md`](2026-05-26-pi-cursor-sdk-inhouse-options.md) |
| `packages/planner` build export | Watch | Ensure `npm run build` emits `dist/build` |

## Code-judo (post-merge, not blockers)

- **Keep:** mock doctor deps in tests (CI-safe pattern).
- **Delete:** unreachable `deferred` branch in build loop when touching orchestrate.
- **Defer extract:** `FoundryAgentClient` until after merge + G4.
- **Harden:** resume should not full re-orchestrate; proof from agent output; review gate on hot path.

## Spaghetti / scope

- Build worker uses **mock agent by default** — acceptable for V3 MVP slice; not production build.
- Review gate exists in tests but **bypassed** via `autoApproveReview` on default deps.
- No Pi subprocess in build path — aligns with Pi-external grill.

## Waive list (explicit — required for merge sign-off)

| Waive | Owner / when |
|-------|----------------|
| Mock agent + auto-review as default for `foundry build` | Post-merge: wire real agent before treating G4 build tiers as “live” |
| Review gate not enforced on `executeBuild` hot path | Same |
| Dual Cursor APIs (plan vs build) | Post-V3 unify per in-house options doc |
| `resume` re-enters full `executeBuild` | Harden when adding failure/retry tests |

## Post-merge requirements

- **G3** — full `npm test` on `main`
- **G4** — **complete** exhaustive catalog in `docs/planning/LIVE_VERIFICATION.md`; log in `docs/superpowers/specs/2026-05-26-live-verification-log.md`
- **Do not close #21–#30** until **G3 + G4 complete** (not “G4 started”)
