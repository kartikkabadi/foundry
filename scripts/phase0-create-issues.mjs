#!/usr/bin/env node
/**
 * Phase 0: bulk-create V2–V5 GitHub issues from structured slice definitions.
 * Usage: node scripts/phase0-create-issues.mjs [--dry-run]
 */
import { execFileSync, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "kartikkabadi/foundry";
const MILESTONES = {
  1: "V2 Resilient Planning",
  2: "V3 Build Mode",
  3: "V4 Orchestration",
  4: "V5 Product Surface",
};
const DRY = process.argv.includes("--dry-run");
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/** @type {Record<string, number>} */
const nums = {};

function body(slice, what, criteria, blocked, tdd, cli) {
  const blockedSection =
    blocked.length === 0
      ? "None — can start immediately."
      : blocked.map((b) => `- #${nums[b] ?? b}`).join("\n");
  return `## What to build

${what}

## Acceptance criteria

${criteria.map((c) => `- [ ] ${c}`).join("\n")}

## Blocked by

${blockedSection}

## TDD proof

${tdd}

## CLI verify

${cli}`;
}

/** @type {Array<{id:string,title:string,milestone:number,version:string,type:string,blocked:string[],what:string,criteria:string[],tdd:string,cli:string}>} */
const slices = [
  {
    id: "V2-1",
    title: "Merge V1 and close tracker issues #1–#8",
    milestone: 1,
    version: "v2",
    type: "type:hitl",
    blocked: [],
    what: "Complete V1 tracker hygiene: merge the integration branch to main, verify live rehearsal and full test suite on main, and close GitHub issues #1–#8 with proof comments linking the verification commit.",
    criteria: [
      "PR #10 (or equivalent) merged to main with V1 planning runtime",
      "Issues #1–#8 closed with live rehearsal + test count citation",
      "`bash scripts/demo.sh` passes on main",
      "62+ unit tests green via `npm test`",
    ],
    tdd: "Existing `tests/cli.test.ts` and `scripts/demo.sh` must pass on main before close — no new production code required.",
    cli: "```bash\nfnm use 20 && npm test && bash scripts/demo.sh\nFOUNDRY_DEMO_LIVE_PLAN=1 bash scripts/rehearsal-live.sh  # opt-in live\n```\nExit 0 on all deterministic checks.",
  },
  {
    id: "V2-2",
    title: "Runtime schema validation for run.json and doctor JSON",
    milestone: 1,
    version: "v2",
    type: "type:afk",
    blocked: ["V2-1"],
    what: "Add strict runtime validation for `run.json` and doctor JSON output using a schema library. Malformed fixtures must fail fast with actionable errors; valid fixtures continue to load.",
    criteria: [
      "Schema validates all fields in current run.json writer output",
      "Doctor --json output conforms to stable doctor schema",
      "Malformed run.json rejected with clear error on status/resume",
      "Existing run-writer tests updated and green",
    ],
    tdd: "Failing test: `tests/schema-validation.test.ts` — parse malformed run.json fixture, expect validation error before implementation.",
    cli: "```bash\nnpm test -- schema-validation\n# corrupt .foundry/runs/*/run.json field; foundry status exits non-zero\n```",
  },
  {
    id: "V2-3",
    title: "Split run-writer into project-init + run-store",
    milestone: 1,
    version: "v2",
    type: "type:afk",
    blocked: ["V2-1"],
    what: "Decompose the monolithic run-writer module into project-init (`.foundry` layout) and run-store (read/write run.json, status.md). All existing run-writer behavior preserved; no file exceeds thermo-nuclear LOC limits without split plan.",
    criteria: [
      "project-init and run-store modules with clear boundaries",
      "All existing run-writer tests pass unchanged or migrated",
      "init/status/pause/resume commands use new modules",
      "run-writer.ts removed or reduced to re-exports",
    ],
    tdd: "Failing test: import run-store in isolation; existing `tests/run-writer.test.ts` must fail if split breaks write path.",
    cli: "```bash\nnpm test -- run-writer\nfoundry init && foundry status && foundry pause && foundry resume\n```",
  },
  {
    id: "V2-4",
    title: "Move secrets scrub to src/config; fix adapter boundary",
    milestone: 1,
    version: "v2",
    type: "type:afk",
    blocked: ["V2-1"],
    what: "Relocate secrets scrubbing from plan layer to `src/config/`. Ensure adapters never import from `plan/` — config is the shared boundary for auth and secret redaction.",
    criteria: [
      "secrets scrub lives in src/config with unit tests",
      "No adapter imports from plan/",
      "cursor-auth and scrub tests green",
      "doctor --deep still resolves auth without leaking secrets",
    ],
    tdd: "Failing test: `tests/config-secrets.test.ts` — scrub removes known secret patterns; adapter import boundary lint or test fails on plan/ import.",
    cli: "```bash\nnpm test -- cursor-auth config-secrets\nfoundry doctor --deep --for plan\n```",
  },
  {
    id: "V2-5",
    title: "Plan checkpoint resume (re-enter orchestrate at run.phase)",
    milestone: 1,
    version: "v2",
    type: "type:afk",
    blocked: ["V2-2", "V2-3"],
    what: "Persist plan orchestration phase in run.json so a killed or paused plan can resume from the last checkpoint instead of restarting intake. `foundry resume` re-enters orchestrate at run.phase.",
    criteria: [
      "run.json records current plan phase and completed steps",
      "Simulated mid-plan crash resumes and completes artifacts",
      "Resume skips already-written artifact slots",
      "No duplicate artifact writes on resume",
    ],
    tdd: "Failing test: `tests/plan-resume.test.ts` — mock orchestrate crash at phase N; resume completes remaining artifacts.",
    cli: "```bash\n# start plan, kill mid-run, foundry resume completes summary.md..build-goal.md\nfoundry plan \"fixture idea\" && foundry resume\n```",
  },
  {
    id: "V2-6",
    title: "Wire budget profiles quick/deep/marathon to agent-pass limits",
    milestone: 1,
    version: "v2",
    type: "type:afk",
    blocked: ["V2-5"],
    what: "Connect `--budget quick|deep|marathon` CLI flag to agent-pass limits, phase caps, and checkpoint intervals recorded in run.json.",
    criteria: [
      "quick/deep/marathon profiles defined in config",
      "foundry plan --budget quick limits agent passes measurably",
      "Budget recorded in run.json for status/TUI consumption",
      "Default budget matches DECISIONS spec",
    ],
    tdd: "Failing test: `tests/budget-profiles.test.ts` — quick profile stops earlier than marathon in mock orchestrate.",
    cli: "```bash\nfoundry plan \"test\" --budget quick\nfoundry status  # shows budget profile\n```",
  },
  {
    id: "V2-7",
    title: "foundry approve command (awaiting_approval → approved)",
    milestone: 1,
    version: "v2",
    type: "type:afk",
    blocked: ["V2-2"],
    what: "Implement `foundry approve` to transition run state from awaiting_approval to approved. Build Mode and publish remain blocked until approved.",
    criteria: [
      "foundry approve transitions run.json approval state",
      "build command fails without approved run",
      "status reflects approval state clearly",
      "Approve is idempotent or safely re-runnable",
    ],
    tdd: "Failing test: `tests/approve.test.ts` — approve transitions state; build preflight rejects unapproved run.",
    cli: "```bash\nfoundry plan \"...\"  # completes to awaiting_approval\nfoundry approve && foundry status\nfoundry build  # still stub but preflight passes approval gate\n```",
  },
  {
    id: "V2-8",
    title: "Expanded doctor matrix (pi-runtime, composer-fast, browser, cuadriver, skills)",
    milestone: 1,
    version: "v2",
    type: "type:afk",
    blocked: ["V2-1"],
    what: "Extend doctor with checks for pi-runtime, composer-fast (warn-only unless explicit), browser-capture, cuadriver, and skills presence per OPEN_QUESTIONS doctor matrix.",
    criteria: [
      "Each new check has unit test with injected deps",
      "doctor --for all runs expanded matrix",
      "Optional checks warn; required checks fail exit 1",
      "JSON report includes new check IDs",
    ],
    tdd: "Failing test per check in `tests/doctor-expanded.test.ts` — injected missing capability fails/warns per matrix.",
    cli: "```bash\nfoundry doctor --for all\nfoundry doctor --for all --deep --json\n```",
  },
  {
    id: "V2-9",
    title: "events.jsonl + comms thread artifacts (minimal)",
    milestone: 1,
    version: "v2",
    type: "type:afk",
    blocked: ["V2-2"],
    what: "Append structured events to events.jsonl during Plan Mode. No raw agent transcripts in git-tracked artifacts; comms thread summarizes handoffs.",
    criteria: [
      "Plan writes events.jsonl with typed event records",
      "Events schema validated alongside run.json",
      "No raw transcript blobs in artifact tree",
      "status.md references latest event summary",
    ],
    tdd: "Failing test: `tests/events.test.ts` — plan append writes valid JSONL lines; transcript path rejected.",
    cli: "```bash\nfoundry plan \"fixture\"\ncat .foundry/runs/*/events.jsonl | head\n```",
  },
  {
    id: "V2-10",
    title: "packages/* modularization (cli, core, doctor, adapters, planner)",
    milestone: 1,
    version: "v2",
    type: "type:afk",
    blocked: ["V2-3", "V2-4"],
    what: "Extract packages/cli, core, doctor, adapters, planner from monolith. Bin entry still works; install.sh and demo.sh unchanged from user perspective.",
    criteria: [
      "packages/* layout with workspace config",
      "All tests pass; bin resolves correctly",
      "No circular deps between packages",
      "install.sh + demo.sh green",
    ],
    tdd: "Failing test: package boundary import test — planner must not import cli.",
    cli: "```bash\nbash scripts/install.sh && bash scripts/demo.sh\nnpm test\n```",
  },
  // V3
  {
    id: "V3-1",
    title: "foundry build command skeleton + preflight",
    milestone: 2,
    version: "v3",
    type: "type:afk",
    blocked: ["V2-7"],
    what: "Replace build stub with real command entry: doctor preflight for build, approved-run gate, and initial run.json phase transition into build mode.",
    criteria: [
      "foundry build fails without approved run",
      "Build preflight uses doctor --for build",
      "run.json records build phase entry",
      "Unapproved plan exits non-zero with clear message",
    ],
    tdd: "Failing test: `tests/build-preflight.test.ts` — build rejects unapproved; passes with approved fixture.",
    cli: "```bash\nfoundry approve && foundry build  # exits 0 start\nfoundry build  # without approve exits 1\n```",
  },
  {
    id: "V3-2",
    title: "Parse issue-plan.md into execution graph",
    milestone: 2,
    version: "v3",
    type: "type:afk",
    blocked: ["V3-1"],
    what: "Parse issue-plan.md into a DAG of execution slices with dependency edges. Detect cycles and report actionable errors. Support dry-run listing of execution order.",
    criteria: [
      "Valid issue-plan produces topological order",
      "Cycles rejected with error",
      "foundry build --dry-run lists order",
      "Missing deps flagged",
    ],
    tdd: "Failing test: `tests/issue-plan-graph.test.ts` — cycle fixture throws; linear plan orders correctly.",
    cli: "```bash\nfoundry build --dry-run\n```",
  },
  {
    id: "V3-3",
    title: "Git worktree adapter (create, list, cleanup)",
    milestone: 2,
    version: "v3",
    type: "type:afk",
    blocked: ["V3-1"],
    what: "Adapter for creating, listing, and cleaning git worktrees for build workers. Integrates with doctor git-worktrees check.",
    criteria: [
      "Create worktree on temp branch per issue",
      "List active foundry worktrees",
      "Cleanup removes worktree and branch safely",
      "Tests use temp git repo fixture",
    ],
    tdd: "Failing test: `tests/worktree-adapter.test.ts` — create/list/remove roundtrip on temp repo.",
    cli: "```bash\nfoundry doctor  # git-worktrees green\n# build creates .worktrees/foundry-* visible via git worktree list\n```",
  },
  {
    id: "V3-4",
    title: "Serial issue worker (one issue, one worktree)",
    milestone: 2,
    version: "v3",
    type: "type:afk",
    blocked: ["V3-2", "V3-3"],
    what: "Execute one issue slice serially: spawn worker in worktree, run mock/real agent pass, write changes, stop at review gate.",
    criteria: [
      "One active worker per build run by default",
      "Worker isolated in dedicated worktree",
      "Build records issue start/complete in run.json",
      "Mock agent path writes verifiable file change",
    ],
    tdd: "Failing test: `tests/build-worker.test.ts` — serial worker completes fixture issue #1.",
    cli: "```bash\nfoundry build  # fixture repo executes issue 1\n```",
  },
  {
    id: "V3-5",
    title: "Proof registry by issue type (code/ui/docs/config/research)",
    milestone: 2,
    version: "v3",
    type: "type:afk",
    blocked: ["V3-4"],
    what: "Validate proofs per issue type: tests for code, screenshots for UI, citations for research, etc. Write proof.json alongside issue completion.",
    criteria: [
      "Proof types defined in registry",
      "Missing proof blocks issue completion",
      "proof.json schema validated",
      "Each type has unit test fixture",
    ],
    tdd: "Failing test: `tests/proof-registry.test.ts` — each type validates/pass/fail cases.",
    cli: "```bash\nfoundry build  # writes .foundry/runs/*/proofs/<issue>.json\n```",
  },
  {
    id: "V3-6",
    title: "Autonomy enforcement during build (install/commit gates)",
    milestone: 2,
    version: "v3",
    type: "type:afk",
    blocked: ["V3-4"],
    what: "Enforce autonomy contract during build: npm install, git commit, and external writes require approval per safe/productive/custom profile.",
    criteria: [
      "Denied actions pause and prompt (or fail in safe mode)",
      "Autonomy profile read from project config",
      "Tests cover install and commit gates",
      "Audit trail in events.jsonl",
    ],
    tdd: "Failing test: `tests/build-autonomy.test.ts` — install denied without approval in safe profile.",
    cli: "```bash\nfoundry build  # worker attempts npm install; prompts or blocks\n```",
  },
  {
    id: "V3-7",
    title: "Orchestrator review gate before merge",
    milestone: 2,
    version: "v3",
    type: "type:hitl",
    blocked: ["V3-4"],
    what: "Worker stops after issue completion; orchestrator reviews proof and diffs before merge. Human can approve/reject/request changes.",
    criteria: [
      "Review state machine in run.json",
      "Worker cannot self-merge",
      "Reject returns issue to in_progress",
      "Review status visible in foundry status",
    ],
    tdd: "Failing test: `tests/orchestrator-review.test.ts` — merge blocked until review approved.",
    cli: "```bash\nfoundry build  # stops at review\nfoundry status  # shows awaiting_review\n```",
  },
  {
    id: "V3-8",
    title: "Deferred issue recording + build-goal completion",
    milestone: 2,
    version: "v3",
    type: "type:afk",
    blocked: ["V3-5"],
    what: "Record deferred issues in run.json when blocked or skipped. Build Goal remains incomplete until deferred items resolved or explicitly waived.",
    criteria: [
      "Defer action writes run.json deferred list",
      "Build summary lists deferred issues",
      "Build goal incomplete until deferred cleared",
      "Waive requires explicit approval",
    ],
    tdd: "Failing test: `tests/build-defer.test.ts` — defer marks goal incomplete; resolve completes.",
    cli: "```bash\nfoundry build --defer <issue>\nfoundry status  # shows deferred count\n```",
  },
  {
    id: "V3-9",
    title: "foundry build resume after pause/rate-limit",
    milestone: 2,
    version: "v3",
    type: "type:afk",
    blocked: ["V2-5", "V3-4"],
    what: "Resume Build Mode from checkpoint: same issue slice, same worktree reference, after pause or Composer rate limit.",
    criteria: [
      "Pause mid-build preserves issue + worktree id",
      "Resume continues same slice without restart",
      "Rate-limit checkpoint uses same Composer model",
      "No duplicate merges on resume",
    ],
    tdd: "Failing test: `tests/build-resume.test.ts` — pause mid-issue; resume completes.",
    cli: "```bash\nfoundry build & sleep 5 && foundry pause && foundry resume\n```",
  },
  {
    id: "V3-10",
    title: "End-to-end fixture: plan → approve → build → proofs",
    milestone: 2,
    version: "v3",
    type: "type:afk",
    blocked: ["V3-1", "V3-2", "V3-3", "V3-4", "V3-5", "V3-6", "V3-7", "V3-8", "V3-9"],
    what: "Integration fixture script demo-build.sh: full path from plan artifacts through approve, serial build, proofs, and build-goal check with mock Composer.",
    criteria: [
      "scripts/demo-build.sh exits 0 in CI",
      "Uses fixture repo; no live Composer in CI",
      "Documents FOUNDRY_DEMO_LIVE_BUILD=1 opt-in path",
      "README updated with build demo instructions",
    ],
    tdd: "Failing test: integration test invoked by demo-build.sh before script exists.",
    cli: "```bash\nbash scripts/demo-build.sh\nFOUNDRY_DEMO_LIVE_BUILD=1 bash scripts/demo-build.sh  # opt-in\n```",
  },
  // V4
  {
    id: "V4-1",
    title: "Parallel build when issue DAG proves independence",
    milestone: 3,
    version: "v4",
    type: "type:afk",
    blocked: ["V3-2"],
    what: "When issue DAG has independent branches, run up to N workers in parallel with path conflict detection. Serial fallback when shared paths detected.",
    criteria: [
      "Parallel only when no shared file paths predicted",
      "--parallel N flag respected",
      "Max 3 concurrent worktrees default",
      "Conflict detection falls back to serial",
    ],
    tdd: "Failing test: `tests/parallel-build.test.ts` — independent issues run parallel; shared path serializes.",
    cli: "```bash\nfoundry build --parallel 2\n```",
  },
  {
    id: "V4-2",
    title: "Exploration swarm (multi-agent research + provenance)",
    milestone: 3,
    version: "v4",
    type: "type:afk",
    blocked: ["V2-5"],
    what: "Plan Mode swarm: multiple research agents explore in parallel, merge findings with citations into planning artifacts.",
    criteria: [
      "foundry plan --swarm research spawns N branches",
      "Provenance links in summary/prd",
      "Swarm budget respects profile limits",
      "No orphan branches left uncleaned",
    ],
    tdd: "Failing test: `tests/plan-swarm.test.ts` — mock swarm merges citations.",
    cli: "```bash\nfoundry plan \"research topic\" --swarm research\n```",
  },
  {
    id: "V4-3",
    title: "Team spec TOML format + validator",
    milestone: 3,
    version: "v4",
    type: "type:afk",
    blocked: ["V2-1"],
    what: "Define team pack TOML schema (roles, reports_to, capabilities). Validate on init; invalid spec fails with line-level errors.",
    criteria: [
      "TOML schema documented",
      "foundry init --team pack loads team spec",
      "Invalid TOML fails validation",
      "Team spec stored in .foundry/config.toml",
    ],
    tdd: "Failing test: `tests/team-spec.test.ts` — invalid fixture rejected.",
    cli: "```bash\nfoundry init --team pack\n```",
  },
  {
    id: "V4-4",
    title: "Agent comms contracts (reports_to, must_publish)",
    milestone: 3,
    version: "v4",
    type: "type:afk",
    blocked: ["V4-3"],
    what: "Enforce comms contracts: agents with must_publish emit handoff.md; reports_to chain validated before build proceeds.",
    criteria: [
      "Missing handoff fails build for governed roles",
      "handoff.md template populated",
      "reports_to cycle detection",
      "Events log handoff publication",
    ],
    tdd: "Failing test: `tests/comms-contracts.test.ts` — missing handoff fails.",
    cli: "```bash\nfoundry build  # emits handoff.md per team spec\n```",
  },
  {
    id: "V4-5",
    title: "Loop detection + agent-pass budget enforcement",
    milestone: 3,
    version: "v4",
    type: "type:afk",
    blocked: ["V2-6"],
    what: "Detect agent loops (repeated tool calls, no progress) and enforce agent-pass budget with intervention/warn.",
    criteria: [
      "Loop signal triggers warning then pause",
      "Budget exhaustion stops run cleanly",
      "Loop events in events.jsonl",
      "Marathon mode uses stricter thresholds (V5 extends)",
    ],
    tdd: "Failing test: `tests/loop-detection.test.ts` — repeated action triggers loop signal.",
    cli: "```bash\nfoundry plan --budget marathon  # warns on loop in live opt-in\n```",
  },
  {
    id: "V4-6",
    title: "Rate-limit checkpointing (Composer pause, no model fallback)",
    milestone: 3,
    version: "v4",
    type: "type:afk",
    blocked: ["V2-5"],
    what: "On Composer rate limit, checkpoint run.json and pause — never silently fall back to non-Composer models.",
    criteria: [
      "Rate limit writes checkpoint + paused state",
      "Resume uses same cursor/composer-2.5 model",
      "User notified of rate limit reason",
      "Doctor confirms composer still required on resume",
    ],
    tdd: "Failing test: `tests/rate-limit-checkpoint.test.ts` — simulated 429 pauses; no model swap.",
    cli: "```bash\n# simulate rate limit in mock adapter; foundry resume continues\n```",
  },
  {
    id: "V4-7",
    title: "Conflict artifacts pipeline",
    milestone: 3,
    version: "v4",
    type: "type:afk",
    blocked: ["V4-4"],
    what: "When agents disagree, write conflict.md linked to PRD section. Orchestrator resolves before merge.",
    criteria: [
      "conflict.md schema with PRD links",
      "Plan/build records open conflicts",
      "Resolved conflicts archived in run folder",
      "Status shows open conflict count",
    ],
    tdd: "Failing test: `tests/conflict-artifacts.test.ts` — conflict blocks merge until resolved.",
    cli: "```bash\nfoundry plan  # records conflict when swarm disagrees\n```",
  },
  {
    id: "V4-8",
    title: "Browser reference capture adapter (v1 boundary)",
    milestone: 3,
    version: "v4",
    type: "type:afk",
    blocked: ["V2-8"],
    what: "Adapter captures browser references into summarized requirements for Plan Mode. Doctor browser-capture check gates availability.",
    criteria: [
      "Capture produces requirements snippet artifact",
      "Doctor browser-capture check integrated",
      "No raw page dumps in git artifacts",
      "Graceful degrade when browser unavailable",
    ],
    tdd: "Failing test: `tests/browser-capture.test.ts` — mock capture summarizes URL.",
    cli: "```bash\nfoundry doctor --deep  # browser-capture check\nfoundry plan --reference https://example.com\n```",
  },
  {
    id: "V4-9",
    title: "CuaDriver adapter boundary (optional capability)",
    milestone: 3,
    version: "v4",
    type: "type:afk",
    blocked: ["V2-8"],
    what: "Optional CuaDriver adapter for macOS GUI automation. Warn-only in default doctor; required only with --deep or explicit flag.",
    criteria: [
      "cuadriver check in doctor matrix",
      "Adapter isolated; plan/build opt-in",
      "Warn when missing unless --deep",
      "No hard dependency on cuadriver for core flows",
    ],
    tdd: "Failing test: `tests/cuadriver-adapter.test.ts` — missing driver warns not fails by default.",
    cli: "```bash\nfoundry doctor --deep  # cuadriver optional\n```",
  },
  {
    id: "V4-10",
    title: "Pi runtime adapter (beyond pi-cli check)",
    milestone: 3,
    version: "v4",
    type: "type:afk",
    blocked: ["V2-8"],
    what: "Invoke Pi runtime for setup/plan smoke beyond pi-cli presence check. Mock path for CI; live path for doctor --deep.",
    criteria: [
      "Pi adapter with mock invoke for tests",
      "setup uses Pi path when available",
      "Doctor pi-runtime check beyond pi-cli",
      "Clear error when Pi unavailable",
    ],
    tdd: "Failing test: `tests/pi-runtime-adapter.test.ts` — mock invoke returns success.",
    cli: "```bash\nfoundry setup\nfoundry doctor --for all --deep\n```",
  },
  // V5
  {
    id: "V5-1",
    title: "TUI consuming run.json + status.md (no schema rework)",
    milestone: 4,
    version: "v5",
    type: "type:afk",
    blocked: ["V2-2"],
    what: "Terminal UI reads run.json and status.md for live run monitoring. No duplicate schema — render from validated run state.",
    criteria: [
      "foundry tui attaches to active run",
      "Renders phase, budget, approval state",
      "TUI render tests from fixture run.json",
      "Clean exit on detach",
    ],
    tdd: "Failing test: `tests/tui-render.test.ts` — fixture run.json renders expected panels.",
    cli: "```bash\nfoundry tui  # attaches to latest run\n```",
  },
  {
    id: "V5-2",
    title: "Background daemon + attach/detach",
    milestone: 4,
    version: "v5",
    type: "type:afk",
    blocked: ["V5-1"],
    what: "Daemon process holds Run alive across terminal detach. foundry daemon start/stop; TUI re-attaches.",
    criteria: [
      "Daemon lifecycle start/stop/status",
      "Run continues after terminal close",
      "PID file in .foundry with cleanup",
      "Tests use mock daemon lifecycle",
    ],
    tdd: "Failing test: `tests/daemon-lifecycle.test.ts` — start/stop roundtrip.",
    cli: "```bash\nfoundry daemon start && foundry tui\nfoundry daemon stop\n```",
  },
  {
    id: "V5-3",
    title: "Local macOS notifications (approval, rate limit)",
    milestone: 4,
    version: "v5",
    type: "type:afk",
    blocked: ["V2-7"],
    what: "Opt-in macOS notifications for awaiting_approval and rate-limit pause events.",
    criteria: [
      "Setup enables/disables notifications",
      "Approval waiting triggers notification",
      "Rate-limit pause triggers notification",
      "No notification when disabled",
    ],
    tdd: "Failing test: `tests/notifications-macos.test.ts` — mock notifier called on events.",
    cli: "```bash\nfoundry setup  # enable notifications\nfoundry plan  # triggers on awaiting_approval\n```",
  },
  {
    id: "V5-4",
    title: "Slack/Telegram/webhook notification adapters",
    milestone: 4,
    version: "v5",
    type: "type:afk",
    blocked: ["V5-3"],
    what: "Webhook adapters for Slack, Telegram, and generic HTTP webhooks. Dry-run mode validates config without sending.",
    criteria: [
      "Adapter contract tests per channel",
      "Config in ~/.foundry/notifications.toml",
      "Dry-run validates payload shape",
      "Secrets not logged",
    ],
    tdd: "Failing test: `tests/notifications-webhook.test.ts` — dry-run payload matches schema.",
    cli: "```bash\nfoundry notify --dry-run --event approval_waiting\n```",
  },
  {
    id: "V5-5",
    title: "Marathon multi-day run policy + anti-loop strictness",
    milestone: 4,
    version: "v5",
    type: "type:afk",
    blocked: ["V4-5"],
    what: "Marathon budget: multi-day checkpoint intervals, stricter loop detection, scheduled pause for human review.",
    criteria: [
      "Marathon checkpoint interval configurable",
      "Stricter loop thresholds than deep",
      "Scheduled review pauses recorded",
      "run.json marathon metadata",
    ],
    tdd: "Failing test: `tests/marathon-policy.test.ts` — marathon triggers review pause at interval.",
    cli: "```bash\nfoundry plan --budget marathon\n```",
  },
  {
    id: "V5-6",
    title: "Agent-guided setup (AI loop over doctor, not deterministic only)",
    milestone: 4,
    version: "v5",
    type: "type:afk",
    blocked: ["V4-10"],
    what: "Enhance setup with bounded agent loop over doctor results — AI suggests fixes, doctor re-verifies. Deterministic path remains default.",
    criteria: [
      "Agent setup bounded turn count",
      "Re-runs doctor after each suggestion",
      "Expert mode skips agent loop",
      "No unsafe auto-fixes",
    ],
    tdd: "Failing test: `tests/setup-agent.test.ts` — mock agent loop bounded; doctor re-run.",
    cli: "```bash\nfoundry setup  # agent-guided path\n```",
  },
  {
    id: "V5-7",
    title: "GitHub private repo creation (approval-gated)",
    milestone: 4,
    version: "v5",
    type: "type:hitl",
    blocked: ["V3-6"],
    what: "Optional build flag to create GitHub private repo — blocked without explicit approval per autonomy contract.",
    criteria: [
      "foundry build --create-repo prompts approval",
      "Safe profile always blocks",
      "Creates repo only after approve",
      "No secrets in logs",
    ],
    tdd: "Failing test: `tests/create-repo-gate.test.ts` — blocked without approval.",
    cli: "```bash\nfoundry build --create-repo  # asks before gh repo create\n```",
  },
  {
    id: "V5-8",
    title: "npm primary distribution + self-update",
    milestone: 4,
    version: "v5",
    type: "type:afk",
    blocked: ["V2-10"],
    what: "Publish foundry to npm as primary install path. Self-update command checks registry version.",
    criteria: [
      "npm pack/publish documented",
      "CI container installs via npm i -g",
      "foundry update checks npm registry",
      "install.sh delegates to npm when available",
    ],
    tdd: "Failing test: `tests/npm-distribution.test.ts` — pack contents include bin.",
    cli: "```bash\nnpm i -g . && foundry --version\nfoundry update --dry-run\n```",
  },
  {
    id: "V5-9",
    title: "Powerpack guide integration (agent-feedable setup path)",
    milestone: 4,
    version: "v5",
    type: "type:afk",
    blocked: ["V5-6"],
    what: "Wire powerpack guide into setup/doctor recommendations as agent-feedable documentation path (guide only, not heavy package dep).",
    criteria: [
      "setup references powerpack guide URL/path",
      "doctor recommends guide when Pi extension missing",
      "Docs link from README",
      "No new required npm dep on powerpack",
    ],
    tdd: "Failing test: `tests/powerpack-guide.test.ts` — doctor message includes guide link.",
    cli: "```bash\nfoundry setup  # mentions powerpack guide\nfoundry doctor\n```",
  },
  {
    id: "V5-10",
    title: "Production hardening: CONTEXT.md, full doctor lock, V5 verification suite",
    milestone: 4,
    version: "v5",
    type: "type:afk",
    blocked: ["V5-1", "V5-2", "V5-3", "V5-4", "V5-5", "V5-6", "V5-7", "V5-8", "V5-9"],
    what: "Final V5 hardening: CONTEXT.md glossary current, doctor matrix locked per OPEN_QUESTIONS, full verification suite documented and green.",
    criteria: [
      "CONTEXT.md matches product language",
      "All scripts green: demo, demo-build, rehearsal",
      "Verification matrix in docs/planning/",
      "No P0 doctor gaps vs OPEN_QUESTIONS",
    ],
    tdd: "Failing test: `tests/v5-verification-matrix.test.ts` — documents required commands.",
    cli: "```bash\nnpm test && bash scripts/demo.sh && bash scripts/demo-build.sh\n```",
  },
];

function writeIssuesMd() {
  const lines = [
    "# Foundry V2–V5 GitHub Issues",
    "",
    "Created: 2026-05-24",
    "Source: V2-V5 master plan",
    "Template: Matt Pocock to-issues + TDD proof + CLI verify",
    "",
  ];
  for (const s of slices) {
    lines.push(`---`, "", `## ${s.id}: ${s.title}`, "");
    lines.push(body(s.id, s.what, s.criteria, s.blocked, s.tdd, s.cli));
    lines.push("");
  }
  writeFileSync(
    join(ROOT, "docs/planning/V2-V5_GITHUB_ISSUES.md"),
    lines.join("\n")
  );
}

function createIssues() {
  for (const s of slices) {
    const issueBody = body(
      s.id,
      s.what,
      s.criteria,
      s.blocked,
      s.tdd,
      s.cli
    );
    const labels = `${s.version},${s.type},enhancement`;
    if (DRY) {
      console.log(`[dry-run] ${s.id}: ${s.title}`);
      nums[s.id] = 9000 + slices.indexOf(s);
      continue;
    }
    const out = execFileSync(
      "gh",
      [
        "issue",
        "create",
        "--repo",
        REPO,
        "--title",
        `[${s.id}] ${s.title}`,
        "--label",
        labels,
        "--milestone",
        MILESTONES[s.milestone],
        "--body",
        issueBody,
      ],
      { encoding: "utf8" }
    ).trim();
    const m = out.match(/issues\/(\d+)/);
    if (!m) throw new Error(`No issue number in: ${out}`);
    nums[s.id] = Number(m[1]);
    console.log(`${s.id} -> #${nums[s.id]}`);
  }
}

function main() {
  writeIssuesMd();
  createIssues();
  writeIssuesMd(); // second pass with resolved issue numbers in Blocked by

  // Close V2-1 immediately (Phase 0 completed the work)
  if (!DRY && nums["V2-1"]) {
    execSync(
      `gh issue close ${nums["V2-1"]} --repo ${REPO} --comment "Completed in Phase 0: PR #10 merged to main; issues #1–#8 closed with live rehearsal proof (62 tests, commit f600840)."`,
      { stdio: "inherit" }
    );
  }

  console.log("\nIssue map:", JSON.stringify(nums, null, 2));
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("phase0-create-issues.mjs") ||
    process.argv[1].includes("phase0-create-issues"));

if (isMain) main();
