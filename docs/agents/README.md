# Agent bootstrap (Foundry)

Read this before picking work. Rules live in [AGENTS.md](../../AGENTS.md). Issue queue: [issue-tracker.md](issue-tracker.md). Domain and planning depth: [domain.md](domain.md).

## Canonical surface

| What | Value |
|------|-------|
| **GitHub** | https://github.com/kartikkabadi/foundry |
| **Branch** | `main` at or after `09eb047` (PR #103 merged) |
| **Local clone** | `/Users/user/Documents/projects/foundry` |

```bash
cd /path/to/foundry
git fetch origin
git checkout main && git pull origin main
# or: git worktree add ../foundry-clean origin/main
```

Use a fresh worktree if your checkout is behind or has uncommitted doc edits you did not intend to keep.

## Do not use

| Surface | Why |
|---------|-----|
| `foundry-integration`, `foundry-agent-phase-*` worktrees | Merged via PR #103 — removed locally |
| GitHub issues **#51–#90** | Duplicate tracker — closed; use **#1–#50** only |

## Read order

1. **This file** — bootstrap
2. [issue-tracker.md](issue-tracker.md) — pick exactly one open issue
3. [VERIFIED_STATE.md](../planning/VERIFIED_STATE.md) — confirm issue row vs code on `main`
4. [AGENTS.md](../../AGENTS.md) — Composer 2.5, worktrees, review bar
5. [domain.md](domain.md) — `CONTEXT.md`, planning spec, ADRs for the task

## Verify before claiming done

```bash
npm run build && npm test                    # expect 226 pass on current main
bash scripts/demo.sh
FOUNDRY_BUILD_MOCK=1 bash scripts/demo-build.sh
```

Paste command output in the PR or issue comment.

## Last verified

2026-05-25 — `npm test` 226/226 pass; `scripts/demo.sh` exit 0; `FOUNDRY_BUILD_MOCK=1 scripts/demo-build.sh` exit 0; `scripts/cli-harness.sh` exit 0 on `main` @ `09eb047+`. Not verified: live Composer plan on a real idea.

## Session rules

- One GitHub issue per agent session unless Kartik assigns a bundle.
- Max **one** spare worktree besides `main` for parallel issues.
- Never `git reset --hard` without Kartik's explicit OK.
- PR #103 is merged — do **not** re-implement closed slices (#31, #33, #35, #36, #38–#41, #49).

## Not verified in CI (optional)

Live Composer plan/build on a real idea — see [LIVE_VERIFICATION.md](../planning/LIVE_VERIFICATION.md).
