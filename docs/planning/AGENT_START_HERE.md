# Agent start here (Foundry)

One-page entry for AI coding agents. Read this before picking work.

## Canonical surface

| What | Value |
|------|-------|
| **GitHub** | https://github.com/kartikkabadi/foundry |
| **Branch** | `main` at or after `09eb047` (PR #103 merged) |
| **Clean checkout** | Use a fresh worktree if local `foundry/` is behind or dirty |

```bash
cd /path/to/foundry
git fetch origin
git checkout main && git pull origin main
# or: git worktree add ../foundry-clean origin/main
```

## Read order

1. [VERIFIED_STATE.md](VERIFIED_STATE.md) — what is done vs open on `main`
2. [AGENTS.md](../../AGENTS.md) — worktree rules, Composer 2.5 only
3. [V2-V5_ROADMAP.md](V2-V5_ROADMAP.md) — product arc

## Open issues only (do not rebuild PR #103)

Pick **exactly one**: #32, #34, #37, #42, #43, #44, #45, #46, #47, #48, #50.

Closed via PR #103 (do not re-implement): #31, #33, #35, #36, #38, #39, #40, #41, #49.

Duplicates #51–#90 are closed — ignore them.

## Verify before claiming done

```bash
npm run build && npm test                    # expect 219 pass on current main
bash scripts/demo.sh
FOUNDRY_BUILD_MOCK=1 bash scripts/demo-build.sh
```

Paste command output in the PR or issue comment.

## Worktree rule

- Max **one** spare worktree besides `main` for parallel issues.
- Do **not** use `foundry-integration` or `foundry-agent-phase-*` — those branches were merged in PR #103.
- Never `git reset --hard` without Kartik's explicit OK.

## Not verified in CI (optional)

Live Composer plan/build on a real idea — see [LIVE_VERIFICATION.md](LIVE_VERIFICATION.md).
