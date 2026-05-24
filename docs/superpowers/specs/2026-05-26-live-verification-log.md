# G4 live verification log (evidence only)

**Checklist SSOT:** `docs/planning/LIVE_VERIFICATION.md` — do not duplicate tiers here.

**Status:** Automated G4 batch complete; **live Composer plan/build + Tier D/C manual** pending Kartik sign-off.

## Run metadata

| Field | Value |
|-------|-------|
| Date | 2026-05-24 |
| Operator | Foundry agent (automated batch) |
| Git SHA (`main`) | post PR #98 + honest-build + FoundryAgentClient |
| Node version | 20 (`.nvmrc`; batch may run on newer Node locally) |
| Worktree path | repo root + temp dirs for init |

## Sign-off

- [x] G3: `npm test` on `main` green (**140 pass**, 2026-05-24)
- [x] Tier E: `npm test`, `demo.sh`, `demo-build.sh` (automated)
- [x] Tier A (partial): version, help, doctor json plan/build, init
- [ ] Tier A (live): `foundry plan`, `foundry build` without mock — manual in isolated worktree
- [ ] Tier B: artifact usefulness after live plan
- [ ] Tier C: secrets grep after live runs
- [ ] Tier D: Pi + pi-cursor-sdk smoke
- [ ] Kartik sign-off for production-truth

## Entries (automated batch 2026-05-24T18:10Z)

| Tier | Command | Exit | Artifacts / notes |
|------|---------|------|-------------------|
| E | `npm test` | 0 | 140 tests pass |
| E | `scripts/demo.sh` | 0 | CI fixture plan path |
| E | `scripts/demo-build.sh` | 0 | `FOUNDRY_BUILD_MOCK=1` |
| A | `foundry --version` | 0 | |
| A | `foundry --help` | 0 | |
| A | `doctor --json --for plan` | 0 | |
| A | `doctor --json --for build` | 0 | |
| A | `foundry init` | 0 | temp project |
| A | `foundry plan (live)` | SKIP | run manually; auth may be present |
| A | `foundry build (live, no mock)` | SKIP | `FOUNDRY_BUILD_MOCK` unset; review gate |
| D | `pi-cursor-sdk smoke` | SKIP | `pi --model cursor/composer-2.5` |
| C | `secrets grep .foundry/runs` | SKIP | after live plan |

**Regenerate:** `bash scripts/g4-batch-verify.sh` appends rows; edit this file for manual live results.
| E | `npm test` | 0 | stdout+stderr captured |
| E | `scripts/demo.sh` | 0 | stdout+stderr captured |
| E | `scripts/demo-build.sh` | 0 | stdout+stderr captured |
| A | `foundry --version` | 0 | stdout+stderr captured |
| A | `foundry --help` | 0 | stdout+stderr captured |
| A | `doctor --json --for plan` | 0 | stdout+stderr captured |
| A | `doctor --json --for build` | 0 | stdout+stderr captured |
| A | `foundry init` | 0 | stdout+stderr captured |
| A | `foundry plan (live)` | SKIP | auth present; run manually in isolated worktree |
| A | `foundry build (live, no mock)` | SKIP | run after approve; FOUNDRY_BUILD_MOCK unset |
| D | `pi-cursor-sdk smoke` | SKIP | manual: pi --model cursor/composer-2.5 |
| C | `secrets grep .foundry/runs` | SKIP | run after live plan in worktree |
