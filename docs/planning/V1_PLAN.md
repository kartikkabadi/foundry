# Foundry V1 Plan

Created: 2026-05-24

## Goal

Build the smallest public Foundry release that proves the core value: a user can install Foundry, verify Pi + Cursor Composer 2.5 Standard, run a planning workflow on a rough software idea, and receive a useful summary, PRD, implementation plan, issue plan, and build goal.

## V1 Success Case

```text
User installs Foundry.
User runs foundry setup.
Foundry confirms Composer 2.5 Standard works.
User runs foundry plan on a rough software idea.
Foundry researches the idea.
Foundry asks a small set of strong intent questions.
Foundry runs Auto Plan Mode.
Foundry writes summary.md, prd.md, implementation-plan.md, issue-plan.md, build-goal.md.
Foundry stops for approval.
```

V1 is successful if this flow works reliably and produces planning artifacts that are genuinely useful.

## V1 Scope

Foundry v1 includes:

- Standalone TypeScript/Node CLI.
- GitHub installer first, npm package later.
- `foundry doctor`.
- `foundry setup`.
- `foundry init`.
- `foundry plan`.
- `foundry status`.
- `foundry pause`.
- `foundry resume`.
- Composer 2.5 exclusive model policy.
- Composer 2.5 Standard as the default and required planning model.
- Composer 2.5 Fast as explicit per-run opt-in only.
- Deterministic capability checks.
- Agent-guided setup loop over doctor results.
- Project `.foundry/` run folder.
- Machine `~/.foundry/` config/capability state.
- Planning artifacts.
- `run.json` and `status.md`.
- Basic approval/autonomy contract.
- Local Markdown issue-plan generation.
- GitHub issue-plan draft generation, with actual GitHub issue creation gated behind approval.

## V1 Non-Goals

Foundry v1 does not need:

- Full autonomous Build Mode execution.
- Background daemon/job runner.
- Full TUI.
- Premium model integrations.
- GPT/Opus reviewer support.
- Non-Composer fallback model support.
- Automatic public repo creation.
- Automatic GitHub issue creation without approval.
- Automatic package publishing.
- Global Pi/Cursor config edits without explicit approval.
- Deep CuaDriver automation as a hard dependency.
- Complex multi-day swarm orchestration.

Important constraint: `foundry build` can exist as a later command target, but the first public success case stops at an approved build-ready plan. V1 should not become a Codex CLI clone.

## Architecture Sketch

```text
packages/cli
  command parsing and terminal UX

packages/core
  run state, config resolution, policies, artifact writing

packages/doctor
  deterministic capability checks

packages/adapters
  Pi, Cursor SDK, GitHub, git/worktree, browser, CuaDriver

packages/planner
  intake, research orchestration, interview, Algorithm Pass, artifact synthesis

packages/schemas
  run.json, doctor JSON, config, team packs, autonomy policy
```

This should stay modular, but not over-abstracted. Adapters exist because external tools differ. Everything else should remain simple until real complexity appears.

## Commands

```text
foundry doctor
foundry doctor --json
foundry doctor --deep
foundry doctor --for setup|plan|build|reference-capture

foundry setup
foundry setup --recommended
foundry setup --expert

foundry init
foundry plan
foundry status
foundry pause
foundry resume
foundry resume <run-id>
```

## Doctor V1

`doctor` is the source of truth for readiness.

Check groups:

```text
system
node-package-manager
foundry-install
pi-cli
pi-runtime
cursor-sdk
composer-2.5-standard
composer-2.5-fast
git-github
git-worktrees
browser-capture
cuadriver-computer-use
skills-team-packs
project-foundry-config
```

Status codes:

```text
ready
missing
needs_auth
needs_permission
needs_update
misconfigured
skipped
failed
unknown
```

Exit codes:

```text
0 = required checks passed
1 = required check failed
2 = doctor itself failed or produced untrusted results
```

Default doctor is fast and cheap. `--deep` runs stronger smoke tests.

## Setup V1

`setup` is an agent-guided loop over doctor:

```text
run doctor
summarize missing capabilities
fix next capability in dependency order
run doctor again
repeat
```

Dependency order:

```text
system
node-package-manager
foundry-install
pi-cli
pi-runtime
cursor-sdk
composer-2.5-standard
git-github
git-worktrees
browser-capture
cuadriver-computer-use
skills-team-packs
project-foundry-config
```

`doctor --fix` can repair safe Foundry-owned local state. Installs, global config edits, permission changes, and Pi/Cursor edits require explicit approval or setup guidance.

## Plan V1

`foundry plan` should implement the first public success case.

Flow:

```text
preflight doctor --for plan
create run folder
write run.json and status.md
capture rough idea
ask 2-3 broad intake questions
run research/exploration
ask intent interview questions using the 10 coverage slots
run Algorithm Pass
write artifacts
show summary
stop for approval
```

Question policy:

- Ask intent/product-boundary questions.
- Avoid low-level implementation questions.
- Let agents resolve implementation details from repo conventions, research, and defaults.

## Required Artifacts

For v1 plan runs:

```text
.foundry/runs/<run>/
  run.json
  status.md
  intake.md
  research.md
  intent.md
  requirements.md
  deletion-pass.md
  minimum-system.md
  simplification-pass.md
  acceleration-pass.md
  automation-pass.md
  assumptions.md
  decisions.md
  risks.md
  summary.md
  prd.md
  implementation-plan.md
  issue-plan.md
  build-goal.md
  autonomy-contract.md
```

Optional in v1:

```text
reference-analysis.md
comms/events.jsonl
comms/threads/*.md
conflicts/*.md
```

## Run State

Every run writes `run.json`.

Minimum fields:

```json
{
  "run_id": "...",
  "foundry_version": "...",
  "mode": "plan",
  "budget": "quick",
  "status": "running",
  "phase": "research",
  "composer_speed": "standard",
  "created_at": "...",
  "updated_at": "...",
  "agent_pass_budget": {
    "max_active": 5,
    "used": 0,
    "limit": 12
  },
  "artifacts": [],
  "blocked_actions": [],
  "next_actions": []
}
```

## Approval Boundary

V1 should support a simple autonomy contract:

```text
safe
productive
custom
```

Default: `productive`.

Allowed by default:

- Read local repo files.
- Search public docs/GitHub/web.
- Write `.foundry` artifacts.
- Run cheap local checks.

Ask first:

- Package installs.
- Global config edits.
- GitHub issue creation.
- Commits/pushes/PRs.
- Composer Fast.
- Destructive operations.
- Secret/private session access.

## Milestones

### Milestone 1: CLI Skeleton

- Create TypeScript CLI.
- Add command parser.
- Add config directory creation.
- Add `foundry --version`.
- Add basic test harness.

### Milestone 2: Doctor

- Implement doctor check schema.
- Implement human output.
- Implement `--json`.
- Implement exit codes.
- Implement fast checks for Foundry, Node, Pi, Cursor SDK, Composer 2.5 Standard, git, and project config.

### Milestone 3: Setup

- Implement setup as a loop over doctor results.
- Add dependency-ordered capability setup.
- Add safe `doctor --fix`.
- Add recommended/expert setup modes, with expert initially minimal.

### Milestone 4: Init And State

- Implement `foundry init`.
- Create `.foundry/config.toml`.
- Create run folder structure.
- Implement `run.json`.
- Implement `status.md`.
- Implement `status`, `pause`, and `resume` for local run state.

### Milestone 5: Plan Mode

- Implement `foundry plan`.
- Add intake.
- Add research pass.
- Add intent interview coverage slots.
- Add Algorithm Pass artifact generation.
- Write `summary.md`, `prd.md`, `implementation-plan.md`, `issue-plan.md`, and `build-goal.md`.
- Stop for approval.

### Milestone 6: Polish For Public V1

- Add installer.
- Add README.
- Add example run.
- Add troubleshooting guide.
- Add a small fixture project for testing.
- Add smoke tests for the public success case.

## Verification

V1 should be verified with:

- Unit tests for schemas/config/doctor checks.
- CLI integration tests for `doctor`, `init`, `status`, `pause`, `resume`.
- A local smoke test proving `foundry setup` can verify Composer 2.5 Standard.
- A fixture repo smoke test proving `foundry plan` writes the required artifacts.
- Manual test on a rough idea to judge artifact usefulness.

## Next Implementation Decision

Before creating the repo, decide only:

```text
repo name
local repo path
public/private initial visibility
installer style
```

Everything else can follow this v1 plan.
