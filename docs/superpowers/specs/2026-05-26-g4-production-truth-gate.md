# G4 production-truth gate (HITL)

**Status:** Awaiting Kartik sign-off (agent cannot check the box).

**Checkbox SSOT:** [live-verification-log.md](./2026-05-26-live-verification-log.md) — line `Kartik sign-off for production-truth` must be checked by Kartik only.

**Checklist reference:** [LIVE_VERIFICATION.md](../../planning/LIVE_VERIFICATION.md)

## What is done (evidence)

- G3 `npm test` green on `main` (144+ tests after alignment #101)
- Tier E batch via `scripts/g4-batch-verify.sh`
- Tier A–D live rows logged in live verification log
- Alignment stack merged: PR #99, #100, #101 → `main`

## What blocks V4 product code

Per [mission-alignment.md](./2026-05-26-foundry-mission-alignment.md):

1. **Production-truth** checkbox (this document)
2. **V4 Task 0** orchestration tests GREEN on `main`
3. **4a** run-store split if Task 0.3 deferred (before V4-1 parallel)

## Agent actions after Kartik checks the box

1. Open a small doc PR quoting the checked state (do not forge the checkbox).
2. Proceed with Task 0 / V4-1 merge gates per [v4-1-parallel-build.md](../plans/2026-05-26-v4-1-parallel-build.md).
