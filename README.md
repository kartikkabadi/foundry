# Foundry

> **Hackathon demo branch** — not V1 complete. See [Hackathon waivers](#hackathon-waivers) below.

Foundry is a planning-first Pi setup/runtime that uses Cursor Composer 2.5 as the v1 model and adds deterministic setup checks, structured planning, and approval-aware multi-agent workflows.

## Hackathon waivers

This repo may ship a **hackathon demo subset** before full V1. Do not claim V1 complete until these are resolved:

- **Algorithm Pass:** single `algorithm-pass.md` summary (not the full multi-file pass set)
- **`foundry setup`:** stub — use `foundry doctor --for plan`; full setup is [Issue #3](https://github.com/kartikkabadi/foundry/issues/3)
- **Issues #7–#8:** deferred (approval-gated publish, installer/CI smoke)
- **`pause` / `resume`:** stub or best-effort with "not in hackathon" label

**Non-waivable:** Composer 2.5 Standard only (no model fallback); doctor is source of truth; plan stops before build; no secrets in artifacts; `.foundry/` gitignored.

## Environment

Foundry uses the Cursor SDK for Composer 2.5 checks and plan mode. Set:

```bash
export CURSOR_API_KEY="your-key"
```

**Secrets policy:**

- Never log `CURSOR_API_KEY` or echo it in CLI output
- Never write API keys into `.foundry/` artifacts, `run.json`, or committed files
- Doctor/plan read the key from the environment only

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

## Current Status

Planning repository with CLI bootstrap (Issue #1) in progress on `hackathon/integration`.

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
