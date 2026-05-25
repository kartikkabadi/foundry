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

## Live queue (2026-05-25, post–PR #103)

Confirm on GitHub before starting. Full issue→code rows: [VERIFIED_STATE.md](../planning/VERIFIED_STATE.md).

| Track | Issues | Agent rule |
|-------|--------|------------|
| **Open for new work** | [#32](https://github.com/kartikkabadi/foundry/issues/32), [#34](https://github.com/kartikkabadi/foundry/issues/34), [#37](https://github.com/kartikkabadi/foundry/issues/37), [#42](https://github.com/kartikkabadi/foundry/issues/42)–[#48](https://github.com/kartikkabadi/foundry/issues/48), [#50](https://github.com/kartikkabadi/foundry/issues/50) | Pick **exactly one** per session |
| **Closed via PR #103 (do not re-implement)** | [#31](https://github.com/kartikkabadi/foundry/issues/31), [#33](https://github.com/kartikkabadi/foundry/issues/33), [#35](https://github.com/kartikkabadi/foundry/issues/35), [#36](https://github.com/kartikkabadi/foundry/issues/36), [#38](https://github.com/kartikkabadi/foundry/issues/38)–[#41](https://github.com/kartikkabadi/foundry/issues/41), [#49](https://github.com/kartikkabadi/foundry/issues/49) | Code landed on `main` |
| **Duplicates** | #51–#90 | Closed — ignore |

Historical index: `docs/planning/V2-V5_GITHUB_ISSUES.md`. V1–V3 (#1–#30) are done on `main`.
