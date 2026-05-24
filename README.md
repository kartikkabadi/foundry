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

Planning repository. No implementation has started yet.

Start here:

- [V1 plan](docs/planning/V1_PLAN.md)
- [Decision log](docs/planning/DECISIONS.md)
- [Running spec](docs/planning/RUNNING_SPEC.md)
- [GitHub issue breakdown](docs/planning/GITHUB_ISSUE_BREAKDOWN.md)

## Core Constraints

- Composer 2.5 only in v1.
- Composer 2.5 Standard by default.
- Composer 2.5 Fast requires explicit per-run approval.
- No premium model fallback in v1.
- `doctor` is the deterministic source of truth for setup/runtime readiness.
- Plan Mode stops for approval before Build Mode.

