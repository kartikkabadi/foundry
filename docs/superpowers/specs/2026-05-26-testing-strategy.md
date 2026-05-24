# Foundry testing strategy (2026-05-26)

**Effort budget (implementation after alignment):** ~50% of engineering time on tests + verification.

| Bucket | Share | Focus |
|--------|-------|-------|
| V1/V2 holes | 35% | Schema, run-store, doctor JSON, publish gates |
| Harness quality | 25% | CLI integration, fixtures, mock doctor deps |
| V3 build | 25% | issue-plan graph, worker, autonomy, resume |
| Red-team | 15% | Composer policy, secrets in events, non-TTY publish |

## Priority tiers

### P0 — must pass in CI on every PR

| Area | Files |
|------|-------|
| CLI surface | `tests/cli.test.ts` |
| Run state | `tests/run-writer.test.ts`, `tests/schema-validation.test.ts` |
| Doctor | `tests/doctor.test.ts`, `tests/doctor-expanded.test.ts` |
| Plan | `tests/plan.test.ts`, `tests/plan-resume.test.ts` |
| Approve/build gate | `tests/approve.test.ts` (main); `tests/build-preflight.test.ts` (**after PR #98** on `main`) |
| Boundaries | `tests/package-boundaries.test.ts` |
| Secrets | `tests/config-secrets.test.ts` |
| Scripts | `scripts/demo.sh` (CI), `scripts/demo-build.sh` (V3) |

### P1 — V3 PR #98 delta

`tests/build-*.test.ts`, `tests/issue-plan-graph.test.ts`, `tests/worktree-adapter.test.ts`, `tests/proof-registry.test.ts`, `tests/orchestrator-review.test.ts`

### P2 — adapter parity (post-merge)

- `tests/cursor-adapter.test.ts` (new) — auth order, model IDs, smoke token, no network
- Fixture vectors aligned with pi-cursor-sdk behavior

### P3 — live / opt-in

- `FOUNDRY_DEMO_LIVE_PLAN=1` / `scripts/rehearsal-live.sh`
- G4 catalog in `docs/planning/LIVE_VERIFICATION.md` — **release rehearsal**, not required to close #30 AC alone

## CI matrix (current + proposed)

| Job | Today | Proposed |
|-----|-------|----------|
| `verify` | `npm ci`, typecheck, test, build, `demo.sh` | `demo.sh` + `FOUNDRY_BUILD_MOCK=1 demo-build.sh` |

**Build preflight policy:** `resolvePreflightOptions` — `plan` always `deep: true`; `build` uses `deep: true` unless `FOUNDRY_BUILD_MOCK=1` (CI/demo). Real `foundry build` without mock requires Composer smoke.
| Node | `.nvmrc` (20) | Stay on 20 until slice C bump |
| Live Composer | not in CI | optional nightly workflow |

## TDD discipline gaps

- Several V3 modules landed with tests in same PR — acceptable for vertical slice; **post-merge**: add red-first evidence for P0 holes listed in TRACKER_ALIGNMENT.
- AC in `V2-V5_GITHUB_ISSUES.md` should name concrete `tests/*.test.ts` in **Test proof** sections (Matt Pocock template).

## Red-team catalog

**Live checklist SSOT:** `docs/planning/LIVE_VERIFICATION.md` Tier C (do not duplicate tiers here).

1. Composer 2.5 only on plan/build — no silent fallback (`doctor` + adapter).
2. `foundry publish` non-TTY deny.
3. No secrets in `.foundry/runs/*/events.jsonl` — grep gate in G4.
4. `build` approval gate — unapproved must fail before doctor (see `approve.test.ts`).
