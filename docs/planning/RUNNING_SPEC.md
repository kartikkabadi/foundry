# Foundry Running Spec

Created: 2026-05-24
Last updated: 2026-05-24

## One-Line Product Definition

Foundry is a standalone, planning-first TypeScript/Node CLI that configures and extends Pi into a serious multi-agent product-building runtime, with Cursor Composer 2.5 as the exclusive v1 model and deterministic capability checks underneath agent-guided workflows.

## Product Promise

Foundry helps a user start with a rough idea and reach a deeply planned, approved, issue-backed, verification-ready build plan without forcing the user to constantly micromanage agents.

It does this by combining:

- Composer 2.5 worker agents.
- Exploration swarms.
- Socratic intent clarification.
- First-principles reasoning.
- The Algorithm.
- Reference capture by analogy.
- Structured team communication.
- Approval-aware autonomy.
- Build Mode with proof requirements.

## Core Modes

```text
Setup Mode
Doctor Mode
Init Mode
Plan Mode
Auto Plan Mode
Build Mode
Status Mode
Pause/Resume Mode
```

## Main Flow

```text
foundry setup
  -> machine capabilities ready

foundry init
  -> project configured

foundry plan
  -> idea intake
  -> exploration
  -> interview
  -> Auto Plan Mode
  -> summary
  -> PRD/plans/issues draft

foundry build
  -> approved Build Goal execution

foundry status / pause / resume
  -> durable run control
```

## Product Laws

- No build without a plan.
- No plan without intent.
- Planning artifacts are drafts.
- Issues are execution commitments.
- Parallelism is earned by dependency analysis.
- No issue closes without proof.
- Long runs need an upfront Autonomy Contract.
- Unclassified actions are denied by default.
- Composer 2.5 Standard is the default.
- Composer 2.5 Fast requires explicit per-run approval.
- Cursor limits pause and checkpoint runs; they do not trigger model fallback.
- Deterministic checks are the source of truth.
- First principles define the minimum.
- References define the feel.
- The Algorithm decides what survives.

## Recommended New-User Experience

`foundry setup` should guide the user through:

1. Foundry installation health.
2. Pi baseline health.
3. Cursor SDK and Composer 2.5.
4. GitHub CLI/auth.
5. Browser/reference capture.
6. CuaDriver/computer-use, heavily recommended on macOS.
7. Worktree support.
8. Skills/team packs.
9. Smoke tests.
10. Default planning budget/profile.

The user should be able to skip optional pieces, but Foundry must record the resulting capability limits.

## Expert Experience

`foundry setup --expert` should allow advanced choices for:

- Composer speed policy.
- Team packs.
- Swarm profiles.
- Agent communication rules.
- GitHub/local issue backend.
- CuaDriver/reference capture strategy.
- Worktree policy.
- Artifact commit behavior.
- Approval profile defaults.

## Capability Philosophy

Foundry should not bundle every heavy dependency into the core.

Instead it should use adapters:

```text
Pi adapter
Cursor SDK adapter
GitHub adapter
CuaDriver adapter
Browser adapter
Worktree adapter
Issue backend adapter
Model adapter
Skill adapter
```

Each capability should have:

- Install check.
- Permission check.
- Smoke test.
- Status.
- Fallback path.

## V1 Shape

Foundry v1 should prove:

- New user can install and reach a working Pi + Composer 2.5 setup.
- Heavy user can configure real swarm profiles and team packs.
- Auto Plan Mode produces useful planning artifacts.
- Summary/PRD/implementation plan/issue plan/build goal are coherent.
- Approval profiles prevent wasted unattended runs.
- Run state can pause, resume, and survive Cursor usage/rate-limit interruptions.
- Agent communication and conflicts are captured without dumping raw transcript noise into committed artifacts.
- Missing capabilities degrade gracefully instead of halting the whole workflow.

## V1 Model Runtime

```text
Only model family:
  cursor/composer-2.5

Default speed:
  standard

Optional speed:
  fast, explicit per-run approval only

No v1:
  GPT reviewer
  Opus reviewer
  premium judge model
  non-Composer fallback
```

`foundry plan` and `foundry build` hard-fail if Composer 2.5 is unavailable. `doctor`, `setup`, and `init` can still run to diagnose and repair the setup.

## V1 Run Control

```text
foundry status
foundry pause
foundry resume
foundry resume <run-id>
```

Every run writes:

```text
<run>/run.json
<run>/status.md
```

V1 runs are foreground-only but resumable. Background jobs are a later feature.

## V1 Autonomy And Questions

Foundry asks intent/product-boundary questions, not low-level implementation questions.

The 10-question interview is ten coverage slots:

```text
user / beneficiary
current pain
desired outcome
minimum useful version
non-goals / deletion
references / desired feel
constraints
quality bar / done proof
risk / unacceptable failure
autonomy / execution preference
```

Every adapter action must be classified. Missing classification means deny by default.
