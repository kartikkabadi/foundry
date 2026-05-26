# Foundry

Foundry is a planning-first CLI that configures and extends Pi into a multi-agent product-building runtime. Users move from a rough idea through Plan Mode artifacts to approved execution in Build Mode, with deterministic checks, proof requirements, and human approval gates.

## Language

### Modes and runtime

**Plan Mode**:
The interactive planning phase where Foundry turns a rough idea into draft artifacts (summary, PRD, implementation plan, issue plan, build goal) and stops for explicit approval before any build work.
_Avoid_: planning mode, plan phase

**Auto Plan Mode**:
An extended Plan Mode run that continues autonomously within a budget profile until artifacts are complete or a checkpoint/pause is required.
_Avoid_: autonomous planning, long plan

**Build Mode**:
Execution phase that runs approved issue-plan slices with proof-backed deliverables, worktree isolation, and orchestrator review before merge.
_Avoid_: build phase, implementation mode

**Run**:
A single Foundry session for one project goal, persisted under `.foundry/runs/<run-id>/` with machine-readable state and human-readable status.
_Avoid_: session, job, execution

**Checkpoint**:
A persisted Run state that records the current phase so Plan Mode or Build Mode can resume after crash, rate limit, or explicit pause without restarting from scratch.
_Avoid_: snapshot, savepoint

**Budget profile**:
A named limit set (`quick`, `deep`, `marathon`) controlling agent-pass count, exploration depth, and checkpoint intervals for a Run.
_Avoid_: plan tier, speed setting

### Artifacts and proof

**Artifact**:
A markdown or JSON file produced during Plan Mode or Build Mode that captures product intent, execution plans, or runtime events (e.g. `summary.md`, `prd.md`, `run.json`).
_Avoid_: output, document

**Build Goal**:
The durable completion criteria for Build Mode, derived from `build-goal.md`, defining when the Run's execution objective is satisfied.
_Avoid_: success criteria, done definition

**Proof**:
Evidence that an issue slice is complete, validated by type (code tests, UI screenshots, docs citations, config checks, research provenance) before the orchestrator may merge.
_Avoid_: verification, evidence bundle

**Issue plan**:
The ordered list of execution slices parsed from `issue-plan.md` into a dependency graph for Build Mode.
_Avoid_: task list, backlog

### Agents and orchestration

**Orchestrator**:
The lead agent role that assigns work, reviews worker output, resolves conflicts, and merges approved changes — never self-merging worker PRs.
_Avoid_: manager, lead, coordinator

**Worker**:
An agent executing a single issue slice in an isolated git worktree, producing proofs and stopping at review gates.
_Avoid_: subagent, builder, implementer

**Swarm** (V4):
Multiple agents exploring in parallel (e.g. research branches) whose outputs merge with provenance and citations into planning artifacts (`foundry plan --swarm research [--swarm-branches N]`).
_Avoid_: parallel agents, fan-out

**Team pack** (V4):
A TOML-specified set of agent roles, reporting lines, and comms contracts loaded at project init (`foundry init --team pack.toml`).
_Avoid_: agent team, crew config

**Handoff** (V4):
A required comms artifact published when a governed role completes work (`must_publish`); build preflight enforces handoffs and logs `handoff_published` events.
_Avoid_: transfer, sync doc

### Capabilities and checks

**Doctor**:
Foundry's deterministic capability matrix that reports readiness for Plan Mode, Build Mode, or full product surface — the source of truth for preflight and setup loops.
_Avoid_: health check, diagnostics

**Preflight**:
Doctor-scoped checks run immediately before a mode starts; hard-fail if required capabilities are missing (no silent model or tool fallback).
_Avoid_: pre-check, gate

**Autonomy contract**:
User-configured rules for which actions (install, commit, publish, repo creation) require explicit approval during a Run.
_Avoid_: permissions, safety mode

### Status surface

**Status**:
Human-readable Run summary in `status.md` plus CLI `foundry status`, derived from `run.json` without duplicating schema logic.
_Avoid_: progress, state display

**TUI** (V5 — not implemented):
Terminal UI that attaches to an active or background Run, rendering `run.json` and `status.md` for live monitoring.
_Avoid_: dashboard, console UI

**Daemon** (V5 — not implemented):
Background Foundry process holding a Run alive across terminal detach, notify-on-event, and re-attach via TUI.
_Avoid_: background service, watcher

## Flagged ambiguities

**Approve vs publish**: "Approve" transitions a Run from `awaiting_approval` to `approved` for Build Mode entry. "Publish" (V1) drafts GitHub issues from the issue plan — a separate, approval-gated external write. Do not conflate them.

**Resume vs build resume**: `foundry resume` re-enters the current Run at its checkpoint phase (Plan or Build). Build-specific resume (V3) continues the same issue slice after pause/rate-limit within Build Mode.

## Example dialogue

**Dev**: We paused mid-plan because Composer hit a rate limit. Can we pick up where we left off?

**Expert**: Yes — that's a **Checkpoint** on the **Run**. `foundry resume` reads **run.json**, re-enters **Plan Mode** at the saved phase, and stays on the same **Budget profile**. No **Build Mode** until you **Approve** the artifacts.

**Dev**: Who merges the worker's branch?

**Expert**: The **Orchestrator** reviews **Proof** for that **Issue plan** slice, then merges. **Workers** never merge themselves.
