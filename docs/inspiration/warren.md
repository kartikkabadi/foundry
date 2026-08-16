# Warren — inspiration for Foundry (control-plane density, not palette)

Source: clone `/tmp/foundry-inspiration/warren` (upstream [jayminwest/warren](https://github.com/jayminwest/warren)). This note is layout, information architecture, HITL, and interaction density only. **Do not adopt Warren colors.** Foundry stays dark: black surfaces, existing CSS variables, Geist. Do not implement Foundry product UI from this file. Keep the Foundry factory: SQLite tracker, walk, gates, eve workers.

Warren’s pitch is “the Coolify of coding agents”: a self-hostable control plane that points at a GitHub repo, runs harness-agnostic agents in sandboxes, streams work live, lets a human steer mid-run, and returns a branch. Foundry is a factory that walks an issue through gated stages. Steal how Warren *shows* work and *asks* humans — not how it paints greens on cool-neutral 264.

---

## Product shape (README)

Warren is one container, one volume, one HTTP API, one SPA. The supervisor is the ENTRYPOINT; it starts the sandbox runtime, then warren. Domain data lives in SQLite (`/data/warren.db`: projects, runs, events, plan-runs, inbox). The UI, the `warren` CLI, and HTTP clients all drive the same composition path: resolve agent → provision sandbox → dispatch → stream NDJSON events → reap (push branch, optional PR).

What the README actually sells, in operator language:

- **Dispatch.** Projects → Add (GitHub URL) → Dispatch run (agent + prompt).
- **Watch live.** Events persist as NDJSON; `GET /runs/:id/events?follow=1` is the same stream for UI, CLI, and HTTP.
- **Steer mid-run.** `POST /runs/:id/steer` lands in the agent inbox; the next turn consumes it. `POST /runs/:id/cancel` aborts.
- **Serial plans.** `.seeds/` unlocks `POST /plan-runs`: walk children one at a time, **gate each child on the previous PR merging**. Re-dispatch resumes from the next open child.
- **Operator observability.** Cost/tokens on the run row, instance-wide cost analytics, `warren doctor`, health/ready/version probes.

Foundry already has the factory analogue of “one SQLite, one walk, workers elsewhere.” Warren’s lesson is the **operator chrome around that loop**: a home list of live units, a detail page that is 70% stream + 30% human controls, and a second list for *serial gated work* that is not the same as a single run.

---

## App structure

The UI is a React + Vite + shadcn SPA under `src/ui/`. It is **not** Next.js. Routing is `HashRouter` because the same Bun.serve process registers JSON handlers at `/runs/:id`. A browser-history URL would be stolen by the API on hard reload. Hash routes (`/#/runs/abc`) always hit `/` and get `index.html`. Foundry is Next and can keep path routing; steal the *IA*, not HashRouter.

Chrome lives in `src/ui/src/components/layout.tsx`:

- Full-viewport shell: `h-dvh`, sidebar + main, **error boundary inside the chrome** so a page throw does not kill nav.
- **Desktop:** 224px (`w-56`) left sidebar, muted/40 background, `p-4`, 1-gap nav stack.
- **Mobile:** sticky top header + Radix dialog as a left drawer (`w-72`, overlay blur). Drawer closes on pathname change. Touch targets are `min-h-11`.
- Brand row: logo + name + **monospaced version** from auth-exempt `GET /version` (staleTime Infinity).
- Nav items are a typed table with optional **capability**. Spectator vs operator is not a CSS trick; it is `useCapabilities()` against `/whoami`.
- Primary CTA is **not** in the lead-eight: “Dispatch run” sits below the list, visually heavier, gated `OperatorOnly`. Analytics sit at the **bottom** of the sidebar — daily-driver vs operator-telemetry is encoded in position.
- Session slot: operators see Log out; spectators see Log in. A public instance never strands the operator.

Data layer: TanStack Query, `retry: false`, `staleTime: 5_000`. One global **lifecycle stream** (`useLifecycleStreamInvalidation`) invalidates list keys with a 750ms debounce. Pages keep a **45s fallback poll** for public mode (stream 403s) and dropped notifications. Detail pages poll faster while non-terminal (run 3s, plan-run 5s) and **stop** when terminal.

Foundry mapping: keep eve workers and SQLite as the source of truth. If the issue page polls, prefer Warren’s pattern of **one stream + slow poll fallback**, not five independent 5s timers.

---

## Dashboard routes (IA)

`src/ui/src/app.tsx` is the route table. Home is **Runs**, not Projects. Mutation-only pages are route-guarded so a spectator deep-link never sees a form that 403s.

| Hash route | Page | Role |
|---|---|---|
| `/login` | LoginPage | Bearer paste; then `/runs` |
| `/` | redirect | → `/runs` |
| `/runs` | RunsPage | Home list: filters, sort, pagination, cost column |
| `/runs/new` | NewRunPage | OperatorRoute (`dispatch`): agent, project, prompt, clone/continue |
| `/runs/:id` | RunDetailPage | Live unit: badges, meta grid, prompt, **steer above log**, event tail |
| `/plan-runs` | PlanRunsPage | Tabs: Plan runs \| Ready (operator) |
| `/plan-runs/new` | NewPlanRunPage | OperatorRoute serial dispatch |
| `/plan-runs/:id` | PlanRunDetailPage | Parent + **child table** (seq, gate state, linked run, PR) |
| `/agents` | AgentsPage | Registry of harness envelopes |
| `/projects`, `/projects/:id` | Projects | Repo identity; project-detail “Run now” |
| `/cost-analytics` | lazy | Operator-only USD rollup |
| `/run-analytics` | lazy | Execution telemetry; heavy recharts split out |
| `*` | redirect | → `/runs` |

**Runs list density.** `PageHeader` (title + one-line description + right actions). Filter pills (All / per-agent / per-project). Sortable table heads with a cycle: inactive → desc → asc → reset default. Page size persisted in localStorage (25/50/100/200); **offset is not persisted** (stale offset past EOF). Cost column on by default, hide toggle persisted. All-time totals come from the server envelope, not a sum of the visible page — spectators omit instance-wide USD so a coalesced `$0.00` never lies. Empty copy is capability-aware: `useOperatorHint("Dispatch one above.")` returns `undefined` for spectators so the empty state does not point at a missing button.

**Run detail layout (the money page).** Header: monospaced id, `StateBadge`, failure prose (raw reason in tooltip), empty-push vs commits-ahead badges, PR lifecycle badge + outbound PR link. Operator cluster: while running → Cancel; when terminal → **Re-run from scratch** vs **Continue with follow-up** (two clone kinds via `location.state`). Then a **3-column meta card grid** (cost, timestamps, trigger, provider/model, sandbox ids gated on presence, seed, parent-run link). Prompt in a muted `<pre>`. Then **Steer** (operator, disabled when terminal). Then **EventTail**: fixed ~480px log, seq-sorted, autoscroll that disables on wheel-up (not on programmatic scroll), stream status indicator, kind-aware row rendering.

**Plan-runs IA.** Serial work is a sibling of Runs, not a nested tab on a run. The list has a **Ready** tab: approved plans with ≥1 open child, not already dispatched. Dispatch is a dialog that **mirrors** `/plan-runs/new` and POSTs the same `plan-runs` API — no second spawn path. Detail is parent meta + prompt template + child table (seq, coordinator state, seed, linked run, PR, failure). Cancel the parent while queued/running.

Foundry mapping: treat the issue as Warren’s run, the **walk** as Warren’s plan-run children, and grill/council/merge as the **human gate** analogue of `waiting_for_merge`. Do not invent a Warren “project” as Foundry’s primary object; Foundry’s primary object stays the tracked issue.

---

## HITL patterns (steal these)

Warren is explicit: the web UI is for **daily human work**. HITL is not a chat overlay; it is structured affordances on the live unit.

1. **Steer-above-the-log layout.** Comments in `run-detail.tsx` record the mistake: a 480px event tail used to push the inbox below the fold. Steering is the thing you type **while** the agent runs; put it above the log. Foundry grill/steer should sit before the worker transcript, not after.

2. **Inbox, not overwrite.** `POST /runs/:id/steer` enqueues `{ body, priority }`. Delivery is a later event (`steer.sent` vs `steer.delivered`). The UI says “Steering message delivered,” not “agent obeyed.” Foundry should distinguish **human message accepted** from **stage advanced**.

3. **Peek vs claim.** `GET /runs/:id/inbox` is destructive on read (claims unread). `?peek=1` is the only safe operator inspect. Pattern: never let a dashboard poll steal the worker’s inbox.

4. **Terminal disables HITL.** Steer textarea placeholder: “Run is terminal; steering is disabled.” Cancel is gone; clone/continue appear. Foundry: when a gate is closed or a stage is done, hide steer; offer retry/advance.

5. **Two re-run verbs.** Replicate (`cloneFromRunId`) re-dispatches the same config on the project default base. Continue (`continueFromRunId`) uses the parent’s pushed branch. Foundry: “retry research from scratch” vs “continue after grill answers” must not share one button.

6. **Serial gate on an external merge.** Plan-run coordinator (`docs/design/plan-run-coordinator.md`): at most one in-flight child; next spawn only when previous is `merged` or `skipped`. Advance results are a discriminated union (`waiting_for_run`, `waiting_for_merge`, `plan_failed`, …). The UI renders child states `pending|dispatched|running|pr_open|merged|failed|skipped`. Foundry already has walk + gates; steal the **one in-flight slot + waiting-for-human/merge badge**, not GitHub PRs as the only gate.

7. **Ready-to-dispatch is read-on-demand, never auto.** Approach A (background auto-dispatch) was **explicitly deferred** because it would spend money with no human in the loop. Approach B computes readiness only when the operator opens the tab. Dispatch remains an explicit POST. Foundry: a “ready for grill / ready for council” strip should list candidates; **eve workers must not skip the human gate**.

8. **Operator-only mutations, spectator-safe reads.** `OperatorOnly` / `OperatorRoute` / `useOperatorHint` share one capability table with `ROUTE_TABLE`. Public visitors see no dispatch/steer/cancel. Empty-state copy does not mention missing controls. Foundry can stay single-operator, but still **hide dead actions** instead of disabling-and-erroring.

9. **Humanize wire, keep raw in tooltip.** `labels.ts` maps `pr_closed_without_merge` → “PR closed without merge”; unknown values go through `humanizeWireValue`. Failure badges show prose; `title=` holds the enum. Foundry stage/job statuses should do the same.

10. **Event kinds refresh the row.** `state_change`, `cancel.requested`, `reap.completed`, preview events invalidate `["runs"]` (list + detail). Foundry issue pages should invalidate the tracker row when walk/job JSONL events arrive, not wait for the next full poll.

11. **Cancel is a forwarded fact.** Success copy: “Cancel forwarded (sandbox: …)” or “already terminal.” The human action is acknowledged even if the worker was already dead.

12. **Plan dispatch dialog as the approval gate.** Comment in `dispatch-plan-dialog.tsx`: plan-run dispatch stays operator-gated in v1; the popup is the **manual hand-off**. Foundry council/architecture gates should be a small confirm surface that posts the existing advance action — not a new pipeline.

---

## Design (steal density, not hue)

Warren tokens (`src/ui/src/tokens.css`): Inter + JetBrains Mono, cool-neutral 264, **muted green primary (oklch ~58% 0.1 152)**, semantic success/warning/info/danger. Radius sm–2xl. Tabular numerals on tables/code. Theme via `data-theme`, not `prefers-color-scheme` alone.

**Do not copy that palette into Foundry.** Map the *roles* onto Foundry’s black + existing variables:

- Sidebar = slightly lifted muted panel, not a second brand color.
- Active nav = accent fill + foreground, using Foundry tokens.
- Dispatch/primary CTA = existing primary, not Warren green.
- Status = one registry (`StatusIndicator`): label, variant, icon, **pulse only for in-flight**. Foundry walk stages should use one badge component, not ad-hoc colors per page.
- IDs, costs, seq, git refs = `font-mono text-xs` + tabular nums.
- Page rhythm = `space-y-6`, meta `grid gap-4 md:grid-cols-3`, cards with `p-4` and uppercase 10px labels.
- `PageHeader`: 2xl tracking-tight list titles; **mono xl** for id-keyed detail.
- Filter pills: rounded-full, `aria-pressed`, wrap strip — restyle with Foundry borders, not Warren primary fill.
- EmptyState: centered title + optional description + action slot; compact variant inside tables.
- Motion: `motion-safe:animate-pulse` on running; stream items fade in. Respect reduced motion.
- Responsive: `min-h-11` hit areas; footer actions stretch on small screens (`responsiveFooterButton`).

Warren also ships a public read-only instance (`app.warren.run`): real projects, live streams, no login. That is a **spectator projection** of the same pages (sandbox ids and operator analytics stripped). Foundry does not need public mode; steal the idea that **mutating chrome is absent, not greyed**.

---

## What not to steal (keep the factory)

- **Do not** replace Foundry’s SQLite issue tracker with Warren’s projects/runs schema.
- **Do not** replace walk/gates/eve workers with burrow/bwrap/k8s pods.
- **Do not** adopt HashRouter, Inter/JetBrains, or os-eco green.
- **Do not** treat GitHub PR merge as Foundry’s only gate; Foundry gates are stage approvals (grill, council, merge).
- **Do not** auto-advance past human gates because Warren’s coordinator can wait on merge — that wait *is* the HITL.

Warren’s PlanRun is “warren orchestrating itself”: no new sandbox, no new agent contract. Foundry should stay “eve workers + tracker orchestrating itself”: one in-flight stage, UI that makes the wait visible.

---

## Steal-list (Foundry-usable)

Priority order for a later UI pass (this leaf does not implement it):

1. **layout — factory home = live-unit list.** Default route is the work queue (issues/jobs), not settings. Sidebar: daily (queue, walk/plan, intake) then telemetry. Primary “start work” CTA below nav, visually distinct.
2. **layout — 224px chrome + inner error boundary.** Page crash keeps nav. Mobile drawer, not a collapsed icon rail as the only mobile story.
3. **layout — run/issue detail stack.** Header (mono id + status registry + human actions) → 3-col meta cards → frozen prompt/intake → **HITL form above event tail** → fixed-height autoscroll log.
4. **pattern — PageHeader + FilterPill + EmptyState + SortableTableHead.** One header primitive; pills for agent/project/stage; empty copy that does not mention hidden operator actions; sort cycle that resets to default.
5. **pattern — capability-shaped chrome.** Hide dispatch/steer/cancel when the viewer cannot act. Route-guard mutation pages. Spectator-safe empty hints.
6. **HITL — steer inbox above the log.** Textarea + Send; disable when terminal; success = delivered, not “stage done.” Never poll-claim the worker inbox from the dashboard.
7. **HITL — two clone verbs.** Retry from scratch vs continue from last artifact/branch. Prefill the create form via navigation state; do not invent a second API.
8. **HITL — serial child table as the walk.** Seq, state badge, linked job, waiting-for-human/merge, failure prose + raw tooltip. One in-flight child; next gated.
9. **HITL — ready strip is read-on-demand.** “Approved and unblocked” list with an explicit dispatch/advance dialog that posts the existing action. No background auto-dispatch past gates.
10. **pattern — one status registry.** queued/running/succeeded/failed/cancelled (+ walk-child pending/dispatched/pr_open/merged/skipped analogues). Pulse only while active. Humanize wire; raw in `title`.
11. **pattern — stream + slow poll.** One lifecycle subscription invalidates lists; 45s fallback; detail poll stops at terminal; event kinds invalidate the row.
12. **pattern — server totals, not page sums.** Cost/count tiles from the list envelope. Presence-gate jargon cards (sandbox ids, operator-only fields).
13. **layout — analytics lazy and last.** Heavy charts code-split; nav entries at the bottom; operator-only spend views.
14. **human — public/operator copy split.** Empty states and failure labels written for visitors; tooltips for operators. Cancel acknowledgement copy.
15. **pattern — same pipeline, three clients.** UI, CLI, HTTP share composition. Foundry: issue page, future CLI, and eve workers already share SQLite — keep it that way; do not add a UI-only spawn path.

---

## File map (for later readers)

- README: product, deploy, CLI, HTTP, layout of `src/`
- Routes: `src/ui/src/app.tsx`
- Shell: `src/ui/src/components/layout.tsx`
- HITL: `src/ui/src/pages/run-detail.tsx` (SteerForm), `docs/design/k8s-migration.md` (inbox vs burrow)
- Serial gates: `docs/design/plan-run-coordinator.md`, `src/ui/src/pages/plan-run-detail.tsx`, `ready-plans.tsx`, `dispatch-plan-dialog.tsx`
- Density primitives: `page-header.tsx`, `filter-pill.tsx`, `empty-state.tsx`, `status-indicator.tsx`
- Tokens (do not copy hues): `src/ui/src/tokens.css`
