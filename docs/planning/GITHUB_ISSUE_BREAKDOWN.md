# Foundry V1 GitHub Issue Breakdown

Created: 2026-05-24

Source: `V1_PLAN.md`

Status: Published to `kartikkabadi/foundry`.

Published issues:

- #1: https://github.com/kartikkabadi/foundry/issues/1
- #2: https://github.com/kartikkabadi/foundry/issues/2
- #3: https://github.com/kartikkabadi/foundry/issues/3
- #4: https://github.com/kartikkabadi/foundry/issues/4
- #5: https://github.com/kartikkabadi/foundry/issues/5
- #6: https://github.com/kartikkabadi/foundry/issues/6
- #7: https://github.com/kartikkabadi/foundry/issues/7
- #8: https://github.com/kartikkabadi/foundry/issues/8

## Issue 1: Bootstrap the Foundry CLI and Local State

Type: AFK

Blocked by: None - can start immediately

User stories covered:

- As a user, I can install/run `foundry` as a standalone CLI.
- As a user, I can run `foundry --version`.
- As Foundry, I can create/read my own local state without depending on Pi being healthy.

What to build:

Create the minimal TypeScript/Node CLI foundation, including command parsing, version output, config/state directory resolution, and safe creation of Foundry-owned local directories.

Acceptance criteria:

- [ ] `foundry --version` prints the package version.
- [ ] `foundry --help` lists the v1 commands.
- [ ] Foundry resolves `~/.foundry` for machine state.
- [ ] Foundry does not read or modify Pi/Cursor config during bootstrap.
- [ ] Unit tests cover config path resolution and CLI command registration.

## Issue 2: Implement `foundry doctor` Capability Checks

Type: AFK

Blocked by: Issue 1

User stories covered:

- As a user, I can see whether Foundry/Pi/Cursor/Composer are ready.
- As setup, I can consume deterministic readiness data.
- As support/debugging, I can inspect a stable JSON report.

What to build:

Implement `foundry doctor` with human output, `--json`, `--for`, `--deep`, stable status codes, deterministic exit codes, and fast default checks for the v1 capability matrix.

Acceptance criteria:

- [ ] `foundry doctor` prints a readable capability table.
- [ ] `foundry doctor --json` emits the stable doctor schema.
- [ ] `foundry doctor --for plan` checks only Plan Mode requirements.
- [ ] Required check failures exit `1`.
- [ ] Doctor internal failures exit `2`.
- [ ] Optional/recommended missing capabilities warn without failing unless `--strict` is used.

## Issue 3: Implement Agent-Guided `foundry setup`

Type: AFK

Blocked by: Issue 2

User stories covered:

- As a new user, I can be guided through making Foundry usable.
- As a heavy user, I can use expert setup without losing deterministic checks.
- As Foundry, I verify fixes by re-running doctor instead of assuming success.

What to build:

Implement `foundry setup` as a dependency-ordered loop over doctor results, with recommended/expert modes and safe `doctor --fix` support for Foundry-owned local repairs.

Acceptance criteria:

- [ ] Setup runs doctor first.
- [ ] Setup presents missing capabilities in dependency order.
- [ ] Setup re-runs doctor after a user action or safe fix.
- [ ] `doctor --fix` only repairs Foundry-owned local state.
- [ ] Setup does not silently install packages, edit Pi/Cursor config, or change permissions.

## Issue 4: Implement Project Init, Run State, Status, Pause, and Resume

Type: AFK

Blocked by: Issue 1

User stories covered:

- As a project user, I can initialize Foundry inside a repo.
- As a long-run user, I can inspect, pause, and resume a run.
- As Foundry, I can persist runtime state in `run.json`.

What to build:

Implement `foundry init`, project `.foundry` layout creation, `run.json`, `status.md`, and basic `status`, `pause`, and `resume` commands for foreground/resumable v1 runs.

Acceptance criteria:

- [ ] `foundry init` creates `.foundry/config.toml`.
- [ ] A run folder includes `run.json` and `status.md`.
- [ ] `foundry status` summarizes latest/current run state.
- [ ] `foundry pause` marks the active run paused and records next action.
- [ ] `foundry resume` finds the latest paused run.
- [ ] Tests cover missing/malformed run state.

## Issue 5: Implement Composer 2.5 Standard Readiness and Plan Preflight

Type: AFK

Blocked by: Issues 2 and 4

User stories covered:

- As a user, I know whether Composer 2.5 Standard is usable before planning starts.
- As Foundry, I hard-fail Plan Mode if Composer 2.5 is unavailable.
- As Foundry, I never silently fall back to another model.

What to build:

Implement the Pi/Cursor SDK adapter path needed to detect and smoke-test `cursor/composer-2.5` Standard, enforce Composer-exclusive v1 policy, and gate `foundry plan` on readiness.

Acceptance criteria:

- [ ] Doctor reports `composer-2.5-standard`.
- [ ] `foundry plan` fails before creating a planning run if Composer 2.5 Standard is unavailable.
- [ ] Failure output explains setup/repair path.
- [ ] Composer Fast is not used unless explicitly requested and approved.
- [ ] No non-Composer fallback path exists in v1.

## Issue 6: Implement Plan Mode Artifact Generation

Type: AFK

Blocked by: Issues 4 and 5

User stories covered:

- As a user, I can give Foundry a rough software idea.
- As a user, I receive a concise summary and build-ready planning artifacts.
- As Foundry, I stop for approval after planning.

What to build:

Implement the first public success case for `foundry plan`: intake, research, intent interview coverage slots, Algorithm Pass, artifact generation, and approval stop.

Acceptance criteria:

- [ ] Plan Mode asks 2-3 broad intake questions.
- [ ] Plan Mode asks intent-level questions using the 10 coverage slots.
- [ ] Plan Mode writes `summary.md`, `prd.md`, `implementation-plan.md`, `issue-plan.md`, and `build-goal.md`.
- [ ] Plan Mode writes Algorithm Pass artifacts.
- [ ] Plan Mode updates `run.json` and `status.md`.
- [ ] Plan Mode stops for approval and does not start Build Mode.

## Issue 7: Add GitHub Issue Drafting and Approval-Gated Publishing

Type: HITL

Blocked by: Issue 6

User stories covered:

- As a user, I can turn a plan into GitHub-ready issues.
- As a user, I approve external GitHub writes before they happen.
- As Foundry, I can fall back to local Markdown issues when GitHub is unavailable.

What to build:

Implement issue-plan conversion into GitHub issue drafts, with explicit approval before creating real GitHub issues. Use local Markdown issues as fallback.

Acceptance criteria:

- [ ] `issue-plan.md` is convertible into issue bodies.
- [ ] GitHub issue creation requires explicit approval.
- [ ] Foundry records created issue URLs when publishing succeeds.
- [ ] Missing GitHub auth produces local Markdown issues instead of failing planning.
- [ ] Issue bodies include acceptance criteria and dependency information.

## Issue 8: Public V1 Installer, Docs, and Smoke Test

Type: AFK

Blocked by: Issues 1-7

User stories covered:

- As a new user, I can install Foundry from GitHub.
- As a contributor, I understand the v1 scope and non-goals.
- As maintainer, I can verify the public success case before release.

What to build:

Create the GitHub installer, README, troubleshooting guide, example run, and smoke tests for the public v1 success case.

Acceptance criteria:

- [ ] Installer can install Foundry from GitHub.
- [ ] README explains setup, plan, Composer 2.5 Standard requirement, and non-goals.
- [ ] Troubleshooting guide covers Pi/Cursor/Composer/GitHub failures.
- [ ] Example run shows the expected planning artifacts.
- [ ] Smoke test verifies the v1 success case in a fixture repo.
