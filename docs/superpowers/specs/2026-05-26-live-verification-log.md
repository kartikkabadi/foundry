# G4 live verification log (evidence only)

**Checklist SSOT:** `docs/planning/LIVE_VERIFICATION.md` — do not duplicate tiers here.

**Status (2026-05-24):** **Evidence logged** for live plan/approve/build + Tiers B–E. **G4 complete** per automated + live rows below (auth present; no SKIP-with-auth). **Production-truth** still requires Kartik sign-off checkbox only.

## Run metadata

| Field | Value |
|-------|-------|
| Date | 2026-05-25 |
| Operator | Foundry agent + Kartik |
| Git SHA (`main`) | `c4330968c082747a1a9874154bc59c3cf8120fec` |
| Node version | 20 per `.nvmrc` (batch ran on v24.14.1) |
| Worktree path | temp project under `mktemp` via `scripts/g4-live-rehearsal.sh` |
| Canonical live run | `f313c3de-a3d0-474f-956f-fe5e672dcb57` (temp dir removed after run) |

## Sign-off (three levels)

| Level | Meaning |
|-------|---------|
| Evidence logged | Rows in tables below with exit codes / artifact paths |
| G4 complete | Tiers A–E addressed per LIVE_VERIFICATION.md (or auth FAIL documented) |
| Production-truth | **Kartik** checks this box only |

- [x] G3: `npm test` on `main` green (140+ pass)
- [x] Tier E automated batch (regenerate via `scripts/g4-batch-verify.sh`)
- [x] Tier A live plan + approve + live build (no mock)
- [x] Tier B artifact usefulness
- [x] Tier C secrets grep on real run dir
- [x] Tier D `pi --model cursor/composer-2.5`
- [ ] Kartik sign-off for production-truth

**Regenerate automated:** `bash scripts/g4-batch-verify.sh`  
**Regenerate live:** `bash scripts/g4-live-rehearsal.sh`

## Entries (live phased) 2026-05-24T18:29Z

| Tier | Command | Exit | Artifacts / notes |
|------|---------|------|-------------------|
| A | `doctor --for plan --deep` | 0 | Foundry doctor (for=plan) |
| A | `doctor --for build --deep` | 0 | Foundry doctor (for=build) |
| A | `foundry plan (live)` | 0 | fixture-plan-smoke → git init; Composer plan ~4m; run `f313c3de-a3d0-474f-956f-fe5e672dcb57` |
| B | `artifact checklist` | 0 | summary.md, prd.md, issue-plan.md, build-goal.md, run.json + 3 more under run dir |
| A | `foundry approve` | 0 | Plan approved. |
| A | `foundry build (live, no mock)` | 0 | HITL build_review pause (expected pass; real agent, no FOUNDRY_BUILD_MOCK) |
| C | `secrets grep` | 0 | no obvious secrets in run dir |
| D | `pi --model cursor/composer-2.5` | 0 | `pi --help` OK; `/Users/user/.local/bin/pi` (redirect typo fixed in script) |







## Entries (automated batch) 2026-05-24T20:05Z

| Tier | Command | Exit | Artifacts / notes |
|------|---------|------|-------------------|
