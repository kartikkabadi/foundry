# Foundry V2–V5 GitHub Issues

Created: 2026-05-24
Source: V2-V5 master plan
Template: Matt Pocock to-issues + TDD proof + CLI verify

## Published issue index

| Slice | GitHub | Milestone |
|-------|--------|-----------|
| V2-1 | [#11](https://github.com/kartikkabadi/foundry/issues/11) | V2 Resilient Planning |
| V2-2 | [#12](https://github.com/kartikkabadi/foundry/issues/12) | V2 Resilient Planning |
| V2-3 | [#13](https://github.com/kartikkabadi/foundry/issues/13) | V2 Resilient Planning |
| V2-4 | [#14](https://github.com/kartikkabadi/foundry/issues/14) | V2 Resilient Planning |
| V2-5 | [#15](https://github.com/kartikkabadi/foundry/issues/15) | V2 Resilient Planning |
| V2-6 | [#16](https://github.com/kartikkabadi/foundry/issues/16) | V2 Resilient Planning |
| V2-7 | [#17](https://github.com/kartikkabadi/foundry/issues/17) | V2 Resilient Planning |
| V2-8 | [#18](https://github.com/kartikkabadi/foundry/issues/18) | V2 Resilient Planning |
| V2-9 | [#19](https://github.com/kartikkabadi/foundry/issues/19) | V2 Resilient Planning |
| V2-10 | [#20](https://github.com/kartikkabadi/foundry/issues/20) | V2 Resilient Planning |
| V3-1 | [#21](https://github.com/kartikkabadi/foundry/issues/21) | V3 Build Mode |
| V3-2 | [#22](https://github.com/kartikkabadi/foundry/issues/22) | V3 Build Mode |
| V3-3 | [#23](https://github.com/kartikkabadi/foundry/issues/23) | V3 Build Mode |
| V3-4 | [#24](https://github.com/kartikkabadi/foundry/issues/24) | V3 Build Mode |
| V3-5 | [#25](https://github.com/kartikkabadi/foundry/issues/25) | V3 Build Mode |
| V3-6 | [#26](https://github.com/kartikkabadi/foundry/issues/26) | V3 Build Mode |
| V3-7 | [#27](https://github.com/kartikkabadi/foundry/issues/27) | V3 Build Mode |
| V3-8 | [#28](https://github.com/kartikkabadi/foundry/issues/28) | V3 Build Mode |
| V3-9 | [#29](https://github.com/kartikkabadi/foundry/issues/29) | V3 Build Mode |
| V3-10 | [#30](https://github.com/kartikkabadi/foundry/issues/30) | V3 Build Mode |
| V4-1 | [#31](https://github.com/kartikkabadi/foundry/issues/31) | V4 Orchestration |
| V4-2 | [#32](https://github.com/kartikkabadi/foundry/issues/32) | V4 Orchestration |
| V4-3 | [#33](https://github.com/kartikkabadi/foundry/issues/33) | V4 Orchestration |
| V4-4 | [#34](https://github.com/kartikkabadi/foundry/issues/34) | V4 Orchestration |
| V4-5 | [#35](https://github.com/kartikkabadi/foundry/issues/35) | V4 Orchestration |
| V4-6 | [#36](https://github.com/kartikkabadi/foundry/issues/36) | V4 Orchestration |
| V4-7 | [#37](https://github.com/kartikkabadi/foundry/issues/37) | V4 Orchestration |
| V4-8 | [#38](https://github.com/kartikkabadi/foundry/issues/38) | V4 Orchestration |
| V4-9 | [#39](https://github.com/kartikkabadi/foundry/issues/39) | V4 Orchestration |
| V4-10 | [#40](https://github.com/kartikkabadi/foundry/issues/40) | V4 Orchestration |
| V5-1 | [#41](https://github.com/kartikkabadi/foundry/issues/41) | V5 Product Surface |
| V5-2 | [#42](https://github.com/kartikkabadi/foundry/issues/42) | V5 Product Surface |
| V5-3 | [#43](https://github.com/kartikkabadi/foundry/issues/43) | V5 Product Surface |
| V5-4 | [#44](https://github.com/kartikkabadi/foundry/issues/44) | V5 Product Surface |
| V5-5 | [#45](https://github.com/kartikkabadi/foundry/issues/45) | V5 Product Surface |
| V5-6 | [#46](https://github.com/kartikkabadi/foundry/issues/46) | V5 Product Surface |
| V5-7 | [#47](https://github.com/kartikkabadi/foundry/issues/47) | V5 Product Surface |
| V5-8 | [#48](https://github.com/kartikkabadi/foundry/issues/48) | V5 Product Surface |
| V5-9 | [#49](https://github.com/kartikkabadi/foundry/issues/49) | V5 Product Surface |
| V5-10 | [#50](https://github.com/kartikkabadi/foundry/issues/50) | V5 Product Surface |

---

## V2-1: Merge V1 and close tracker issues #1–#8

## What to build

Complete V1 tracker hygiene: merge the integration branch to main, verify live rehearsal and full test suite on main, and close GitHub issues #1–#8 with proof comments linking the verification commit.

## Acceptance criteria

- [ ] PR #10 (or equivalent) merged to main with V1 planning runtime
- [ ] Issues #1–#8 closed with live rehearsal + test count citation
- [ ] `bash scripts/demo.sh` passes on main
- [ ] 62+ unit tests green via `npm test`

## Blocked by

None — can start immediately.

## TDD proof

Existing `tests/cli.test.ts` and `scripts/demo.sh` must pass on main before close — no new production code required.

## CLI verify

```bash
fnm use 20 && npm test && bash scripts/demo.sh
FOUNDRY_DEMO_LIVE_PLAN=1 bash scripts/rehearsal-live.sh  # opt-in live
```
Exit 0 on all deterministic checks.

---

## V2-2: Runtime schema validation for run.json and doctor JSON

## What to build

Add strict runtime validation for `run.json` and doctor JSON output using a schema library. Malformed fixtures must fail fast with actionable errors; valid fixtures continue to load.

## Acceptance criteria

- [ ] Schema validates all fields in current run.json writer output
- [ ] Doctor --json output conforms to stable doctor schema
- [ ] Malformed run.json rejected with clear error on status/resume
- [ ] Existing run-writer tests updated and green

## Blocked by

- #11

## TDD proof

Failing test: `tests/schema-validation.test.ts` — parse malformed run.json fixture, expect validation error before implementation.

## CLI verify

```bash
npm test -- schema-validation
# corrupt .foundry/runs/*/run.json field; foundry status exits non-zero
```

---

## V2-3: Split run-writer into project-init + run-store

## What to build

Decompose the monolithic run-writer module into project-init (`.foundry` layout) and run-store (read/write run.json, status.md). All existing run-writer behavior preserved; no file exceeds thermo-nuclear LOC limits without split plan.

## Acceptance criteria

- [ ] project-init and run-store modules with clear boundaries
- [ ] All existing run-writer tests pass unchanged or migrated
- [ ] init/status/pause/resume commands use new modules
- [ ] run-writer.ts removed or reduced to re-exports

## Blocked by

- #11

## TDD proof

Failing test: import run-store in isolation; existing `tests/run-writer.test.ts` must fail if split breaks write path.

## CLI verify

```bash
npm test -- run-writer
foundry init && foundry status && foundry pause && foundry resume
```

---

## V2-4: Move secrets scrub to src/config; fix adapter boundary

## What to build

Relocate secrets scrubbing from plan layer to `src/config/`. Ensure adapters never import from `plan/` — config is the shared boundary for auth and secret redaction.

## Acceptance criteria

- [ ] secrets scrub lives in src/config with unit tests
- [ ] No adapter imports from plan/
- [ ] cursor-auth and scrub tests green
- [ ] doctor --deep still resolves auth without leaking secrets

## Blocked by

- #11

## TDD proof

Failing test: `tests/config-secrets.test.ts` — scrub removes known secret patterns; adapter import boundary lint or test fails on plan/ import.

## CLI verify

```bash
npm test -- cursor-auth config-secrets
foundry doctor --deep --for plan
```

---

## V2-5: Plan checkpoint resume (re-enter orchestrate at run.phase)

## What to build

Persist plan orchestration phase in run.json so a killed or paused plan can resume from the last checkpoint instead of restarting intake. `foundry resume` re-enters orchestrate at run.phase.

## Acceptance criteria

- [ ] run.json records current plan phase and completed steps
- [ ] Simulated mid-plan crash resumes and completes artifacts
- [ ] Resume skips already-written artifact slots
- [ ] No duplicate artifact writes on resume

## Blocked by

- #12
- #13

## TDD proof

Failing test: `tests/plan-resume.test.ts` — mock orchestrate crash at phase N; resume completes remaining artifacts.

## CLI verify

```bash
# start plan, kill mid-run, foundry resume completes summary.md..build-goal.md
foundry plan "fixture idea" && foundry resume
```

---

## V2-6: Wire budget profiles quick/deep/marathon to agent-pass limits

## What to build

Connect `--budget quick|deep|marathon` CLI flag to agent-pass limits, phase caps, and checkpoint intervals recorded in run.json.

## Acceptance criteria

- [ ] quick/deep/marathon profiles defined in config
- [ ] foundry plan --budget quick limits agent passes measurably
- [ ] Budget recorded in run.json for status/TUI consumption
- [ ] Default budget matches DECISIONS spec

## Blocked by

- #15

## TDD proof

Failing test: `tests/budget-profiles.test.ts` — quick profile stops earlier than marathon in mock orchestrate.

## CLI verify

```bash
foundry plan "test" --budget quick
foundry status  # shows budget profile
```

---

## V2-7: foundry approve command (awaiting_approval → approved)

## What to build

Implement `foundry approve` to transition run state from awaiting_approval to approved. Build Mode and publish remain blocked until approved.

## Acceptance criteria

- [ ] foundry approve transitions run.json approval state
- [ ] build command fails without approved run
- [ ] status reflects approval state clearly
- [ ] Approve is idempotent or safely re-runnable

## Blocked by

- #12

## TDD proof

Failing test: `tests/approve.test.ts` — approve transitions state; build preflight rejects unapproved run.

## CLI verify

```bash
foundry plan "..."  # completes to awaiting_approval
foundry approve && foundry status
foundry build  # still stub but preflight passes approval gate
```

---

## V2-8: Expanded doctor matrix (pi-runtime, composer-fast, browser, cuadriver, skills)

## What to build

Extend doctor with checks for pi-runtime, composer-fast (warn-only unless explicit), browser-capture, cuadriver, and skills presence per OPEN_QUESTIONS doctor matrix.

## Acceptance criteria

- [ ] Each new check has unit test with injected deps
- [ ] doctor --for all runs expanded matrix
- [ ] Optional checks warn; required checks fail exit 1
- [ ] JSON report includes new check IDs

## Blocked by

- #11

## TDD proof

Failing test per check in `tests/doctor-expanded.test.ts` — injected missing capability fails/warns per matrix.

## CLI verify

```bash
foundry doctor --for all
foundry doctor --for all --deep --json
```

---

## V2-9: events.jsonl + comms thread artifacts (minimal)

## What to build

Append structured events to events.jsonl during Plan Mode. No raw agent transcripts in git-tracked artifacts; comms thread summarizes handoffs.

## Acceptance criteria

- [ ] Plan writes events.jsonl with typed event records
- [ ] Events schema validated alongside run.json
- [ ] No raw transcript blobs in artifact tree
- [ ] status.md references latest event summary

## Blocked by

- #12

## TDD proof

Failing test: `tests/events.test.ts` — plan append writes valid JSONL lines; transcript path rejected.

## CLI verify

```bash
foundry plan "fixture"
cat .foundry/runs/*/events.jsonl | head
```

---

## V2-10: packages/* modularization (cli, core, doctor, adapters, planner)

## What to build

Extract packages/cli, core, doctor, adapters, planner from monolith. Bin entry still works; install.sh and demo.sh unchanged from user perspective.

## Acceptance criteria

- [ ] packages/* layout with workspace config
- [ ] All tests pass; bin resolves correctly
- [ ] No circular deps between packages
- [ ] install.sh + demo.sh green

## Blocked by

- #13
- #14

## TDD proof

Failing test: package boundary import test — planner must not import cli.

## CLI verify

```bash
bash scripts/install.sh && bash scripts/demo.sh
npm test
```

---

## V3-1: foundry build command skeleton + preflight

## What to build

Replace build stub with real command entry: doctor preflight for build, approved-run gate, and initial run.json phase transition into build mode.

## Acceptance criteria

- [ ] foundry build fails without approved run
- [ ] Build preflight uses doctor --for build
- [ ] run.json records build phase entry
- [ ] Unapproved plan exits non-zero with clear message

## Blocked by

- #17

## TDD proof

Failing test: `tests/build-preflight.test.ts` — build rejects unapproved; passes with approved fixture.

## CLI verify

```bash
foundry approve && foundry build  # exits 0 start
foundry build  # without approve exits 1
```

---

## V3-2: Parse issue-plan.md into execution graph

## What to build

Parse issue-plan.md into a DAG of execution slices with dependency edges. Detect cycles and report actionable errors. Support dry-run listing of execution order.

## Acceptance criteria

- [ ] Valid issue-plan produces topological order
- [ ] Cycles rejected with error
- [ ] foundry build --dry-run lists order
- [ ] Missing deps flagged

## Blocked by

- #21

## TDD proof

Failing test: `tests/issue-plan-graph.test.ts` — cycle fixture throws; linear plan orders correctly.

## CLI verify

```bash
foundry build --dry-run
```

---

## V3-3: Git worktree adapter (create, list, cleanup)

## What to build

Adapter for creating, listing, and cleaning git worktrees for build workers. Integrates with doctor git-worktrees check.

## Acceptance criteria

- [ ] Create worktree on temp branch per issue
- [ ] List active foundry worktrees
- [ ] Cleanup removes worktree and branch safely
- [ ] Tests use temp git repo fixture

## Blocked by

- #21

## TDD proof

Failing test: `tests/worktree-adapter.test.ts` — create/list/remove roundtrip on temp repo.

## CLI verify

```bash
foundry doctor  # git-worktrees green
# build creates .worktrees/foundry-* visible via git worktree list
```

---

## V3-4: Serial issue worker (one issue, one worktree)

## What to build

Execute one issue slice serially: spawn worker in worktree, run mock/real agent pass, write changes, stop at review gate.

## Acceptance criteria

- [ ] One active worker per build run by default
- [ ] Worker isolated in dedicated worktree
- [ ] Build records issue start/complete in run.json
- [ ] Mock agent path writes verifiable file change

## Blocked by

- #22
- #23

## TDD proof

Failing test: `tests/build-worker.test.ts` — serial worker completes fixture issue #1.

## CLI verify

```bash
foundry build  # fixture repo executes issue 1
```

---

## V3-5: Proof registry by issue type (code/ui/docs/config/research)

## What to build

Validate proofs per issue type: tests for code, screenshots for UI, citations for research, etc. Write proof.json alongside issue completion.

## Acceptance criteria

- [ ] Proof types defined in registry
- [ ] Missing proof blocks issue completion
- [ ] proof.json schema validated
- [ ] Each type has unit test fixture

## Blocked by

- #24

## TDD proof

Failing test: `tests/proof-registry.test.ts` — each type validates/pass/fail cases.

## CLI verify

```bash
foundry build  # writes .foundry/runs/*/proofs/<issue>.json
```

---

## V3-6: Autonomy enforcement during build (install/commit gates)

## What to build

Enforce autonomy contract during build: npm install, git commit, and external writes require approval per safe/productive/custom profile.

## Acceptance criteria

- [ ] Denied actions pause and prompt (or fail in safe mode)
- [ ] Autonomy profile read from project config
- [ ] Tests cover install and commit gates
- [ ] Audit trail in events.jsonl

## Blocked by

- #24

## TDD proof

Failing test: `tests/build-autonomy.test.ts` — install denied without approval in safe profile.

## CLI verify

```bash
foundry build  # worker attempts npm install; prompts or blocks
```

---

## V3-7: Orchestrator review gate before merge

## What to build

Worker stops after issue completion; orchestrator reviews proof and diffs before merge. Human can approve/reject/request changes.

## Acceptance criteria

- [ ] Review state machine in run.json
- [ ] Worker cannot self-merge
- [ ] Reject returns issue to in_progress
- [ ] Review status visible in foundry status

## Blocked by

- #24

## TDD proof

Failing test: `tests/orchestrator-review.test.ts` — merge blocked until review approved.

## CLI verify

```bash
foundry build  # stops at review
foundry status  # shows awaiting_review
```

---

## V3-8: Deferred issue recording + build-goal completion

## What to build

Record deferred issues in run.json when blocked or skipped. Build Goal remains incomplete until deferred items resolved or explicitly waived.

## Acceptance criteria

- [ ] Defer action writes run.json deferred list
- [ ] Build summary lists deferred issues
- [ ] Build goal incomplete until deferred cleared
- [ ] Waive requires explicit approval

## Blocked by

- #25

## TDD proof

Failing test: `tests/build-defer.test.ts` — defer marks goal incomplete; resolve completes.

## CLI verify

```bash
foundry build --defer <issue>
foundry status  # shows deferred count
```

---

## V3-9: foundry build resume after pause/rate-limit

## What to build

Resume Build Mode from checkpoint: same issue slice, same worktree reference, after pause or Composer rate limit.

## Acceptance criteria

- [ ] Pause mid-build preserves issue + worktree id
- [ ] Resume continues same slice without restart
- [ ] Rate-limit checkpoint uses same Composer model
- [ ] No duplicate merges on resume

## Blocked by

- #15
- #24

## TDD proof

Failing test: `tests/build-resume.test.ts` — pause mid-issue; resume completes.

## CLI verify

```bash
foundry build & sleep 5 && foundry pause && foundry resume
```

---

## V3-10: End-to-end fixture: plan → approve → build → proofs

## What to build

Integration fixture script demo-build.sh: full path from plan artifacts through approve, serial build, proofs, and build-goal check with mock Composer.

## Acceptance criteria

- [ ] scripts/demo-build.sh exits 0 in CI
- [ ] Uses fixture repo; no live Composer in CI
- [ ] Documents FOUNDRY_DEMO_LIVE_BUILD=1 opt-in path
- [ ] README updated with build demo instructions

## Blocked by

- #21
- #22
- #23
- #24
- #25
- #26
- #27
- #28
- #29

## TDD proof

Failing test: integration test invoked by demo-build.sh before script exists.

## CLI verify

```bash
bash scripts/demo-build.sh
FOUNDRY_DEMO_LIVE_BUILD=1 bash scripts/demo-build.sh  # opt-in
```

---

## V4-1: Parallel build when issue DAG proves independence

## What to build

When issue DAG has independent branches, run up to N workers in parallel with path conflict detection. Serial fallback when shared paths detected.

## Acceptance criteria

- [ ] Parallel only when no shared file paths predicted
- [ ] --parallel N flag respected
- [ ] Max 3 concurrent worktrees default
- [ ] Conflict detection falls back to serial

## Blocked by

- #22

## TDD proof

Failing test: `tests/parallel-build.test.ts` — independent issues run parallel; shared path serializes.

## CLI verify

```bash
foundry build --parallel 2
```

---

## V4-2: Exploration swarm (multi-agent research + provenance)

## What to build

Plan Mode swarm: multiple research agents explore in parallel, merge findings with citations into planning artifacts.

## Acceptance criteria

- [ ] foundry plan --swarm research spawns N branches
- [ ] Provenance links in summary/prd
- [ ] Swarm budget respects profile limits
- [ ] No orphan branches left uncleaned

## Blocked by

- #15

## TDD proof

Failing test: `tests/plan-swarm.test.ts` — mock swarm merges citations.

## CLI verify

```bash
foundry plan "research topic" --swarm research
```

---

## V4-3: Team spec TOML format + validator

## What to build

Define team pack TOML schema (roles, reports_to, capabilities). Validate on init; invalid spec fails with line-level errors.

## Acceptance criteria

- [ ] TOML schema documented
- [ ] foundry init --team pack loads team spec
- [ ] Invalid TOML fails validation
- [ ] Team spec stored in .foundry/config.toml

## Blocked by

- #11

## TDD proof

Failing test: `tests/team-spec.test.ts` — invalid fixture rejected.

## CLI verify

```bash
foundry init --team pack
```

---

## V4-4: Agent comms contracts (reports_to, must_publish)

## What to build

Enforce comms contracts: agents with must_publish emit handoff.md; reports_to chain validated before build proceeds.

## Acceptance criteria

- [ ] Missing handoff fails build for governed roles
- [ ] handoff.md template populated
- [ ] reports_to cycle detection
- [ ] Events log handoff publication

## Blocked by

- #33

## TDD proof

Failing test: `tests/comms-contracts.test.ts` — missing handoff fails.

## CLI verify

```bash
foundry build  # emits handoff.md per team spec
```

---

## V4-5: Loop detection + agent-pass budget enforcement

## What to build

Detect agent loops (repeated tool calls, no progress) and enforce agent-pass budget with intervention/warn.

## Acceptance criteria

- [ ] Loop signal triggers warning then pause
- [ ] Budget exhaustion stops run cleanly
- [ ] Loop events in events.jsonl
- [ ] Marathon mode uses stricter thresholds (V5 extends)

## Blocked by

- #16

## TDD proof

Failing test: `tests/loop-detection.test.ts` — repeated action triggers loop signal.

## CLI verify

```bash
foundry plan --budget marathon  # warns on loop in live opt-in
```

---

## V4-6: Rate-limit checkpointing (Composer pause, no model fallback)

## What to build

On Composer rate limit, checkpoint run.json and pause — never silently fall back to non-Composer models.

## Acceptance criteria

- [ ] Rate limit writes checkpoint + paused state
- [ ] Resume uses same cursor/composer-2.5 model
- [ ] User notified of rate limit reason
- [ ] Doctor confirms composer still required on resume

## Blocked by

- #15

## TDD proof

Failing test: `tests/rate-limit-checkpoint.test.ts` — simulated 429 pauses; no model swap.

## CLI verify

```bash
# simulate rate limit in mock adapter; foundry resume continues
```

---

## V4-7: Conflict artifacts pipeline

## What to build

When agents disagree, write conflict.md linked to PRD section. Orchestrator resolves before merge.

## Acceptance criteria

- [ ] conflict.md schema with PRD links
- [ ] Plan/build records open conflicts
- [ ] Resolved conflicts archived in run folder
- [ ] Status shows open conflict count

## Blocked by

- #34

## TDD proof

Failing test: `tests/conflict-artifacts.test.ts` — conflict blocks merge until resolved.

## CLI verify

```bash
foundry plan  # records conflict when swarm disagrees
```

---

## V4-8: Browser reference capture adapter (v1 boundary)

## What to build

Adapter captures browser references into summarized requirements for Plan Mode. Doctor browser-capture check gates availability.

## Acceptance criteria

- [ ] Capture produces requirements snippet artifact
- [ ] Doctor browser-capture check integrated
- [ ] No raw page dumps in git artifacts
- [ ] Graceful degrade when browser unavailable

## Blocked by

- #18

## TDD proof

Failing test: `tests/browser-capture.test.ts` — mock capture summarizes URL.

## CLI verify

```bash
foundry doctor --deep  # browser-capture check
foundry plan --reference https://example.com
```

---

## V4-9: CuaDriver adapter boundary (optional capability)

## What to build

Optional CuaDriver adapter for macOS GUI automation. Warn-only in default doctor; required only with --deep or explicit flag.

## Acceptance criteria

- [ ] cuadriver check in doctor matrix
- [ ] Adapter isolated; plan/build opt-in
- [ ] Warn when missing unless --deep
- [ ] No hard dependency on cuadriver for core flows

## Blocked by

- #18

## TDD proof

Failing test: `tests/cuadriver-adapter.test.ts` — missing driver warns not fails by default.

## CLI verify

```bash
foundry doctor --deep  # cuadriver optional
```

---

## V4-10: Pi runtime adapter (beyond pi-cli check)

## What to build

Invoke Pi runtime for setup/plan smoke beyond pi-cli presence check. Mock path for CI; live path for doctor --deep.

## Acceptance criteria

- [ ] Pi adapter with mock invoke for tests
- [ ] setup uses Pi path when available
- [ ] Doctor pi-runtime check beyond pi-cli
- [ ] Clear error when Pi unavailable

## Blocked by

- #18

## TDD proof

Failing test: `tests/pi-runtime-adapter.test.ts` — mock invoke returns success.

## CLI verify

```bash
foundry setup
foundry doctor --for all --deep
```

---

## V5-1: TUI consuming run.json + status.md (no schema rework)

## What to build

Terminal UI reads run.json and status.md for live run monitoring. No duplicate schema — render from validated run state.

## Acceptance criteria

- [ ] foundry tui attaches to active run
- [ ] Renders phase, budget, approval state
- [ ] TUI render tests from fixture run.json
- [ ] Clean exit on detach

## Blocked by

- #12

## TDD proof

Failing test: `tests/tui-render.test.ts` — fixture run.json renders expected panels.

## CLI verify

```bash
foundry tui  # attaches to latest run
```

---

## V5-2: Background daemon + attach/detach

## What to build

Daemon process holds Run alive across terminal detach. foundry daemon start/stop; TUI re-attaches.

## Acceptance criteria

- [ ] Daemon lifecycle start/stop/status
- [ ] Run continues after terminal close
- [ ] PID file in .foundry with cleanup
- [ ] Tests use mock daemon lifecycle

## Blocked by

- #41

## TDD proof

Failing test: `tests/daemon-lifecycle.test.ts` — start/stop roundtrip.

## CLI verify

```bash
foundry daemon start && foundry tui
foundry daemon stop
```

---

## V5-3: Local macOS notifications (approval, rate limit)

## What to build

Opt-in macOS notifications for awaiting_approval and rate-limit pause events.

## Acceptance criteria

- [ ] Setup enables/disables notifications
- [ ] Approval waiting triggers notification
- [ ] Rate-limit pause triggers notification
- [ ] No notification when disabled

## Blocked by

- #17

## TDD proof

Failing test: `tests/notifications-macos.test.ts` — mock notifier called on events.

## CLI verify

```bash
foundry setup  # enable notifications
foundry plan  # triggers on awaiting_approval
```

---

## V5-4: Slack/Telegram/webhook notification adapters

## What to build

Webhook adapters for Slack, Telegram, and generic HTTP webhooks. Dry-run mode validates config without sending.

## Acceptance criteria

- [ ] Adapter contract tests per channel
- [ ] Config in ~/.foundry/notifications.toml
- [ ] Dry-run validates payload shape
- [ ] Secrets not logged

## Blocked by

- #43

## TDD proof

Failing test: `tests/notifications-webhook.test.ts` — dry-run payload matches schema.

## CLI verify

```bash
foundry notify --dry-run --event approval_waiting
```

---

## V5-5: Marathon multi-day run policy + anti-loop strictness

## What to build

Marathon budget: multi-day checkpoint intervals, stricter loop detection, scheduled pause for human review.

## Acceptance criteria

- [ ] Marathon checkpoint interval configurable
- [ ] Stricter loop thresholds than deep
- [ ] Scheduled review pauses recorded
- [ ] run.json marathon metadata

## Blocked by

- #35

## TDD proof

Failing test: `tests/marathon-policy.test.ts` — marathon triggers review pause at interval.

## CLI verify

```bash
foundry plan --budget marathon
```

---

## V5-6: Agent-guided setup (AI loop over doctor, not deterministic only)

## What to build

Enhance setup with bounded agent loop over doctor results — AI suggests fixes, doctor re-verifies. Deterministic path remains default.

## Acceptance criteria

- [ ] Agent setup bounded turn count
- [ ] Re-runs doctor after each suggestion
- [ ] Expert mode skips agent loop
- [ ] No unsafe auto-fixes

## Blocked by

- #40

## TDD proof

Failing test: `tests/setup-agent.test.ts` — mock agent loop bounded; doctor re-run.

## CLI verify

```bash
foundry setup  # agent-guided path
```

---

## V5-7: GitHub private repo creation (approval-gated)

## What to build

Optional build flag to create GitHub private repo — blocked without explicit approval per autonomy contract.

## Acceptance criteria

- [ ] foundry build --create-repo prompts approval
- [ ] Safe profile always blocks
- [ ] Creates repo only after approve
- [ ] No secrets in logs

## Blocked by

- #26

## TDD proof

Failing test: `tests/create-repo-gate.test.ts` — blocked without approval.

## CLI verify

```bash
foundry build --create-repo  # asks before gh repo create
```

---

## V5-8: npm primary distribution + self-update

## What to build

Publish foundry to npm as primary install path. Self-update command checks registry version.

## Acceptance criteria

- [ ] npm pack/publish documented
- [ ] CI container installs via npm i -g
- [ ] foundry update checks npm registry
- [ ] install.sh delegates to npm when available

## Blocked by

- #20

## TDD proof

Failing test: `tests/npm-distribution.test.ts` — pack contents include bin.

## CLI verify

```bash
npm i -g . && foundry --version
foundry update --dry-run
```

---

## V5-9: Powerpack guide integration (agent-feedable setup path)

## What to build

Wire powerpack guide into setup/doctor recommendations as agent-feedable documentation path (guide only, not heavy package dep).

## Acceptance criteria

- [ ] setup references powerpack guide URL/path
- [ ] doctor recommends guide when Pi extension missing
- [ ] Docs link from README
- [ ] No new required npm dep on powerpack

## Blocked by

- #46

## TDD proof

Failing test: `tests/powerpack-guide.test.ts` — doctor message includes guide link.

## CLI verify

```bash
foundry setup  # mentions powerpack guide
foundry doctor
```

---

## V5-10: Production hardening: CONTEXT.md, full doctor lock, V5 verification suite

## What to build

Final V5 hardening: CONTEXT.md glossary current, doctor matrix locked per OPEN_QUESTIONS, full verification suite documented and green.

## Acceptance criteria

- [ ] CONTEXT.md matches product language
- [ ] All scripts green: demo, demo-build, rehearsal
- [ ] Verification matrix in docs/planning/
- [ ] No P0 doctor gaps vs OPEN_QUESTIONS

## Blocked by

- #41
- #42
- #43
- #44
- #45
- #46
- #47
- #48
- #49

## TDD proof

Failing test: `tests/v5-verification-matrix.test.ts` — documents required commands.

## CLI verify

```bash
npm test && bash scripts/demo.sh && bash scripts/demo-build.sh
```
