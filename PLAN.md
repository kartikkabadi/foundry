# Plan: Foundry production-ready HITL factory

Depth: tree 7   Mode: orchestrated
Budget note: a competent single pass is a thin dashboard plus research; this run is the full operator surface through spec and stored later-walk artifacts, verified live.

## Decisions (operator, 2026-08-17) — fold in immediately

### D1 Substrate: all five products are eligible

Foundry may **build around or fork Warren, Plane, Roomote, NAC, and Openship**, not Plane-only. Combine whatever actually serves the HITL factory (issue list density, project chrome, HITL queues, command menu, remote-agent status, shipping ops).

Locked and not deleted by any fork:

- Issue tracker = Foundry SQLite + JSONL on disk
- GitHub on the target only receives the PR
- Walk: Intake → Research → Grill → Spec → Improve → Plan pack → Council → Architecture → Execute → Evidence → Merge → Hygiene
- Gates: grill, plan, phase, evidence
- Size forced-L skips nothing for first self-job
- Workers via eve (GLM zai/glm-5.2 Blackbox pin); no raw Gateway
- Dashboard is the human place; CONTEXT.md is law on the target

If a fork pattern conflicts with a lock, keep the factory model and steal only the UX pattern.

### D2 Theme lock: Foundry colors stay

**Do not** adopt Plane’s (or anyone else’s) color tokens, brand palette, or light-default look.

**Do** steal layout, density, navigation, information architecture, and interaction patterns.

**Keep** Foundry’s current dark theme:

- black background
- CSS variables in `app/globals.css`: `background` / `foreground` / `card` / `primary` / `muted` / `border` (and the rest already defined)
- Geist / Geist Mono
- current `--radius: 0.625rem`
- `html` class `dark`, body `bg-black text-neutral-100`

New UI must look like Foundry, not like a reskin of Plane.

## Contract

Decided BEFORE fan-out. Everything a leaf could get wrong about its neighbors:

### Interfaces

- `Issue`, `IssueStage`, `DecisionTicket`, `IssueJob`, `IssueArtifact` live in `lib/foundry/types.ts`. Job status union: `running | failed | stale`.
- Artifacts keyed by `(issue_id, kind)`. Kinds: `research_brief`, `spec_doc`, plus one kind per later stage (`improve_doc`, `plan_pack`, `council_doc`, `architecture_doc`, `execute_log`, `evidence_doc`, `merge_doc`, `hygiene_doc`).
- Decision tickets: `listDecisionTickets(issueId)`, `saveDecisionTickets(...)`, `answerDecisionTicket(id, answer)`. Grill advances only when the current round’s frontier is empty (every ticket has `answer`).
- Workers: `startResearch` / `startGrill` / `startSpec` / `startWalkStage` — fire-and-forget from server components/actions; persist via store; `Client` from `eve/client` only.
- Stale jobs: if `running` and `startedAt` older than 8 minutes, treat as `stale` and show retry (worker died).
- UI slots: `app/issues/[id]/page.tsx` composes `StageHero`, `WalkStrip`, and one stage panel. Panels must not import each other’s internals.

### Data ownership (no two leaves share a write file)

| Leaf | Owns (write) |
|---|---|
| 1.1.1 Plane study | `docs/inspiration/plane.md` |
| 1.1.2 Warren study | `docs/inspiration/warren.md` |
| 1.1.3 Roomote study | `docs/inspiration/roomote.md` |
| 1.1.4 NAC study | `docs/inspiration/nac.md` |
| 1.1.5 Openship study | `docs/inspiration/openship.md` |
| 1.1.6 Synthesis | `docs/inspiration/synthesis.md` (append-only Decision notes in PLAN status log) |
| 1.2.1.1 Types | `lib/foundry/types.ts` |
| 1.2.1.2 Store | `lib/foundry/store.ts`, `scripts/check-walk.ts`, `scripts/check-research-store.ts`, `scripts/check-stale-job.ts` |
| 1.2.2.1 Research worker | `lib/foundry/research.ts`, `lib/foundry/eve-host.ts` |
| 1.2.2.2 Grill worker | `lib/foundry/grill.ts` |
| 1.2.2.3 Spec + later workers | `lib/foundry/spec.ts`, `lib/foundry/walk.ts` |
| 1.3.1 Chrome | `app/layout.tsx`, `app/globals.css` (tokens unchanged), `app/_components/app-shell.tsx`, `app/_components/sidebar.tsx`, `app/_components/command-menu.tsx` |
| 1.3.2 Home | `app/page.tsx`, `app/_components/intake-form.tsx`, `lib/foundry/copy.ts` |
| 1.3.3 Issue frame | `app/issues/[id]/page.tsx`, `app/issues/[id]/stage-hero.tsx`, `app/issues/[id]/walk-strip.tsx`, `app/issues/[id]/refresh-while.tsx` |
| 1.4.1 Research UI | `app/issues/[id]/research-panel.tsx`, `app/issues/[id]/retry-research.tsx` |
| 1.4.2.1 Grill tickets UI | `app/issues/[id]/grill-panel.tsx` |
| 1.4.2.2 Grill actions | `app/actions.ts` (shared actions file — 1.4.2.2 owns it after 1.3.2 intake actions land; later leaves only append named exports via the integration node if needed). Prefer `app/actions.ts` as the single server-actions module: **1.3.2 writes intake**; **1.4.2.2 appends grill**; **1.2.2.1 does not touch it**. Integration node 1.4 merges. |
| 1.4.3.1 Spec UI | `app/issues/[id]/spec-panel.tsx` |
| 1.4.3.2.1 Mid-walk UI | `app/issues/[id]/mid-walk-panel.tsx` (improve, plan_pack, council, architecture) |
| 1.4.3.2.2.1 Late-walk UI | `app/issues/[id]/late-walk-panel.tsx` (execute, evidence, merge, hygiene) |
| 1.5.1 Scripts | `scripts/check-theme.ts` |
| 1.5.2 Live E2E | `docs/verification/live-e2e.md` |

`app/actions.ts` is the one contested file: 1.3.2 creates it with intake; 1.4.2.2 and walk UIs add exports. Driver merges those sequentially (not in parallel).

### Naming and conventions

- CONTEXT.md language: Issue, Decision ticket, Gate, Walk, Size. Never “ticket” except Decision ticket.
- Exhaustive `switch` with `never` default.
- Imports at top of file. No inline imports.
- Read `node_modules/eve/docs/` and `node_modules/next/dist/docs/` before Next/eve APIs.
- Do not commit. Do not force-push. Do not print API keys. Do not read foundry-old.

## Tree

- 1 Foundry production-ready HITL factory .......... `GATES.md`
  - 1.1 Product intelligence .......... `gates/node-1.1.md`
    - 1.1.1 Plane study .......... `gates/leaf-1.1.1-plane.md`
    - 1.1.2 Warren study .......... `gates/leaf-1.1.2-warren.md`
    - 1.1.3 Roomote study .......... `gates/leaf-1.1.3-roomote.md`
    - 1.1.4 NAC study .......... `gates/leaf-1.1.4-nac.md`
    - 1.1.5 Openship study .......... `gates/leaf-1.1.5-openship.md`
    - 1.1.6 Synthesis (all five eligible) .......... `gates/leaf-1.1.6-synthesis.md`
  - 1.2 Kernel .......... `gates/node-1.2.md`
    - 1.2.1 Persistence .......... `gates/node-1.2.1.md`
      - 1.2.1.1 Domain types .......... `gates/leaf-1.2.1.1-types.md`
      - 1.2.1.2 Store + jobs + tickets .......... `gates/leaf-1.2.1.2-store.md`
    - 1.2.2 Eve workers .......... `gates/node-1.2.2.md`
      - 1.2.2.1 Research hardening .......... `gates/leaf-1.2.2.1-research.md`
      - 1.2.2.2 Grill worker .......... `gates/leaf-1.2.2.2-grill.md`
      - 1.2.2.3 Spec + later workers .......... `gates/leaf-1.2.2.3-walk-workers.md`
  - 1.3 Operator shell (Foundry theme) .......... `gates/node-1.3.md`
    - 1.3.1 Chrome, density, command menu .......... `gates/leaf-1.3.1-chrome.md`
    - 1.3.2 Home + intake .......... `gates/leaf-1.3.2-home.md`
    - 1.3.3 Issue frame (hero + strip) .......... `gates/leaf-1.3.3-issue-frame.md`
  - 1.4 Factory walk product .......... `gates/node-1.4.md`
    - 1.4.1 Research panel .......... `gates/leaf-1.4.1-research-ui.md`
    - 1.4.2 Grill HITL .......... `gates/node-1.4.2.md`
      - 1.4.2.1 Tickets surface .......... `gates/leaf-1.4.2.1-grill-ui.md`
      - 1.4.2.2 Rounds until frontier empty .......... `gates/leaf-1.4.2.2-grill-rounds.md`
    - 1.4.3 Spec and later .......... `gates/node-1.4.3.md`
      - 1.4.3.1 Spec document .......... `gates/leaf-1.4.3.1-spec-ui.md`
      - 1.4.3.2 Later walk .......... `gates/node-1.4.3.2.md`
        - 1.4.3.2.1 Improve → architecture .......... `gates/leaf-1.4.3.2.1-mid-walk.md`
        - 1.4.3.2.2 Execute → hygiene .......... `gates/node-1.4.3.2.2.md`
          - 1.4.3.2.2.1 Late-walk panels + workers wired .......... `gates/leaf-1.4.3.2.2.1-late-walk.md`
  - 1.5 Proof .......... `gates/node-1.5.md`
    - 1.5.1 Typecheck + theme + store scripts .......... `gates/leaf-1.5.1-scripts.md`
    - 1.5.2 Live E2E on :3100 .......... `gates/leaf-1.5.2-e2e.md`

Longest path (depth 7): 1 → 1.4 → 1.4.3 → 1.4.3.2 → 1.4.3.2.2 → 1.4.3.2.2.1 (leaf). Other branches stop earlier when a further split would make a leaf smaller than a real unit of work.

## Status log

Append-only. One line per event: leaf started, leaf verified, gate abandoned.
Never rewrite lines above; appending keeps the file cheap to re-read and diff.

- 2026-08-17 plan written, contract fixed
- 2026-08-17 operator correction folded: D1 all-five substrate, D2 theme lock (Foundry colors). Do not restart research; fold in.
- 2026-08-17 gates/ tree written; fan-out 1.1.1–1.1.5 started in parallel
- 2026-08-17 operator addendum D3: implement real features/functionality from all five, not chrome-only. Inventory below. Theme lock still stands.
- 2026-08-17 leaves 1.1.1–1.1.5 notes on disk; 1.1.6 synthesis written
- 2026-08-17 kernel+shell+walk implemented; live E2E PASS on :3100 issue 688132bb… research brief 4728 chars, 5 grill tickets, 1 answered

## D3 Feature inventory (operator addendum 2026-08-17)

Steal **capabilities**, not palettes. All five eligible. Theme lock (D2) still stands.

### Plane (makeplane/plane) — tracker depth
Inventory: work items, projects, cycles, modules, saved views, pages, analytics, Intake accept/decline/snooze, PowerK command palette, list/kanban/calendar/spreadsheet/gantt layouts, peek + properties rail, activity.
**Map:** Projects, Cycles, Modules, command palette, list+spreadsheet, properties rail, Gates inbox (Intake analog). Walk stages remain Foundry’s workflow (not Plane states). Skip: Gantt/calendar as primary, Pages/Stickies, Plane colors.

### Warren (jayminwest/warren) — HITL factory ops
Inventory: live-unit list, dispatch CTA, steer inbox above log, re-run from scratch vs continue, serial child table, explicit advance, status registry, pulse while in-flight, capability-aware empty states.
**Map:** Home as live Issue list, Grill tickets above the document, retry vs continue, WalkStrip as serial children, no auto-advance past gates, pulse only while `job.status === running`.

### Roomote (RooCodeInc/Roomote) — remote/agent ops
Inventory: session chrome (boot/work/boot-fail/done/needs-input), heartbeat, stale, typed failures, retry same id, ping only while working.
**Map:** split walk vs job, stale after 8 minutes, phase verbs, grill is waiting-on-you not running, retry on same Issue id.

### NAC (arcee-ai/nac) — agent session + attention
Inventory: list|detail split, attention dots, clocks, workset cards, SSE/poll, sandbox isolation, health check.
**Map:** attention on Gates/Workers, Decision tickets as workset cards, poll while job running, no store-path leaks in health.

### Openship (oblien/openship) — shipping/ops workflows
Inventory: sectioned rail, counts as metadata, attention column, facets, event log surface, named gates, attach-to-running-job.
**Map:** sectioned sidebar, nav counts, home attention column, stage facets, Event log on the Issue, named Gates page.

### Implement now (gated)
Projects, Cycles, Modules, command palette, Gates inbox, Workers board, Event log, Grill HITL, Spec+ walk artifacts, stale jobs, list/spreadsheet, properties rail.
