# Foundry

Foundry is a planning-first Pi setup/runtime that uses Cursor Composer 2.5 as the v1 model and adds deterministic setup checks, structured planning, and approval-aware multi-agent workflows.

## Environment

Foundry uses the Cursor SDK for Composer 2.5 checks and plan mode.

**Node:** use Node 20 (see `.nvmrc`). Foundry pins `engines.node` to `>=20 <23`.

**Cursor API key** (resolution order):

1. `CURSOR_API_KEY` environment variable
2. Pi stored key at `~/.pi/agent/auth.json` (`cursor` provider)

```bash
export CURSOR_API_KEY="your-key"   # optional if Pi auth is configured
```

**Secrets policy:**

- Never log `CURSOR_API_KEY` or echo it in CLI output
- Never write API keys into `.foundry/` artifacts, `run.json`, or committed files
- Doctor/plan resolve the key via `packages/core/src/config/cursor-auth.ts` (env → Pi auth)

## V1 Success Case

```text
install Foundry
run foundry setup
verify Pi + Cursor Composer 2.5 Standard
run foundry plan on a rough software idea
produce summary, PRD, implementation plan, issue plan, and build goal
stop for approval
```

## Quick start

**Install from GitHub:**

```bash
bash scripts/install.sh
```

**Dev install:**

```bash
sfw npm install
npm run build
npm link   # optional — exposes `foundry` globally
foundry --help
foundry init
foundry setup
foundry doctor --for plan --deep
foundry plan "CLI that converts markdown PRDs to GitHub issues"
foundry publish                     # local issue drafts
foundry publish --approve           # approval-gated gh issue create
```

Example idea: **"CLI that converts markdown PRDs to GitHub issues"**

Artifacts land under `.foundry/runs/<run-id>/`:

- Intake, research, intent (10 coverage slots)
- Algorithm Pass: `requirements.md`, `deletion-pass.md`, `minimum-system.md`, `simplification-pass.md`, `acceleration-pass.md`, `automation-pass.md`, `assumptions.md`, `decisions.md`, `risks.md`
- Planning: `summary.md`, `prd.md`, `implementation-plan.md`, `issue-plan.md`, `build-goal.md`, `autonomy-contract.md`

## Commands

| Command | Description |
|---------|-------------|
| `foundry init` | Create `.foundry/config.toml` and runs layout |
| `foundry doctor` | Capability checks (source of truth) |
| `foundry doctor --fix` | Repair Foundry-owned local state only |
| `foundry setup` | Doctor-guided setup loop (`--recommended` default, `--expert`) |
| `foundry plan "<idea>"` | Full planning workflow; stops at approval |
| `foundry publish` | Convert `issue-plan.md` to drafts |
| `foundry publish --approve` | Approval-gated GitHub issue creation |
| `foundry status` | Show current/latest run |
| `foundry pause` / `resume` | Pause and resume foreground runs |

## Verification

```bash
npm run typecheck && npm test && npm run build
bash scripts/demo.sh                    # CI-safe smoke
FOUNDRY_DEMO_LIVE_PLAN=1 bash scripts/demo.sh   # optional live Composer
```

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for Pi, Cursor, Composer, GitHub, and Node/sqlite3 failures.

## Core Constraints

- Composer 2.5 only in v1 — no model fallback
- Composer 2.5 Standard by default; Fast requires explicit per-run approval
- `doctor` is the deterministic source of truth
- Plan Mode stops for approval before Build Mode
- GitHub issue creation is approval-gated

## V1 Non-Goals

- Full autonomous Build Mode execution
- Background daemon/job runner
- Premium model integrations
- Automatic GitHub issue creation without approval

## Documentation

- [V1 plan](docs/planning/V1_PLAN.md)
- [Running spec](docs/planning/RUNNING_SPEC.md)
- [Decision log](docs/planning/DECISIONS.md)
- [GitHub issue breakdown](docs/planning/GITHUB_ISSUE_BREAKDOWN.md)

## Current Status

**Shipped on `main`:** V1 (#1–#8), V2 (#11–#20), and V3 (#21–#30) — planning, publish, and serial build with proofs. Verified: `npm test` (156+ pass @ `0fbd325`).

**Open work:** V4 (#31–#40) and V5 (#41–#50). Canonical tracker: [issues #31–#50](https://github.com/kartikkabadi/foundry/issues?q=is%3Aissue+is%3Aopen). Code↔test map: [VERIFIED_STATE.md](docs/planning/VERIFIED_STATE.md).

**Repo alignment (2026-05):**

- **Pi Extension Pack (powerpack)** = guide-style + curated assets
- **Foundry (this repo)** = multi-agent planning/build runtime per V1 spec
