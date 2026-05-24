# Foundry Decision Log

Created: 2026-05-24
Last updated: 2026-05-24

## Product Identity

- Name: Foundry.
- Foundry is a full Pi setup/runtime, not merely a Pi extension.
- Foundry is planning-first. Build Mode only starts after explicit approval.
- Foundry should be useful for both new Pi users and serious/heavy Pi operators.
- The earlier `pi-composer-powerpack` direction is not canonical and should be ignored unless explicitly revived.

## Core Thesis

Foundry is a planning-first Pi runtime/setup that uses Cursor Composer 2.5 as cheap, high-limit base intelligence, then adds multi-agent research, Socratic clarification, comms, chains, first-principles planning, reference capture, safety, and verification to produce high-end agent-quality work without depending on premium model fallbacks in v1.

## Implementation Platform

- Foundry v1 should be a standalone TypeScript/Node CLI.
- Foundry should be a public GitHub repo eventually.
- Distribution order:
  1. One-command GitHub installer first.
  2. npm package later.
- Rust or Go are not the v1 core.
- Optional future native helpers may be added only if a proven bottleneck needs them.

## Standalone CLI First

Foundry should not depend on Pi already being healthy.

Canonical command surface:

```text
foundry doctor
foundry setup
foundry init
foundry plan
foundry build
foundry status
foundry pause
foundry resume
```

Command meanings:

- `foundry doctor`: deterministic health and capability audit.
- `foundry setup`: agent-guided setup wizard built on top of doctor.
- `foundry init`: prepare a repo/project for Foundry.
- `foundry plan`: planning and Auto Plan Mode.
- `foundry build`: approved Build Goal execution.
- `foundry status`: show the current/latest run state for the repo.
- `foundry pause`: gracefully pause the active run and write a checkpoint.
- `foundry resume`: resume the latest paused run or a specific run id.

## Setup Lanes

Foundry setup has two lanes:

```text
foundry setup
foundry setup --recommended
foundry setup --expert
```

- `recommended` is the default.
- `recommended` is optimized for new users with minimal questions and sane defaults.
- `expert` is for heavy operators who want Composer speed policy, team packs, capability providers, worktree policy, issue backend, artifact behavior, and planning budgets.

## Agent-Guided Setup

- Setup should be agent-guided, not just a static installer.
- The agent can walk the user through missing dependencies and permissions.
- Deterministic checks remain the source of truth.
- The agent explains failures, asks the user to fix permissions or install tools when needed, then re-runs checks.
- Foundry should write a machine capability report after setup.

## Recommended Stack

Recommended v1 stack:

- Pi CLI healthy.
- Foundry CLI healthy.
- Node/pnpm healthy.
- Cursor SDK installed.
- `cursor/composer-2.5` available.
- Composer 2.5 Standard smoke-tested.
- Composer 2.5 Fast smoke-tested only if explicitly approved.
- Foundry Plan Mode.
- Auto Plan Mode.
- Algorithm Pass.
- Summary, PRD, implementation plan, issue plan, build goal artifacts.
- Build Mode.
- Git worktrees.
- Local proof logging.
- Serial execution by default.
- Parallel execution when the dependency graph proves tasks independent.
- GitHub issues if `gh` auth is ready.
- Local Markdown issues as fallback.
- Browser reference capture ready by default.
- CuaDriver/computer-use heavily recommended on macOS.

## CuaDriver / Computer Use

- CuaDriver/computer-use is heavily recommended, but optional.
- Users can choose not to enable it.
- Foundry should clearly explain what is lost if it is skipped.
- It is especially important for macOS app reference capture, menu bar app inspection, visual UI state analysis, screenshots, recordings, and desktop end-to-end checks.
- It is not required for core planning, repo research, GitHub issue generation, CLI-only projects, or web-only projects.
- Foundry should model computer-use as a capability:

```text
ready | missing | permissions-needed | failed | skipped
```

## Model Policy

- Foundry v1 is Composer 2.5 exclusive.
- The only model family in v1 is `cursor/composer-2.5`.
- No v1 support for GPT reviewers, Opus reviewers, premium judge models, paid external model fallbacks, or non-Composer fallback models.
- `foundry plan` and `foundry build` hard-fail if `cursor/composer-2.5` is unavailable.
- `foundry doctor`, `foundry setup`, and `foundry init` can run without Composer 2.5 so they can diagnose and repair the setup.
- There is no premium-model budget in v1 because there are no premium-model integrations in v1.

## Composer Speed Policy

- Default Composer speed: Standard.
- Fast is not the default for any budget profile.
- Fast is materially more expensive for modest latency improvement, so it is treated as an explicit acceleration choice.
- Fast requires explicit per-run approval.
- Autonomous mode cannot silently enable Fast.
- Team specs cannot silently select Fast.

Command examples:

```text
foundry plan --composer-speed fast
foundry build --composer-speed fast
```

Autonomy class:

```text
spend.cursor_fast
  use Composer 2.5 Fast instead of Standard
  fresh per-run approval required
```

## Planning Flow

Canonical flow:

```text
idea
  -> choose budget: quick | deep | marathon
  -> 2-3 broad intake questions
  -> exploration swarm with provenance
  -> 10-question intent interview
  -> Auto Plan Mode
  -> 5-10 paragraph summary
  -> PRD + supporting plans
  -> user approval
  -> GitHub issues or local Markdown issues
  -> Build Goal
  -> execution
```

The 10-question interview happens after initial exploration so questions are intent-level, not micromanagement-level.

## Question Quality Policy

Foundry should ask the user intent and product-boundary questions, not low-level implementation questions.

Good user questions:

- Who is this for first?
- What should this replace in the current workflow?
- What would make the result feel unacceptable?
- Which reference should dominate if references disagree?
- What is the minimum version that would still be useful?
- What should Foundry refuse to build?
- What autonomy level should this run have?

Bad default user questions:

- Which package should I use?
- What should I name this file?
- Should I write this helper in `src/utils`?
- Should this button be blue?
- Should tests use a routine local convention that the repo already answers?

Agents should answer implementation questions through repo inspection, ecosystem research, or local conventions unless the answer affects product intent, irreversible architecture, public action, cost, safety, or autonomy.

## 10-Question Intent Interview

The 10-question interview is ten required coverage slots, not ten hardcoded questions.

Coverage slots:

```text
1. User / beneficiary
2. Current pain or job-to-be-done
3. Desired outcome
4. Minimum useful version
5. Non-goals / what to delete
6. Reference products / desired feel
7. Constraints
8. Quality bar / done proof
9. Risk / unacceptable failure
10. Autonomy / execution preference
```

The actual wording adapts after initial exploration.

## Auto Plan Mode

- Auto Plan Mode can run for minutes, hours, or days depending on the budget.
- It should go deep without getting stuck in loops.
- It should checkpoint periodically.
- It should keep a live status surface.
- It should produce a short human summary before asking for approval.

## Planning Budgets As Swarm Profiles

Budgets are swarm profiles, not just durations.

Each budget controls:

- Max active agents.
- Total agent-pass budget.
- Time guidance.
- Checkpoint interval.
- Evidence requirements.
- Anti-loop strictness.

Profiles:

```text
quick
deep
marathon
```

Draft sizing:

```text
quick:
  3-5 active agents
  5-12 total agent passes

deep:
  8-15 active agents
  25-80 total agent passes

marathon:
  15-40 active agents, capped by machine/model limits
  100+ total agent passes over time
```

## Agent-Pass Budget

- Agent-pass budgeting is always enabled.
- Agent-pass budgeting applies to Composer 2.5 too.
- It controls run intensity, not premium model spend.

Controls:

- Max active agents.
- Total agent passes.
- Passes per team.
- Checkpoint interval.
- Evidence requirements.
- Anti-loop strictness.
- Cursor usage intensity label.

Usage labels:

```text
low
medium
high
extreme
```

Foundry should show expected run intensity before starting a long run. It should not show dollar estimates unless Cursor exposes reliable local usage data later.

## Cursor Usage And Rate Limits

Cursor rate limits, usage exhaustion, or temporary model unavailability are pause-and-resume events.

Behavior:

```text
Composer 2.5 temporarily rate-limited:
  pause or back off according to run policy
  write checkpoint
  continue non-model tasks if possible
  never switch models

Composer 2.5 usage exhausted:
  stop cleanly
  write checkpoint
  record completed work
  record remaining work
  offer resume command

Fast unavailable:
  downgrade to Standard only if the user explicitly allowed that fallback
  otherwise pause

Any model outage:
  no silent fallback to GPT, Opus, or another model
```

## Budget/Profile Overrides

Foundry supports global, project, and per-run overrides.

Priority order:

```text
1. CLI flags / run overrides
2. Project config
3. Global config
4. Foundry defaults
```

Example:

```text
foundry plan --budget marathon --max-active-agents 24 --agent-passes 120
```

## State Layout

Machine/user state:

```text
~/.foundry/
  config.toml
  capabilities.toml
  logs/
  cache/
  adapters/
  installs/
  approvals/
```

Project/run state:

```text
<repo>/.foundry/
  config.toml
  runs/
  issues/
  policies.toml
```

Rule:

```text
~/.foundry = machine/user capability state
<repo>/.foundry = project/run planning and execution state
```

## Commit Policy

- Private repo: commit safe project artifacts by default.
- Public repo: ask before committing `.foundry` artifacts.
- Local-only experiment: ask.
- Never commit machine capability details unless the user explicitly exports a redacted report.

## Planning Artifacts

Default run folder:

```text
<repo>/.foundry/runs/<run>/
```

Artifacts:

```text
status.md
intake.md
research.md
reference-analysis.md
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
run.json
prd.md
implementation-plan.md
issue-plan.md
summary.md
build-goal.md
autonomy-contract.md
comms/
conflicts/
```

Artifact audiences:

- `summary.md`: short human decision surface, 5-10 paragraphs.
- `prd.md`: human/product owner.
- `implementation-plan.md`: agents/builders.
- `issue-plan.md`: issue tracker.
- `build-goal.md`: durable Build Mode objective and completion criteria.
- `autonomy-contract.md`: record of what the run was allowed to do.
- `run.json`: machine-readable runtime state.
- `comms/`: structured and summarized agent communication.
- `conflicts/`: decision-ready conflict artifacts.

`summary.md` should either open in the default Markdown app or be shown directly in chat.

## Algorithm Pass

Foundry incorporates the Algorithm as an operating loop:

1. Make requirements less dumb.
2. Delete parts, process, features, handoffs, code paths, or requirements.
3. Simplify or optimize only what survived deletion.
4. Accelerate the simplified process.
5. Automate last.

Foundry rule:

```text
First principles define the minimum.
References define the feel.
The Algorithm decides what survives.
```

Algorithm Pass artifacts:

```text
requirements.md
deletion-pass.md
minimum-system.md
simplification-pass.md
acceleration-pass.md
automation-pass.md
```

## Reference Capture

Foundry supports environment-specific reference capture:

- macOS app: CuaDriver/accessibility inspection, screenshots, screen recording, menu bar interaction states, animation/frame analysis.
- Web app: browser inspection, screenshots, DOM/CSS analysis, interaction recording.
- CLI: command transcripts, help output, TUI screenshots, latency and ergonomics notes.
- API/backend: docs/source reading, request/response traces, integration examples, failure-mode analysis.

Reference capture turns vague analogies such as "make it feel like One Menu liquid glass" into concrete product requirements.

## Teams And Agent Specs

Foundry v1 should ship declarative team/profile specs.

Possible locations:

```text
~/.foundry/teams/
  recommended.toml
  expert.toml
  kartik.toml

<repo>/.foundry/teams/
  project.toml
```

Team specs include:

- Roles.
- Max active agents.
- Model settings.
- Required capabilities.
- Communication rules.
- Required handoff artifacts.
- Fallback behavior if capabilities are missing.

Example team categories:

- research
- reference_capture
- first_principles
- algorithm_pass
- architecture
- implementation_planning
- risk_review
- issue_generation
- build_execution
- verification

## Communication Rules

Team specs should define communication contracts, not just role names.

Examples:

```text
reports_to
can_message
must_publish
handoff_artifact
conflict_resolution
requires_capabilities
fallback_if_missing
```

This is where `coms`, `pi-chain`, and multi-agent coordination become structured instead of chaotic.

## Comms Storage

Foundry stores structured comms events plus summarized team threads.

Layout:

```text
<run>/comms/
  events.jsonl
  threads/
    research.md
    architecture.md
    reference-capture.md
```

Policy:

- `events.jsonl` is the structured machine-readable event stream.
- `threads/*.md` are human-readable summarized team threads.
- Raw transcripts stay local and uncommitted by default.
- Raw transcripts are exported only on explicit request.

Event types may include:

```text
agent_started
message_sent
artifact_published
blocker_reported
conflict_raised
decision_requested
agent_finished
```

## Conflict Artifacts

Meaningful agent disagreements become first-class conflict artifacts.

Layout:

```text
<run>/conflicts/
  C001-liquid-glass-implementation.md
  C002-native-vs-webview.md
```

Each conflict captures:

- Conflict summary.
- Claim A.
- Claim B.
- Evidence for each.
- Impact.
- Recommended decision.
- Orchestrator decision.
- User decision if required.
- Final resolution.

Rule:

- The orchestrator decides normal technical conflicts.
- The user decides conflicts that affect product intent, cost, public actions, irreversible architecture, or autonomy boundaries.

## User-Required Decision Boundary

The user must decide:

```text
product intent changes
scope expansion
major UX direction
irreversible architecture
public/external actions
repo visibility
cost/usage escalation
fresh-confirmation actions
license/legal/compliance risk
secret/private data access
destructive operations
```

Everything else:

- Orchestrator decides.
- Evidence is recorded.
- Decision is logged.
- User can review later.

## Autonomy Boundaries

Foundry must separate safe planning actions from approval-required actions.

Autonomous planning actions may include:

- Read repo files.
- Search public web/GitHub.
- Spawn planning/research agents.
- Capture local screenshots if permission exists.
- Write `.foundry` run artifacts.
- Summarize findings.
- Draft PRD/issues/build-goal.

Approval-required actions include:

- Create public GitHub repo.
- Create GitHub issues.
- Push commits.
- Open PRs.
- Install risky dependencies.
- Change Pi/Cursor/global config.
- Start Build Mode.
- Run destructive commands.

## Autonomy Contract

Long runs must front-load predictable permissions.

Foundry should run a permission forecast before `deep`, `marathon`, or `build` runs:

```text
idea -> preflight scan -> likely action graph -> permission forecast -> user approves scope -> long run starts
```

Approval profiles:

```text
safe:
  planning only
  no external writes
  no dependency installs
  no commits/issues/PRs

productive:
  default
  local writes allowed
  .foundry artifacts allowed
  local worktrees allowed
  tests/builds/lints allowed
  local Markdown issues allowed
  external writes require approval

autonomous:
  scoped external actions allowed
  can create GitHub issues
  can commit
  can push branches
  can open PRs
  only inside declared repo/account boundaries
  no destructive actions

custom:
  user chooses exact permissions
```

Default profile: `productive`.

## Autonomy Action Taxonomy

Every adapter action must declare its action class before it can run.

Mandatory action classes:

```text
read.local
read.external
write.artifact
write.project
execute.local
worktree.local
install.project
config.machine
capture.desktop
write.external
publish.external
spend.cursor_fast
secret.sensitive
destructive
```

Policy rule:

```text
if action.class is missing:
  deny
  record blocked action
  continue with fallback if possible
```

Unclassified actions are denied by default.

## Fresh-Confirmation Actions

Some actions cannot be silently pre-approved by broad autonomous mode.

Fresh confirmation is always required for:

```text
force push
delete branches
delete repos
delete files outside declared workspace
git reset --hard
git clean
print secrets/tokens
read private session stores
change shell startup files
edit global Pi/Cursor config
install global packages
make public repo/package releases
use Composer 2.5 Fast for the run
```

Fresh confirmation must include:

- Exact target.
- Exact reason.
- Exact command/action.
- Expected effect.
- Rollback or recovery note if applicable.

## Dependency Install Policy

Project dependency installs are pre-approvable but audited.

Project installs must:

- Use the project package manager.
- Use Socket Firewall when available.
- Record package name, version, reason, command, and lockfile changes.

Global installs:

- Always require fresh confirmation.

Unknown or risky install scripts:

- Require stronger approval or pause.

No approval available:

- Read docs/source instead.
- Draft an install request.
- Continue non-install work where possible.

## Approval Persistence

Decision: actual approval grants live in local machine state. Repos store only safe requested policy defaults.

Suggested layout:

```text
~/.foundry/approvals/
  <repo-hash>.toml

<repo>/.foundry/policies.toml
  safe requested defaults, commit-safe

<run>/autonomy-contract.md
  human-readable record of what was approved for that run
```

Do not commit actual approval grants to public repos.

## Run State And Resume

Every Plan/Build run gets a machine-readable run manifest:

```text
<repo>/.foundry/runs/<run>/run.json
```

Markdown is for humans. `run.json` is for runtime state, resume, dashboards, automation, blocked-action tracking, agent-pass accounting, phase tracking, artifact registry, and proof registry.

Minimum fields:

```json
{
  "run_id": "...",
  "foundry_version": "...",
  "mode": "plan",
  "budget": "deep",
  "status": "running",
  "phase": "auto_plan",
  "composer_speed": "standard",
  "created_at": "...",
  "updated_at": "...",
  "agent_pass_budget": {
    "max_active": 12,
    "used": 34,
    "limit": 80
  },
  "capabilities": {},
  "artifacts": [],
  "blocked_actions": [],
  "next_actions": [],
  "proofs": []
}
```

Resume commands:

```text
foundry resume
  resumes latest paused run in current repo

foundry resume <run-id>
  resumes a specific run

foundry status
  shows current/latest run

foundry pause
  gracefully pauses active run
```

## Foreground Runs

Foundry v1 runs are foreground-only but resumable.

V1 includes:

- Foreground terminal runs.
- Resumable checkpoints.
- `status`, `pause`, and `resume`.

Deferred until after v1:

- Background daemon/job execution.
- Attach/detach.
- Job supervision.
- Notifications beyond local desktop notifications.
- Crash recovery beyond run checkpoints.

## Notifications

Foundry v1 includes optional local notifications.

Events:

```text
approval_needed
paused
rate_limited
completed
failed
```

Defaults:

- Terminal output always.
- `status.md` and `run.json` always updated.
- Desktop notification optional.

Future notification adapters may include Telegram, Slack, Discord, email, webhook, or mobile push.

## GitHub And Issues

- GitHub issues are created only after plan/PRD approval.
- Local Markdown issues are the fallback.
- If the repo does not exist, Foundry asks for repo name and whether it should be private.
- Default repo creation should be private unless the user chooses public.

## Build Mode

Build Mode is hybrid:

- Serial by default.
- Parallel only when the issue graph proves tasks are independent.
- Independent work should use isolated git worktrees.
- The orchestrator reviews and merges.
- Worker agents do not merge themselves.

Every issue requires done proof scaled by issue type:

- Code: tests/build/lint/typecheck.
- UI: screenshot/browser/simulator proof.
- Docs: links/format/review.
- Config: smoke test.
- Research: citations/facts vs open questions.

Build Goal completes only when:

- Issues are closed or explicitly deferred.
- Proofs are recorded.
- Final tests pass.
- Final summary is written.
- Risks are listed.
- Repo is sane.

## Status Surface

Foundry v1 live status surface:

```text
foundry status
<repo>/.foundry/runs/<run>/status.md
<repo>/.foundry/runs/<run>/run.json
```

Meanings:

- `foundry status`: concise terminal summary.
- `status.md`: human-readable detailed live status.
- `run.json`: machine-readable runtime state.

Status should show:

- Phase.
- Budget.
- Active agents.
- Agent-pass usage.
- Composer speed.
- Research branches.
- Questions.
- Artifacts.
- Blocked actions.
- Blockers.
- Loop warnings.
- Next action.

No full TUI in v1. `run.json` and `status.md` should be designed so a TUI can be added later without reworking the runtime.

## Repo Alignment (2026-05, after user clarification)

**Pi Extension Pack (this repo's sibling: pi-composer-powerpack)**: Pure guide-style project + curated assets / whole Git repo of things you can do (not "run this script"). Includes launchers (pi-elite, pi-team, pi-chain, pi-pi-lab), extensions (cursor-sdk, coms, damage-control-continue, agent-chain/team, subagent-widget, tilldone, pi-pi, etc.), agent prompts (planner, reviewer, red-team, builder, etc.), mono-black theme, install.sh, and config.

**Key (user's words)**: "It should be more like a guide and a whole Git repo of things you can do, with a guide you can feed to your agent and say, 'Hey, look at this repo.' The agent should walk the user through it. You should include instructions for what the agent should ask the user and what the user wants, and help them set everything up."

**Foundry (this repo)**: The rock-solid, detailed, actual agent that can work — the planning-first standalone TypeScript/Node CLI per the full locked V1 spec (doctor, setup, plan, build with Composer 2.5 exclusive + deterministic checks, artifacts, autonomy contracts, run/resume, etc.). Uses Pi + the Extension Pack guide underneath as the polished base runtime.

**Relationship & First Milestone**: Both repos kept active and cross-linked. Powerpack is the "polished Pi setup guide + assets" companion layer. Foundry is the higher-level complex-work runtime. Clear separation documented here, in both READMEs, and planning. First milestone achieved when both have this documented + hygiene baseline (AGENTS.md etc.). No naming conflicts; powerpack direction revived only as the guide (per this clarification).

See: powerpack README (now updated as explicit agent-feedable guide) and this planning/ folder for V1 details. Local clones: documents/Projects/foundry (this) and documents/Projects/pi-composer-powerpack (powerpack).

This locks the alignment.
