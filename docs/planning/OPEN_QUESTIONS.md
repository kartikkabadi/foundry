# Foundry Open Questions

Created: 2026-05-24
Last updated: 2026-05-24

These are the next planning branches to grill. They are not locked yet unless marked as locked in `DECISIONS.md`.

## Next Immediate Question

Define the exact `foundry doctor` v1 check matrix.

The autonomy taxonomy, fresh-confirmation list, Composer-only model policy, run/resume mechanics, comms storage, conflict artifacts, user-required decision boundary, question-quality policy, and 10-slot interview are now locked in `DECISIONS.md`.

Recommended next lock:

Foundry v1 should have a deterministic doctor matrix with explicit status values and repair guidance for each capability.

Possible check groups:

```text
system
node-package-manager
foundry-install
pi-cli
pi-runtime
cursor-sdk
composer-2.5-standard
composer-2.5-fast
github-cli
git-worktrees
browser-capture
cuadriver-computer-use
skills-team-packs
project-foundry-config
```

## Setup Questions

- What exactly does `foundry doctor` check in v1?
- Should `doctor` output be human Markdown, machine JSON, or both?
- What should the terminal setup wizard UX look like in v1?
- Should setup install Pi if missing, or only guide the user to install Pi?
- What minimum Pi version should Foundry target?
- Should Foundry patch/fix known Pi launcher issues automatically or only recommend fixes?

## Repo And Distribution Questions

- What should the public GitHub repo be called?
- What should the one-command installer look like?
- Should installer default to latest release, pinned release, or branch install?
- How should release age or supply-chain safety be enforced?
- Should Foundry have self-update support in v1?

## Model Questions

- How should Foundry detect `cursor/composer-2.5` availability?
- How should Foundry distinguish Standard vs Fast availability?
- What exact smoke test proves Composer 2.5 Standard works?
- What exact smoke test proves Composer 2.5 Fast works if explicitly approved?
- How should Foundry estimate/display Cursor usage intensity without pretending to know exact dollars?

## Team Spec Questions

- TOML or YAML for team/profile specs?
- What is the minimum built-in recommended team pack?
- What is the expert/Kartik team pack?
- How are team specs validated?
- How do teams publish artifacts and messages?
- How does Foundry prevent agents from duplicating each other's work?

## Planning Questions

- What is the exact quick/deep/marathon default sizing?
- What are checkpoint intervals for each budget?
- What loop detection signals should trigger intervention?
- What is the exact 2-3 question intake format?
- What is the exact 10-question intent interview format?
- When does Auto Plan Mode stop?

## Artifact Questions

- Which artifacts are mandatory for quick/deep/marathon?
- Which artifacts are safe to commit in public repos?
- Should artifacts be Markdown only in v1?
- Should Foundry generate diagrams?
- What should the first version of `run.json` schema be?
- What should the first version of `events.jsonl` schema be?

## Build Mode Questions

- What is the exact Build Goal schema?
- How should issues map to worktrees?
- How should orchestrator review work?
- What merge policy should Build Mode use?
- What happens when one worktree fails?
- How are deferred issues recorded?

## Reference Capture Questions

- What is the v1 browser capture adapter?
- What is the v1 CuaDriver adapter boundary?
- Should screen recordings be first-class artifacts?
- How does Foundry summarize visual references into requirements?
- How are reference assets stored without bloating repos?

## Dashboard/TUI Questions

- What exact fields should `foundry status` show?
- What exact sections should `status.md` include?
- What future TUI assumptions should `run.json` preserve?

## Safety Questions

- How should Foundry handle secrets and private session stores?
- How does Foundry recover from partial runs?
- How does Foundry resume after interruption?
- How should Foundry detect stale locks or half-written artifacts?
- How should blocked actions be displayed without stopping useful fallback work?

## Notification Questions

- What local macOS notification mechanism should v1 use?
- Should notifications be opt-in during setup or first long run?
- Should approval-needed notifications repeat or stay silent after the first alert?

## Conflict And Decision Questions

- What is the exact conflict artifact template?
- What is the exact decision log format?
- How should Foundry link conflicts to PRD sections, issues, or build goals?
