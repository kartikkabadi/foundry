# ADR 0000: pi-cursor-sdk and powerpack gate (draft)

**Status:** Draft — review only; do not implement forks without thermo review + explicit approval.

## Context

- [DECISIONS.md](../planning/DECISIONS.md) states Foundry is a **full Pi setup/runtime**, planning-first, with Pi CLI healthy in recommended stack.
- Grill (2026-05-24) locks **Pi external** for v1 implementation: adapters + doctor `pi-cli`, **no Pi core fork** without ADR.
- Powerpack ([pi-composer-powerpack](https://github.com/kartikkabadi/pi-composer-powerpack)) is **guide/fork only** — no npm dependency from Foundry.

## Decision (proposed)

1. **Foundry CLI** integrates Cursor via `@cursor/sdk` in `packages/adapters` (extract-first; see `2026-05-26-pi-cursor-sdk-inhouse-options.md`).
2. **pi-cursor-sdk** remains the Pi-side provider; Foundry matches **behavior** (auth, Composer 2.5 policy, smokes), not code copy.
3. **Pi core fork** — blocked unless ADR supersedes this draft with thermo evidence.
4. **pi-cursor-sdk fork** — allowed only for Pi/powerpack hooks that cannot live upstream or in Foundry adapters; requires deletion test and shared test vectors.
5. **G4 ecosystem check** — document `pi --model cursor/composer-2.5` smoke in live log; do **not** run full powerpack extension matrix in Foundry CI.

## Reconciliation: "full Pi runtime" vs "Pi external"

| Interpretation | Meaning for Foundry |
|----------------|---------------------|
| Product identity | Foundry installs/configures Pi ecosystem via `setup`/`doctor`; user can use Pi alongside |
| Implementation | No Pi subprocess in plan/build on v1 path; doctor verifies `pi-cli` |
| V4-10 (#40) | Future **Pi runtime adapter** — explicit milestone, not v1 fork |

## Consequences

- Doctor keeps `pi-cli` as required for `foundry plan` where spec says so; build may add `pi-runtime` when #40 lands.
- V5-9 (#49) documents powerpack install path; cross-links `LIVE_VERIFICATION.md` Tier D.
- Silent Cursor model fallback remains **P0 forbidden** (DECISIONS + RUNNING_SPEC).

## Open questions

- Upstream PR vs `kartikkabadi` fork for pi-cursor-sdk if powerpack must diverge.
- Whether shared npm package replaces re-export in powerpack.
