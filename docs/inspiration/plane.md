# Plane study (leaf 1.1.1)

Clone: `/tmp/foundry-inspiration/plane` (makeplane/plane). License: **AGPL-3.0**. Stack: React Router 7 web app (`apps/web`), Django API (`apps/api`), shared packages (`packages/ui`, `packages/propel`, `packages/editor`, `packages/constants`, `packages/types`).

Plane is an open-source Linear-class project manager: work items, cycles (~sprints), modules (feature buckets), saved views, pages, analytics, and **Intake** (inbox with accept / decline / snooze / duplicate). Foundry is **not** a Plane clone. Foundry is a HITL software factory: SQLite Issue tracker, walk **Intake → Research → Grill → Spec → Improve → Plan pack → Council → Architecture → Execute → Evidence → Merge → Hygiene**, gates, eve/GLM workers.

This note is layout / IA / interaction theft. Foundry may fork or integrate **all five** inspiration products (Warren, Plane, Roomote, NAC, Openship). Plane is the primary **dashboard substrate**. Other products own other surfaces (Warren: research/advisor tone; Roomote: remote session/operator chrome; NAC: agent control; Openship: fulfillment/pipeline ops). Do not collapse Foundry into Plane-only.

---

## Theme lock (do not adopt colors)

**THEME LOCK:** steal layout, density, navigation, IA, and interaction. **Do not adopt Plane colors, brand palette, or light-default look.** Plane’s design system is tokenized around `bg-canvas`, `bg-surface-1`, `border-subtle`, `text-primary`, editor pastels, and a **light-first** `data-theme` with optional dark. Foundry keeps **black background**, `app/globals.css` tokens (`--background: oklch(0 0 0)`, `--radius: 0.625rem`), **Geist / Geist Mono**. Map Plane’s *roles* (canvas / surface / subtle border / header row) onto Foundry tokens; never copy `--extended-color-purple-*`, conical-gradient brand, or Plane logo chrome.

If a future UI leaf copies Plane component *structure*, restyle with Foundry tokens only.

---

## App structure (dashboard substrate)

Monorepo apps: `web` (operator UI), `api`, `admin` (instance “God mode”), `space` (public project spaces), `live`. Foundry does not need Plane’s auth/onboarding/workspace-invite graph. Steal the **authenticated shell**:

1. Full-viewport flex column, overflow hidden.
2. **Resizable left sidebar** (peek on hover when collapsed, width persisted, ~250px default).
3. Optional **extended sidebar** (second column for favorites / extra nav).
4. **Main** = sticky **AppHeader** (`h-11`, border-b) + **ContentWrapper** filling remaining height.
5. Workspace chrome is a rounded inner frame: `flex h-full … overflow-hidden rounded-lg border` around sidebar + main (`apps/web/app/(all)/[workspaceSlug]/(projects)/layout.tsx`).

Routes live in `apps/web/app/routes/core.ts`. Workspace-scoped tree:

| Route pattern | Role |
| --- | --- |
| `/:workspaceSlug` | Home dashboard widgets |
| `/:ws/projects` | Project list |
| `/:ws/projects/:projectId/issues` | Work-item board/list |
| `/:ws/projects/:projectId/issues/:issueId` | Redirects to browse identifier |
| `/:ws/browse/:workItem` | Canonical issue detail (`PROJ-123`) |
| `/:ws/projects/:projectId/cycles` and `…/cycles/:cycleId` | Cycle list + cycle-scoped issue layouts |
| `/:ws/projects/:projectId/modules` and `…/modules/:moduleId` | Module list/detail |
| `/:ws/projects/:projectId/views` | Saved filters |
| `/:ws/projects/:projectId/pages` | Docs |
| `/:ws/projects/:projectId/intake` | Inbox HITL |
| `/:ws/notifications`, `/drafts`, `/stickies`, `/analytics/:tabId`, `/active-cycles` | Workspace utilities |
| `/:ws/projects/:projectId/archives/{issues,cycles,modules}` | Soft-delete / history |

Foundry mapping: one “workspace” is the factory; one “project” is the git repo / product; Issues stay Foundry Issues (walk + artifacts), not Plane’s generic tickets.

---

## Layout (shell density)

**Header pattern.** `AppHeader` is a 44px (`h-11` / `h-header`) `Row`: left cluster (sidebar toggle when collapsed, breadcrumbs / project tabs), right cluster (filters, layout switcher, search, new-item). Composition is `Header` + `Header.LeftItem` from `@plane/ui`, not a custom app bar. Mobile gets a second header slot. Density is tight: `gap-1` / `gap-2`, 14px icons, compact icon buttons. Notifications route drops the project sidebar so the queue goes full width — Foundry should do the same for the Grill queue.

**Issue list layouts** (`ISSUE_LAYOUTS` in `packages/constants/src/issue/layout.ts`): **list, kanban, calendar, spreadsheet, gantt**. Switcher is a segmented control (`LayoutSelection`: `rounded-md bg-layer-3 p-1`, 22×28 icon cells). Foundry should steal the **control**, not five PM views. Factory-useful layouts:

- **List** — default Issue index (stage, job status, idea).
- **Spreadsheet** — operator table: stage, gate, worker, last artifact, blocked reason.
- **Kanban** — optional, columns = **walk stages**, not Plane states. Do not import Plane’s backlog/todo/done state machine as the primary axis.

**Project chrome.** `ProjectLayout` can show **TABBED** navigation (`TabNavigationRoot`): Work items, Cycles, Modules, Views, Pages, Intake — feature-flagged per project (`cycle_view`, `module_view`, `inbox_view`, …). Overflow menu for hidden tabs. Foundry equivalent: tabs = **Issues | Walk | Gates | Workers | Artifacts**, not Plane’s PM feature set.

**Issue detail.** Canonical URL is identifier browse. Body is two columns: scrollable **main** (title, description/editor, activity) + **right properties sidebar** (~300–384px, collapsible, `border-l`). Peek overlay still mounts so list→peek→full-page is one system.

**Peek.** `TPeekModes`: `side-peek` | `modal` | `full-screen`. List stays; detail slides without losing place. Foundry: peek an Issue from the factory list while the walk strip stays visible; full page for Grill / Plan / Evidence gates.

**Cycle/module detail.** Same issue-layout root **plus** a **right analytics sidebar** (~21.5rem) with progress, dates, members. Foundry analog: cycle/module sidebar → **stage / gate / job** sidebar (progress through walk, not burndown).

---

## Issue (work item UX)

Plane work items: rich-text editor, properties (state, priority, assignees, labels, estimate, cycle, module, parent, relations, links, attachments), sub-issues, activity + comments, subscription, archive/restore.

**Create path:** sidebar **Add** + `CommandPaletteStore.toggleCreateIssueModal` (create modal is *not* PowerK itself; PowerK *opens* it). Drafts persist in localStorage (`draftedIssue`) and `/drafts`.

**List row density:** identifier + title + property chips; click opens peek; identifier navigates to browse. Quick actions dropdown on row.

**Do not steal:** Plane state workflow as Foundry’s source of truth. Foundry `currentStage` + `IssueStage.status` (`pending|active|blocked|skipped|done`) *is* the workflow. Plane “state” maps at most to a display label.

**Steal:** peek + full page; properties rail; identifier `FOUND-12` style; activity feed as **artifact / worker log**; relations as **blocked-by gate** / parent Issue.

HITL analog on the issue itself: Plane’s `NameDescriptionUpdateStatus` (saved / saving) → Foundry job spinner + “Waiting on you” at Grill.

---

## Project

Projects are first-class: list at `/:ws/projects`, sidebar **Projects** list with expand-in-place (cycles/modules nested), create-project modal from command palette, per-project settings (members, states, labels, estimates, automations, feature toggles for cycles/modules/intake/pages/views).

**Auth wrapper** (`ProjectAuthWrapper`) gates the outlet. Foundry is single-operator on Tailscale; skip Plane RBAC, keep the **settings-as-features** idea: enable/disable walk stages by Issue size (`skippedStages` already does this in `lib/foundry/types.ts`).

**Sidebar IA** (`AppSidebar`): title “Projects”, quick add, static nav (Home), optional personal items (Your work, Stickies, Drafts), Favorites, then project list. Notifications path **hides** the project sidebar (full-width inbox).

Foundry steal: left nav = **Home (intake + queue)**, **Issues**, **Gates waiting**, **Workers**, **Logs**; project list = repos if multi-repo ever lands. Do not add Stickies/Pages unless another inspiration product (Warren notes, NAC runbooks) needs a docs surface.

---

## Cycle

Cycles are timeboxed sprints: list grouped **Active / Upcoming / Completed** (`CyclesList` + `Disclosure` sticky group headers with counts). Active cycle gets a rich **ActiveCycleRoot** (progress, productivity, stats). Detail page = cycle-filtered issue layouts + analytics sidebar (burndown, dates). Transfer leftover issues at cycle end (`transfer-issues-modal`). Archive cycles separately.

PowerK: `open_project_cycle`, `nav_project_cycles`, contextual `update-work-item-cycle`.

**Foundry mapping (keep the walk):** a Cycle is **not** a replacement for stages. Optional overlay: “this week’s factory batch” = Issues whose walk is in-flight. Active-cycle dashboard widgets → **factory home**: counts by stage, blocked-on-human (Grill/Plan/Evidence), failed jobs. Burndown → **stage throughput**, never sprint story points.

Do not implement Plane cycle CRUD in v1 unless the walk needs a timebox; steal the **grouped list + active hero + side analytics** composition.

---

## Module

Modules are durable product slices (not timeboxes). List layouts: **list / board / gantt** (`ModulesListView`). Peek via `?peekModule=`. Status dropdown, members, links, progress sidebar on detail. Same issue-layout roots as cycles (`module-layout-root`). Archive modules independently.

PowerK: `open_project_module`, `update-work-item-module`, `update-module-status`, `update-module-member`.

**Foundry mapping:** Module ≈ **capability / epic that spans many factory Issues**, or ≈ a **walk phase grouping** only if we need a second axis. Prefer: one Foundry Issue = one change; Module = optional label for “auth”, “dashboard”, etc. Do not add Plane module Gantt. Steal **peek-on-query-param** and **board vs list** for grouping Issues by `size` or `currentStage`.

---

## Command (PowerK + command palette)

Two layers:

1. **`CommandPaletteStore`** (`base-command-palette.store.ts`) — modal *flags*: create project/cycle/module/view/page/issue, delete/bulk-delete, profile settings, stickies, project-list expand. This is a **modal bus**, not the search UI.

2. **PowerK** (`core/components/power-k/`) — the actual command palette. `cmdk` + Headless UI dialog. `Cmd+K` toggles. Groups: contextual, navigation, create, general, settings, help, account, miscellaneous, preferences. Commands are `{ id, shortcut | keySequence | modifierShortcut, isVisible, isEnabled, type: action | change-page }`. **Change-page** drills into entity pickers (open project, set state, set cycle, …). Search results keys: workspace, project, issue, cycle, module, issue_view, page.

Context from URL (`detectContextFromURL`): `work-item` | `page` | `cycle` | `module`. When on an issue, contextual commands mutate that issue without leaving the palette.

Shortcuts: single key (`c` create), sequences (`gm` go module), modifiers (`cmd+k`). Footer shows hints; separate shortcuts cheatsheet modal.

**Foundry steal:** one PowerK-shaped palette bound to the factory:

- Nav: Issues, current Issue, Gates waiting, Workers, Logs.
- Create: new Issue (intake form).
- Contextual on Issue: **advance stage**, **retry job**, **open Grill**, skip-with-reason (already exists as `AdvanceStage`).
- Do **not** expose Plane create-cycle/module/page.

Keep keyboard as the operator’s primary path so HITL never blocks on hunting buttons (`principle-never-block-on-the-human` analog: the human *is* the gate, but reaching the gate must be instant).

---

## HITL-ish patterns (Intake inbox)

Plane **Intake** (`/projects/:id/intake`, components under `core/components/inbox/`) is the closest HITL analog:

- Split view: **list 2/6 + detail 4/6** (`InboxIssueRoot`).
- Tabs: Open vs Closed (`EInboxIssueCurrentTab`).
- Status enum: `PENDING | DECLINED | SNOOZED | ACCEPTED | DUPLICATE`.
- Header actions: Accept (promotes to real work item), Decline (confirm modal), Snooze (date), Mark duplicate, Delete, prev/next in filtered list.
- Sources: in-app, forms, email.

**Foundry mapping (keep walk):** Intake in Foundry is **stage 0**, not a separate product inbox. Reuse the **split list + decision header**: left = Issues waiting on a **gate** (Grill / Plan pack / Evidence); right = prompt + recommendation + answer. Accept → `answer` on `DecisionTicket` and advance; Decline → skip/fail with reason; Snooze → leave `blocked`. Duplicate → link to existing Issue.

Do not copy Plane’s “intake then becomes a ticket in backlog.” Foundry Issues are born on the walk and stay there.

Other HITL: issue **subscription**, notification center (`/notifications`, sidebar hidden), draft work items, leave-project / publish-project confirmations. Steal **confirm-before-destructive** and **prev/next through a queue**.

---

## Design system (structure only)

Packages: `@plane/ui` (Header, Row, ContentWrapper, Dropdown, Modal, Tabs, Breadcrumbs, Badge, Avatar, Table, Progress), `@plane/propel` (Button, IconButton, Tooltip, Toast, EmptyState, TabNavigation, icons), `@plane/editor` (document editor — optional later for Spec artifacts). Semantic tokens: surface, layer, subtle border, placeholder text, header height `h-header` / `h-11`.

**Copy structure, not paint.** Foundry already has shadcn-ish tokens in `globals.css`. Prefer those. Empty states with primary CTA match Plane’s `EmptyStateDetailed` pattern (title, description, one action) — restyle black.

---

## Concrete fork / integrate points (keep Foundry walk)

Foundry may take pieces from **all five** products. Plane’s job is the **operator dashboard shell**. Integration rule: Plane surfaces wrap the walk; they never replace `STAGES`, SQLite `Issue` / `IssueStage` / `IssueJob` / `IssueArtifact` / `DecisionTicket`, or eve/GLM workers.

| # | Steal from Plane | Keep Foundry | Other product may own |
| --- | --- | --- | --- |
| 1 | App shell: resizable sidebar + h-11 header + content | Black tokens, Geist, radius 0.625rem | Roomote: session/status strip if remote workers |
| 2 | Issue **list + peek + identifier detail** | WalkStrip as the issue’s primary progress; peek must show current stage + gate | Warren: research brief typography in main column |
| 3 | Intake **split queue + Accept/Decline/Snooze** | Map to Grill/Plan/Evidence `DecisionTicket`, not Plane inbox status | NAC: agent pause/approve if workers need a kill switch |
| 4 | PowerK command registry + contextual commands | Commands advance walk / retry jobs / open gates only | Openship: pipeline-style “next station” command if execute is multi-phase |
| 5 | Layout switcher + spreadsheet columns | Columns = stage, gate, job, artifact — not assignee/estimate | — |
| 6 | Cycle **active hero + grouped list** | Hero = factory pulse (in-flight / waiting-on-you / failed); groups = walk stages | — |
| 7 | Module peek query-param | Optional grouping by idea/size, not Plane modules as a second tracker | — |
| 8 | Properties **right rail** | Rail fields: size, stage, job, skip reasons, artifact kinds | Warren/NAC: extra panels, not Plane labels |

**Do not fork:** Plane Django API, workspace/project RBAC, AGPL editor wholesale (unless legal accepts AGPL), Plane theme CSS, Pages/Stickies/Analytics charts, Gantt/calendar as first-class factory views.

**Integrate, don’t replace:** if Plane (or a thin fork of `apps/web` shell patterns) is vendored, mount Foundry routes under the main column: `/` intake+queue, `/issues/:id` walk detail. Workers stay in `lib/foundry/*`. SQLite remains the issue store.

---

## Anti-goals

- Do not recommend adopting Plane colors, Inter/custom Plane fonts, or light theme.
- Do not turn Foundry into a general PM tool (views, pages, estimates, public Space).
- Do not block the walk on Plane-style “choose project then cycle then module” before research.
- Do not implement Foundry product UI in this leaf (notes only).

---

## Source map (clone)

- README features: work items, cycles, modules, views, pages, analytics — `README.md`
- Routes: `apps/web/app/routes/core.ts`
- Shell: `apps/web/app/(all)/[workspaceSlug]/(projects)/layout.tsx`, `_sidebar.tsx`, `sidebar.tsx`
- Project tabs: `core/components/navigation/use-navigation-items.ts`, `tab-navigation-root.tsx`
- Issue peek/detail: `core/components/issues/peek-overview/*`, `issue-detail/root.tsx`, browse `…/browse/[workItem]/page.tsx`
- Layouts: `packages/constants/src/issue/layout.ts`, `issue-layouts/*`, `base-layouts/*`
- Cycles: `core/components/cycles/*`, cycle detail page under `projects/(detail)/[projectId]/cycles/(detail)/`
- Modules: `core/components/modules/*`
- Command: `core/store/base-command-palette.store.ts`, `core/store/base-power-k.store.ts`, `core/components/power-k/**`
- Intake HITL: `core/components/inbox/*`, `packages/types/src/inbox.ts`
- Tokens: `packages/tailwind-config/variables.css`, `apps/web/styles/globals.css` — **reference only, do not copy into Foundry**

---

## Five steal-items (layout / IA only)

1. **Resizable sidebar + inner framed shell** — peek-on-collapse, persisted width, main column = sticky 44px header + filling content; map Home / Issues / Gates / Workers, not Plane Projects/Pages.
2. **Issue list → peek (side/modal/full) → identifier detail with properties rail** — keep WalkStrip + stage/gate in the rail; never Plane state/priority as the source of truth.
3. **Intake split queue** — list + decision header (accept / decline / snooze / next); bind to Foundry gates (Grill, Plan pack, Evidence), not a pre-backlog inbox.
4. **PowerK command palette** — registry, contextual commands, `Cmd+K`, change-page pickers; commands only navigate the factory or advance the walk.
5. **Layout switcher + cycle grouped list / active hero** — list vs spreadsheet (and optional kanban = walk columns); factory-pulse hero instead of sprint burndown.

Theme lock reminder: these five are structure. **Do not adopt Plane colors.**
