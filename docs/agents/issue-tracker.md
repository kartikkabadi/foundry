# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues on **kartikkabadi/foundry**. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue on `kartikkabadi/foundry`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Full acceptance criteria

Published issues #1–#8 with full AC live in `docs/planning/GITHUB_ISSUE_BREAKDOWN.md` (GitHub issue bodies may be truncated).

## V2–V5 tracker (canonical #11–#50)

Duplicates **#51–#90** are closed; use canonical numbers only.

| Slice | Issues | Status on `main` |
|-------|--------|------------------|
| V2 | [#11](https://github.com/kartikkabadi/foundry/issues/11)–[#20](https://github.com/kartikkabadi/foundry/issues/20) | Closed — merged |
| V3 Build | [#21](https://github.com/kartikkabadi/foundry/issues/21)–[#30](https://github.com/kartikkabadi/foundry/issues/30) | Closed on GitHub — code on `main` via PR [#98](https://github.com/kartikkabadi/foundry/pull/98); re-close with evidence after G4 production-truth |
| V4 Orchestration | [#31](https://github.com/kartikkabadi/foundry/issues/31)–[#40](https://github.com/kartikkabadi/foundry/issues/40) | **Open** — `blocked:g4-production-truth` removed after production-truth sign-off (`main` @ `ecaf87b`) |
| V5 Product | [#41](https://github.com/kartikkabadi/foundry/issues/41)–[#50](https://github.com/kartikkabadi/foundry/issues/50) | **Open** |

**Canonical open work:** **#31–#50** only.

Alignment audit (AC ↔ tests, blocked-by fixes): `docs/planning/TRACKER_ALIGNMENT_2026-05-26.md`.

Closed V2 work (#11–#20) is complete on `main`; see `docs/planning/V2-V5_GITHUB_ISSUES.md` index table.
