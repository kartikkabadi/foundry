# Foundry

> **Hackathon demo branch** — not V1 complete. See [Hackathon waivers](#hackathon-waivers) below.

Foundry is a planning-first Pi setup/runtime that uses Cursor Composer 2.5 as the v1 model and adds deterministic setup checks, structured planning, and approval-aware multi-agent workflows.

## Hackathon waivers

This repo may ship a **hackathon demo subset** before full V1. Do not claim V1 complete until these are resolved:

- **Algorithm Pass:** single `algorithm-pass.md` summary (not the full multi-file pass set)
- **`foundry setup`:** stub — use `foundry doctor --for plan`; full setup is [Issue #3](https://github.com/kartikkabadi/foundry/issues/3)
- **Issues #7–#8:** partial — `foundry publish` local drafts + approval-gated `gh issue create`; `scripts/install.sh` + CI smoke (no live Composer in CI)
- **`pause` / `resume`:** stub or best-effort with "not in hackathon" label

**Non-waivable:** Composer 2.5 Standard only (no model fallback); doctor is source of truth; plan stops before build; no secrets in artifacts; `.foundry/` gitignored.

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
- Doctor/plan resolve the key via `src/config/cursor-auth.ts` (env → Pi auth)

## V1 Goal

The first public version should prove one path:

```text
install Foundry
run foundry setup
verify Pi + Cursor Composer 2.5 Standard
run foundry plan on a rough software idea
produce summary, PRD, implementation plan, issue plan, and build goal
stop for approval
```

## Hackathon demo (live rehearsal)

Canned demo idea: **"CLI that converts markdown PRDs to GitHub issues"**

```bash
export CURSOR_API_KEY="your-key"   # optional if Pi auth configured; never commit
# or rely on Pi: ~/.pi/agent/auth.json (cursor provider)
npm install && sfw npm install && npm rebuild sqlite3 && npm run build && npm link
foundry init
foundry doctor --for plan --deep    # hard gate: Composer smoke (60s timeout)
foundry plan "CLI that converts markdown PRDs to GitHub issues"
foundry publish                     # local issue drafts
foundry publish --approve           # approval-gated gh issue create
# → artifacts under .foundry/runs/<run-id>/ ; "Plan complete — approve to continue"
```

**Install from GitHub (Issue #8 subset):**

```bash
bash scripts/install.sh
```

CI-safe skeleton (no live Composer):

```bash
bash scripts/demo.sh
```

Live plan in demo script (optional):

```bash
export CURSOR_API_KEY="your-key"
export FOUNDRY_DEMO_LIVE_PLAN=1
bash scripts/demo.sh
```

**Live-only requirements:** Cursor API key (env or Pi auth), `pi` CLI, `@cursor/sdk` with rebuilt `sqlite3`, passing `foundry doctor --for plan --deep`.

## Current Status

Planning repository with hackathon demo on `hackathon/integration` (Issues #1–#6 subset).

**Repo Alignment (2026-05):**

- **Pi Extension Pack (powerpack)** = guide-style + curated assets. Local clone at `documents/Projects/pi-composer-powerpack`.
- **Foundry (this repo)** = multi-agent planning/build runtime per full V1 spec. GitHub: 8 issues published.
- Both active, cross-linked. See DECISIONS.md for the locked alignment section.

Start here:

- [V1 plan](docs/planning/V1_PLAN.md)
- [Decision log](docs/planning/DECISIONS.md)
- [Running spec](docs/planning/RUNNING_SPEC.md)
- [GitHub issue breakdown](docs/planning/GITHUB_ISSUE_BREAKDOWN.md) — **full AC for issues #1–#8**

## Getting started (dev)

```bash
sfw npm install
npm run build
npm link   # optional — exposes `foundry` globally
foundry --help
foundry init
```

Hackathon demo rehearsal (skeleton; later phases may skip until shipped):

```bash
bash scripts/demo.sh
```

## Core Constraints

- Composer 2.5 only in v1.
- Composer 2.5 Standard by default.
- Composer 2.5 Fast requires explicit per-run approval.
- No premium model fallback in v1.
- `doctor` is the deterministic source of truth for setup/runtime readiness.
- Plan Mode stops for approval before Build Mode.
