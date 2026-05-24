# Post-alignment thermo review (2026-05-25)

**Scope:** PR1 (`chore/g4-evidence-and-alignment-docs`) + PR2 (`fix/post-g4-preflight-ci-tracker`) vs `main` @ `c433096`.

**Verdict:** **Approve alignment slice** — no structural regression; P0 CI breaker avoided via `resolvePreflightOptions`.

## Findings (ranked)

### Strong (positive)

| Finding | Notes |
|---------|-------|
| `resolvePreflightOptions` | Code-judo vs blind `deep: true`; one policy module for plan + build |
| `g4-log.sh` | Thin SSOT for batch + live log sections — not wrapper spam |
| PR1/PR2 split | Docs/scripts vs policy/CI — correct boundaries |

### Moderate (defer — waive)

| Finding | Waive until |
|---------|-------------|
| `nextPendingIssue` ignores `blocked_by` | V4 Task 0 |
| Resume full `executeBuild` re-entry | V4 Task 0 |
| `run-store.ts` ~466 LOC | V4 Task 0.3 or parallel work |
| Mock build agent + placeholder proofs | V4+ production build |
| No build-review CLI | V4 orchestration |
| Serial-only orchestration | V4-1 |

### None — blockers

No file >1k LOC in diff. No new spaghetti branches in orchestrate beyond env-gated `deep`.

## Waive list (alignment slice)

- `FOUNDRY_BUILD_MOCK=1` in CI for `demo-build.sh` (not live Composer in GHA)
- `g4-live-rehearsal.sh` opt-in locally (auth required)
- Kartik production-truth checkbox unchecked
- V4-1 code not in this slice
- Carry forward PR #98 thermo waives until Task 0 GREEN

## PR2 delta vs architecture audit

| Audit item | After PR2 |
|------------|-----------|
| Build preflight skips Composer | **Fixed** for real builds; mock path explicit |
| `demo-build` not in CI | **Fixed** |
| Tracker doc drift | **Fixed** in issue-tracker + TRACKER_ALIGNMENT |

## Approval bar for V4-1 code

Requires: this doc + Kartik G4 production-truth + **V4 Task 0** tests GREEN.
