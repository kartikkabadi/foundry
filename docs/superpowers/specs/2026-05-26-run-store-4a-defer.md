# Run-store split (Phase 4a) — deferred

**Decision:** Task 0.3 defer stands (~466 LOC in `run-store.ts`, under 1k rule).

**V4-1 constraint:** Parallel build uses existing `writeRunState` only; no ad-hoc `run.json` writes in the wave executor.

**Follow-up:** Split `run-store-read.ts` / `run-store-write.ts` before high-concurrency production builds if write contention appears.
