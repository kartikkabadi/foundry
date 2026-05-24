# Foundry

Foundry is a planning-first Pi setup/runtime that uses Cursor Composer 2.5 as the v1 model and adds deterministic setup checks, structured planning, and approval-aware multi-agent workflows.

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

Planning repository. Small parallel steps active for first milestone (clear separation in docs + hygiene baseline).

**Repo Alignment (2026-05, per user clarification)**: 
- **Pi Extension Pack (powerpack)** = pure guide-style + curated assets / whole Git repo (agent-feedable). Local clone at `documents/Projects/pi-composer-powerpack`. See its updated README for "feed this repo to your agent" instructions + the 10 coverage questions + cross-link here.
- **Foundry (this repo)** = rock-solid, detailed multi-agent planning/build runtime per full V1 spec. This local clone + GH (8 issues published).
- Both active, cross-linked, with clear roles (powerpack = the polished Pi setup guide layer; Foundry = the higher-level runtime that uses it). See DECISIONS.md for the full locked alignment section (includes user quotes).

Start here:

- [V1 plan](docs/planning/V1_PLAN.md)
- [Decision log](docs/planning/DECISIONS.md) (now includes Repo Alignment section)
- [Running spec](docs/planning/RUNNING_SPEC.md)
- [GitHub issue breakdown](docs/planning/GITHUB_ISSUE_BREAKDOWN.md)

Local clones preflighted with git discipline. Both READMEs + planning updated for alignment. Next: hygiene (AGENTS.md) + small impl steps.

## Core Constraints

- Composer 2.5 only in v1.
- Composer 2.5 Standard by default.
- Composer 2.5 Fast requires explicit per-run approval.
- No premium model fallback in v1.
- `doctor` is the deterministic source of truth for setup/runtime readiness.
- Plan Mode stops for approval before Build Mode.

