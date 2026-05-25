# Foundry — AGENTS.md

Planning-first standalone TypeScript/Node CLI that configures and extends Pi into a serious multi-agent product-building runtime. Uses Cursor Composer 2.5 (Standard default; Fast explicit per-run only) as v1 base intelligence + deterministic checks, Socratic clarification, The Algorithm, reference capture, structured comms, approval-aware autonomy, and proof-backed build workflows.

**V1 Goal (locked)**: User installs, runs `foundry setup` (verifies Pi + Composer 2.5 Standard), runs `foundry plan` on rough idea → produces useful summary.md + prd.md + implementation-plan.md + issue-plan.md + build-goal.md, stops for approval. No build without approved plan.

See full locked specs in `docs/planning/` (V1_PLAN.md, RUNNING_SPEC.md, DECISIONS.md). Vertical-slice issues #1–#8 with full acceptance criteria: `docs/planning/GITHUB_ISSUE_BREAKDOWN.md`.

## Agent bootstrap

Before picking work, read [docs/agents/README.md](docs/agents/README.md).

## Agent skills

| File | Role |
|------|------|
| [docs/agents/README.md](docs/agents/README.md) | Clone surface, verify commands, session rules |
| [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) | `gh` CLI + live open-issue queue |
| [docs/agents/domain.md](docs/agents/domain.md) | CONTEXT, planning spec, ADRs |
| [docs/agents/triage-labels.md](docs/agents/triage-labels.md) | Label vocabulary |

## Working agreements (V1 spec + discipline)

- **Composer 2.5 exclusive in v1**: Only `cursor/composer-2.5`. Standard default. Fast requires explicit per-run approval. No GPT/Opus/premium fallbacks. `foundry plan`/`build` hard-fail if unavailable (doctor/setup/init may still run for diagnosis).
- Doctor is the deterministic source of truth for all capability checks (system, pi-cli, cursor-sdk, composer-2.5-standard/fast, git-worktrees, browser-capture, cuadriver, etc.). Status codes and exit codes per spec.
- Plan Mode stops for explicit approval before any Build Mode. Autonomy contract (safe/productive/custom) front-loaded for long runs.
- Artifacts are drafts until approved. Issues are execution commitments. Every issue needs scaled proof (tests, screenshots, citations, etc.).
- Follow the 10-question intent interview policy (product-boundary questions only after exploration; agents resolve impl details via repo inspection + conventions unless intent/irreversible/public/cost/safety/autonomy impact).
- Use git worktrees for parallel independent work (orchestrator reviews/merges; workers never merge themselves). **Max one spare worktree** besides `main`. Do **not** build in `foundry-integration` or `foundry-agent-phase-*` — merged via PR #103. Start from `origin/main` ≥ `09eb047`; read [docs/agents/README.md](docs/agents/README.md) first.
- Smallest change for real feedback. Delete before add. Verify facts live (source/docs/tests/logs/runtime).
- No secrets in committed artifacts or code. Use ~/.foundry/ for machine state, <repo>/.foundry/ for project/run state (never commit actual approvals to public repos).

## Review guidelines

- Any change touching model policy, autonomy taxonomy, doctor matrix, or artifact schema: treat as high-impact; cross-check against RUNNING_SPEC + V1_PLAN.
- PR/issue generation or external writes: must be approval-gated per autonomy contract.
- Before claiming "v1 slice complete": run the exact verification in V1_PLAN.md (unit tests, CLI integration, smoke on fixture or rough idea, artifact usefulness judgment).
- Flag any silent fallback to non-Composer models or skipped doctor checks as P0.
- Test coverage: new logic (especially adapters, planners, run state/resume) must have corresponding tests or deterministic checks.
- Git: always preflight (status/branch/diff/log) per git-branch-worktree-discipline before branch/worktree/push. Prefer separate worktrees for parallel agents.

## Integration with Cascade / Superpowers Skills

When working on this project, invoke these skills (read SKILL.md first; announce usage):

- **obsidian-recall-router** (run qmd_recall.py from vault "Kartik & Hermes") — before strategy, prior decisions, Pi/Hermes context, or vault-related work. Verify recalled facts live.
- **git-branch-worktree-discipline** — before any git state change (clone, branch, worktree, commit, push, reset, etc.). Mandatory preflight + post-inspect. Use worktrees for parallel agents/variants.
- **brainstorming** — before any creative/feature work (even "small" changes). Present design, get approval, write spec to docs/superpowers/specs/..., self-review, user review gate, then writing-plans.
- **writing-plans** + **tdd** / **test-driven-development** — for all multi-step or new functionality (bite-sized, red-green-refactor, exact commands/expected output in plans).
- **verification-before-completion** + **agent-verification-discipline** — before any "done", claim, PR, or milestone. Evidence (runs, diffs, reads, tests) before assertions.
- **repo-inspection** — for deep audits of this or related codebases (structure, manifests, source-of-truth files first).
- **vibe-security** — for security reviews (auth, secrets, RLS, supply-chain).
- **supply-chain-install-protection** + global Socket/sfw rules — for all installs (sfw pnpm/npm, socketdev/action in CI).
- **dispatching-parallel-agents** — when 2+ independent tasks (e.g. powerpack guide polish + Foundry slice).
- **using-superpowers** — at start of any relevant session/task.

## Global + Nearest AGENTS + Scope

Inherits all durable rules from `/Users/user/Agents.md` (do work properly, scope exact, system truth first, protect secrets, nearest AGENTS/docs/lockfiles, prefer rg/apply_patch/project PM, opensrc for internal lib questions, main gh account `kartikkabadi`, direct/concise, surface risks, verify before claim, end with changed/verified/remains, etc.).

**Scope exact**: If user names "Foundry", "V1", specific issue #, "powerpack" (as guide only), Pi runtime, Composer 2.5, or a folder — stay there. Do not mix with unrelated (e.g. do not evolve powerpack into heavy package dep without explicit revival decision).

**Runtimes**: Foundry (this TS/Node CLI) is separate from Pi, the Pi Extension Pack (powerpack guide/assets), Hermes, Codex, OpenCode, etc. Keep configs/skills/auth/memory separate.

Reference nearest project AGENTS (e.g. powerpack/AGENTS.md, clawhip-port/AGENTS.md, dpcode-hermes/AGENTS.md) for patterns.

**Frontend/UI note**: Delegate design pass to OpenCode (per global), then review/fix/verify.

End every piece of work with: what changed, what was verified (commands/output), what remains + risks.

---

*This AGENTS.md added as part of 2026-05 alignment + hygiene baseline milestone (plan execution). Follows V1_PLAN verification requirements.*
