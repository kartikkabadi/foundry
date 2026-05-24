# Foundry Open Questions

Created: 2026-05-24
Last updated: 2026-05-24

These are the next planning branches to grill. They are not locked yet unless marked as locked in `DECISIONS.md`.

## LOCKED — Hackathon doctor matrix (`--for plan`)

**Status: locked for hackathon sprint (2026-05).** Full V1 matrix may expand later via `grill-with-docs`.

`foundry doctor --for plan` must evaluate this minimum set. **Required checks fail the run (exit 1).** Optional checks warn only (exit 0 unless `--strict`).

### Required (exit 1 on failure)

| Check ID | How |
|----------|-----|
| `system` | OS/arch sanity |
| `node-package-manager` | npm or pnpm available |
| `foundry-install` | Node ≥20, `dist/cli.js` exists after build |
| `pi-cli` | **Required** for hackathon "real Pi" demo narrative |
| `cursor-sdk` | `CURSOR_API_KEY` set, `@cursor/sdk` resolves |
| `composer-2.5-standard` | `--deep` smoke: bounded `Agent.prompt`, **60s timeout** |
| `project-foundry-config` | `.foundry/config.toml` present (warn before init) |

### Optional (warn only)

| Check ID | How |
|----------|-----|
| `git-github` | `gh` auth + repo remote |
| `git-worktrees` | git worktree support |

### Exit codes

- `0` — all required checks pass
- `1` — one or more required checks failed
- `2` — doctor internal error

### JSON schema

Frozen types: `src/types/doctor.ts`. Issue #2 ships human table + `doctor --json` emitting `DoctorReport`.

### Post-hackathon

Expand matrix (pi-runtime, composer-2.5-fast, browser-capture, cuadriver, skills-team-packs) via full V1 lock in DECISIONS.md.

---

## Next Immediate Question (post-hackathon)

Refine the **full** V1 doctor matrix beyond hackathon minimum (see locked hackathon section above).

The autonomy taxonomy, fresh-confirmation list, Composer-only model policy, run/resume mechanics, comms storage, conflict artifacts, user-required decision boundary, question-quality policy, and 10-slot interview are now locked in `DECISIONS.md`.

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
