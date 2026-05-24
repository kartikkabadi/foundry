# Live verification catalog (G4 SSOT)

**Purpose:** Kartik-signed **release rehearsal** beyond locked V1 verification and [#30](https://github.com/kartikkabadi/foundry/issues/30) fixture CI. Closing #30 does **not** require completing every row here — link this doc from #30 as extended gate before calling `main` production-truth.

**Runtime:** Use **repo-pinned Node** (currently **20** per `.nvmrc` / `package.json` `engines`) until Node 22.19+ bump (post-swarm slice C + DECISIONS entry).

**Environment:** Isolated temp worktree; `sfw npm ci`; Pi + Cursor auth configured.

**Evidence log (append-only):** `docs/superpowers/specs/2026-05-26-live-verification-log.md` — command, exit code, artifact paths, screenshots. **Do not duplicate this checklist in the log.**

---

## Tier A — CLI surface

| Command | Modes / flags |
|---------|----------------|
| `foundry --version`, `--help` | baseline |
| `foundry doctor` | human + `--json`; `--for setup` / `--for build` / `--for plan` |
| `foundry doctor --fix` | Foundry-owned repairs only |
| `foundry setup` | recommended + expert; non-TTY |
| `foundry init` | fresh `.foundry/` |
| `foundry plan` | rough idea; budget profiles; pause/resume |
| `foundry approve` | gate before build |
| `foundry publish` | local drafts; non-TTY deny; approval-gated `gh` |
| `foundry build` | preflight; `--dry-run`; serial path; pause/resume |
| `foundry status`, `pause`, `resume` | active + completed runs |

## Tier B — Plan / build artifacts

- V1 artifacts: `summary.md`, `prd.md`, `implementation-plan.md`, `issue-plan.md`, `build-goal.md`
- `run.json`, `status.md`, `events.jsonl` consistent per phase
- Post-approve build: proofs per issue type; worktree isolation; orchestrator review (HITL documented)

## Tier C — Policy / red-team live

- Composer **2.5 Standard** only on plan/build; fast only with explicit flag + approval
- Hard-fail when Composer unavailable (doctor guidance)
- Secrets absent from `.foundry/runs/*` (grep gate)

## Tier D — Ecosystem parity

| Check | Scope |
|-------|--------|
| Pi + pi-cursor-sdk smoke | `pi --model cursor/composer-2.5` + powerpack path in log |
| Auth parity | Foundry plan without manual `export CURSOR_API_KEY` when Pi auth set |
| Doctor matrix | Each required check for `plan` and `build` once live |

**Out of scope:** full powerpack extension matrix — powerpack’s own checklist (V5-9).

## Tier E — Scripts

- `scripts/demo.sh`
- `scripts/demo-build.sh` (post-V3)
- `scripts/fixture-plan-smoke.ts`
- `scripts/rehearsal-live.sh` (opt-in live plan)

---

## Owners / estimates (placeholder)

| Tier | Owner | Estimate |
|------|-------|----------|
| A | Release driver | 2–4 h |
| B | Release driver | 2–3 h |
| C | Security pass | 1 h |
| D | Integration | 1–2 h |
| E | CI parity | 30 m |

**Gate:** G4 runs **after merge** only (`merge PR #98` → G3 `npm test` on `main` → G4 exhaustive log).
