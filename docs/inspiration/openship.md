# Openship study — leaf 1.1.5

Source clone: `/tmp/foundry-inspiration/openship`  
Upstream: https://github.com/oblien/openship  
Site: https://openship.io  
License: Apache-2.0  
Read date: 2026-08-17  
Scope of this leaf: **layout, density, navigation, ops workflow**. Not colors. Not a fork of the product.

This note is for Foundry’s production-ready HITL factory rebuild (tree-7). D1 says all five products are eligible: Warren, Plane, Roomote, NAC, and Openship. Combine whatever actually serves the factory. D2 locks Foundry’s dark theme. If a pattern conflicts with the factory model, keep the factory and steal only the UX.

Openship is not an issue tracker. It is a self-hostable **deployment / shipping ops** control plane. Foundry is a human-in-the-loop software factory whose record is a local SQLite Issue tracker. The steal is the **operator surface for a live pipeline**, not the domain.

---

## 0. Steal-list (front)

Concrete patterns to take. Details and mapping live in later sections. Do **not** adopt Openship colors, gradients, dim/light themes, orange/violet CTAs, or success/danger token names.

1. **Sectioned left rail** with uppercase 11px headings, 260px expanded / 72px collapsed, identity at the bottom.
2. **Nav as data** (`getNavSections`) so the rail is unit-testable without React.
3. **Active-item rules** that treat `/` as exact match and everything else as prefix, plus query-tab identity when many items share one route.
4. **Counts as tabular metadata**, not notification badges — and only when `> 0`.
5. **Primary action parked at the bottom of the rail**, above account, not in the page header.
6. **Product-view swap of the same shell** (platform vs mail) without a second app chrome.
7. **Server-resolved rail on first paint** so the nav does not flash the wrong product.
8. **Full-width notice strip above the sidebar** that renders nothing when idle.
9. **Home = work list + sticky attention column**, `lg:grid-cols-[1fr_340px]`.
10. **Attention ladder**: alerts eat furniture, never stack an alert panel next to two idle cards.
11. **Operational roll-up** that does not restated the issue rows beside it.
12. **Broken vs advisory split** — updates are not faults.
13. **Allowlist for “healthy”**, not a denylist of failures.
14. **Paused is muted, not amber** — operator-chosen stop is not a Gate.
15. **Attention always names a reason** (`decision` / `routing` / `blocked` / `newestDeployDidNotLand`).
16. **Yellow dot on the tab that needs work**, not a toast for every optional failure.
17. **Routing failure never fails the ship** — it flags the Domains tab.
18. **Trigger → live build screen** as one idiom (`openTriggeredBuild`).
19. **Stay on the live log page**; attach to an already-running job; never re-POST start.
20. **Facet counts from the unfiltered list** so the strip stays still while search narrows.
21. **Open / resolved (or status) switch** as a small pill group, not a second sidebar.
22. **Row density**: `px-5 py-3.5`, 40px glyph, name column 11–14rem, chips, status at the end.
23. **Stretched-link overlay** so the row is an `<a>` and menus stay buttons.
24. **Inner entity nav as a second card**, sticky `lg:top-6`, same hit targets as the rail.
25. **Mobile: sticky horizontal tabs**; desktop: right column. Do not keep a third bottom pill bar.
26. **PageContainer**: `max-w-[1600px]`, `px-4 sm:px-6 lg:px-8 py-6`.
27. **Page titles**: `text-2xl font-medium`, letter-spacing `-0.2px`, subtitle `text-sm text-muted-foreground/70`.
28. **Jobs as named recurring work** with last-run tone, duration, and a logs modal.
29. **Audit last on the rail** — a read surface, never a setting.
30. **Setup-collapsed nav**: one entry until the thing exists; do not show ten dead links.
31. **Home shortcuts as a 2×2 / 4-up of quiet cards**, not a marketing grid.
32. **Skeleton rows that match live row geometry**.
33. **Org/workspace switcher lazy after first paint of the name**.
34. **Identity is local operator**, cloud is a credential hint, never a name swap.
35. **Map Openship project → Foundry Issue**, deployment → Walk drop, build log → Event log, system issues → Gates that need a human.

---

## 1. What Openship actually is

README headline: *open-source, self-hostable deployment platform with built-in CI/CD*. Point it at a repo — it builds, **ships**, routes, and TLS-terminates. Drive it from a desktop app, web **dashboard**, or CLI.

That is an **ops** product. The operator’s job is: keep apps running, see what is in flight, unblock what is stuck, ship the next version.

Foundry’s operator job is: keep an Issue walking twelve stages, answer Gates, read artifacts, ship a PR to a target repo. Same *kind* of attention. Different nouns.

### 1.1 Three ways to run the control plane

| Operator | Control plane | Where apps run |
|---|---|---|
| Solo, one machine, no ops | Desktop app | SSH server or Openship Cloud |
| Team / always-on | Self-hosted (`openship up`) | Same box (Compose) or out (bare) |
| Zero ops | Openship Cloud | Managed sandboxes |

The README’s first decision is **how you run the control plane**, not which framework you use. Foundry already made that decision: one Next.js dashboard on the operator’s machine, SQLite + JSONL on disk, Tailscale, no extra login. Steal the *clarity of the first decision*, not the three runtimes.

Desktop: control plane runs only while the app is open. Nothing left running, nothing exposed. Always-on install is for push-to-deploy, team access, or hosting apps on that box.

Foundry analog: the dashboard *is* the control plane. Workers are fire-and-forget from server actions. There is no public webhook inbound in v1. Do not grow a second “always-on agent host” UI.

### 1.2 Pipeline in the README (detect → build → run → route → push)

1. **Detect** — read `package.json`, lockfiles, compose, `openship.json`. Zero config required.
2. **Build** — Docker image or bare release. Config frozen into a snapshot so rollback is exact.
3. **Run** — container on loopback only, or supervised host process. Never a public app port.
4. **Route + secure** — OpenResty vhost + Let’s Encrypt *after* the app is up. DNS/cert hiccup is “action required”; it does **not** fail the deploy or take the app down.
5. **Push-to-deploy** — GitHub webhook; monorepo rebuilds only touched services.

This is the most important product sentence for Foundry:

> Because routing and TLS happen *after* the app is up, a DNS or cert hiccup surfaces as "action required" — it never fails the deploy or takes your app down.

Map: a Gate is a named stop. A non-gate failure in a later concern must not rewind the Walk. Evidence can fail without undoing Execute. Hygiene can nag without un-merging. Grill is the first human stop; it is not a deploy.

### 1.3 Interfaces

- Desktop — full GUI, real-time logs, one-click. Solo.
- Web **dashboard** — same UI in the browser. Teams.
- CLI — install, `up`, `deploy`, completion.
- MCP + REST — automation. Only opted-in routes become tools; credential routes never do.

Foundry: dashboard is the human place (lock). Workers via eve Client. MCP is not a v1 surface. Command menu (leaf 1.3.1) is the in-dashboard analog of “drive it without hunting the rail.”

### 1.4 Feature table (what not to copy)

Built-in CI/CD, any stack, full backend, domains & SSL, CDN, mail server, backups, real-time monitoring (~1.4 µs per request, zero DB writes per request), scaling, portability, compose-as-is.

Foundry does not become a PaaS. Sandboxes are disposable Docker checkouts of the *target* repo. Foundry data does not live there. Do not steal mail, CDN, billing, or geo maps.

Steal: **one place for the live job**, **status that tells you whether to act**, **logs while it runs**.

---

## 2. Eligibility among the five

D1: Foundry may build around or fork Warren, Plane, Roomote, NAC, and Openship — not Plane-only.

| Product | What it is good for | What Openship uniquely contributes |
|---|---|---|
| Plane | Issue list density, project chrome | Openship is denser on **ops lists** (deploys, jobs) than on writing Issues |
| Warren | HITL queues | Openship attention feed is a **two-card** queue: broken vs behind |
| Roomote | Remote-agent status | Openship **build page** is the live remote job |
| NAC | Command menu | Openship has no cmdk; do not look here for palette |
| Openship | Shipping **ops**, dashboard, nav, density of running work | This file |

Locked and not deleted by any fork:

- Issue tracker = Foundry SQLite + JSONL on disk
- GitHub on the target only receives the PR
- Walk: Intake → Research → Grill → Spec → Improve → Plan pack → Council → Architecture → Execute → Evidence → Merge → Hygiene
- Gates: grill, plan, phase, evidence
- Size forced-L skips nothing for first self-job
- Workers via eve (GLM zai/glm-5.2 Blackbox pin); no raw Gateway
- Dashboard is the human place; CONTEXT.md is law on the target

Noun collision: Openship `/issues` is a **system health tracker** (outage / action_required / advisory). Foundry **Issue** is a unit of work that walks stages. Never merge those words in the UI. Openship Issues → Foundry “Needs you” / Gate inbox. Foundry Issue stays CONTEXT.md language.

---

## 3. Theme lock (D2)

**Do not** adopt Openship’s:

- teal npm badge (`#0b7285`)
- dark-mode CTA gradient `amber → orange → rose`
- light-mode CTA `violet → primary → blue`
- dim theme lime gradient
- `--th-card-on-page` fade hacks as a reason to add a second theme
- `bg-success-bg` / `text-danger` token *names* if they imply a new palette file
- rounded-2xl-as-brand (Foundry radius is `--radius: 0.625rem`)
- `html` light/dim/dark cycle in the rail

**Do** keep Foundry:

- black background
- `app/globals.css` variables: `background` / `foreground` / `card` / `primary` / `muted` / `border`
- Geist / Geist Mono
- `--radius: 0.625rem`
- `html` class `dark`, body `bg-black text-neutral-100`

New UI must look like Foundry, not an Openship reskin. Steal **layout, density, nav, IA, interaction**. Translate status color to Foundry neutrals + one amber for `blocked` (already in `stageTone`).

---

## 4. Dashboard shell (layout)

File: `apps/dashboard/src/app/(dashboard)/layout.tsx`

### 4.1 Boot gates before chrome

The layout does not render the rail until:

1. Session exists (else `/login`).
2. Org chooser: 2+ orgs and no valid active org → `/select-organization`; one org → auto-set.
3. Fresh `deploymentInfo` (skip cache) or `ApiUnavailable`.
4. `migrationInProgress` → in-progress launcher (poll health, no writes).
5. Migrated team instance → `MigratedLauncher` only.

Foundry analog: do not invent org chooser or migration. Do invent **one honest empty/error surface** when SQLite cannot open or the worker host is down. Do not render a fake Walk.

### 4.2 Geometry

```
┌─────────────────────────────────────────────┐
│ UpdateCenter (full width, idle = 0px)       │
├──────────────┬──────────────────────────────┤
│ Sidebar      │ <main> overflow-y-auto       │
│ 260 / 72     │ PageContainer max 1600       │
└──────────────┴──────────────────────────────┘
```

- Outer: `flex flex-col h-dvh`
- Inner: `flex flex-1 min-h-0`
- Sidebar: `my-3 ms-3` floating card, `rounded-2xl border border-border/50 bg-card`
- Main: `flex-1 overflow-y-auto`

Foundry today is a `max-w-xl` column on black with no shell. Leaf 1.3.1 should grow an app-shell + sidebar. Steal this **split**, not the floating 12px gutter if it fights Geist density — a flush rail on black is more Foundry than a card-in-card. If the rail is a card, use Foundry `--card` and `--radius`, not 16px rounding as a brand.

### 4.3 UpdateCenter

Full app width, **above** the sidebar. Renders nothing unless advisory / platform notice / update / what’s-new. Idle chrome cost is zero.

Foundry map: stale-job banner, worker-failed banner, “Grill is waiting” — full width, above the rail, gone when idle. Do not put those in the Issue hero *and* a toast *and* the Walk strip.

### 4.4 First paint of the rail

`productView` is resolved **on the server** and passed into providers. Client cookie read would paint the platform rail then flip to mail. Foundry: if the shell ever has modes (factory vs a future mail-like view), resolve on the server. v1 has one view. Still: **do not flash**.

---

## 5. Navigation model (nav)

File: `apps/dashboard/src/lib/sidebar-nav.ts`  
Renderer: `apps/dashboard/src/components/sidebar.tsx`

### 5.1 Nav is data

Comment in source: *The sidebar's nav model — pure data, no React, so both shapes of the rail are unit-testable without rendering a sidebar.*

Two products, one shell:

- `getNavSections(isSaaS, selfHosted)` — deploy platform
- `getMailNavSections(input)` — mail: ten admin tabs promoted to rail entries

Foundry: `getNavSections()` in a ts module, consumed by `sidebar.tsx`. Test active highlighting without JSDOM if possible. Sections for v1:

```
MAIN
  Home            /
  Issues          /          (or /issues if home is intake-only)
  (optional) Log  — later

ACCOUNT (footer, not a route list)
  operator identity
```

Do not copy Servers, Emails, Billing, Library, Apps, Deployments as top-level Foundry destinations. **Deployments** as a cross-Issue “what is running” page is optional later; the Walk lives on the Issue.

### 5.2 Platform MAIN_ITEMS (order)

Exact **order** in source:

1. home `/`
2. projects `/projects`
3. apps `/apps`
4. deployments `/deployments`
5. issues `/issues`

Comment: Issues is MAIN, not infrastructure, because `/api/issues` reports project/domain/update items on SaaS too; putting it under `if (selfHosted)` would delete the page from cloud. **No count badge** on Issues — the home fetch has no issue total, and a badge here would be the only notification-style one in the rail.

Foundry: **do not badge the Issue list with a red count.** Show stage text on the row. If a Gate is waiting, the row status line already says “Waiting on you” (`issueListStatus` for grill).

### 5.3 Settings tail — last row is audit

Settings items: backups, settings, billing (if SaaS, **last among paid**, because billing mid-rail on a self-hosted box read as “this install is metered”), then **audit last**.

Comment: *Audit log, last row of the rail. Promoted out of Settings: it is not a setting — you never change anything here, you READ what already happened, and burying a review surface three clicks deep behind a settings tab is how it goes unread. Last on purpose: it is consulted after the fact, never on the way to a task.*

Foundry Event log is that surface. Do not bury JSONL behind a settings gear. On the Issue page, a quiet “Event log” disclosure or a tab in the inner nav is enough. Global audit of all Issues is a later page, last on the rail.

### 5.4 Infrastructure ahead of settings

Self-hosted: servers, emails, jobs. Comment: *Servers is the second thing you reach for after Projects, and it used to sit below Backups/Settings/Billing.* Empty groups `filter` out.

Foundry has no servers page. The analog of Jobs is **running workers** — but that belongs on the Issue (RefreshWhile / job status), not a global cron UI.

### 5.5 Active highlighting

`isNavItemActive(item, pathname, currentTab)`:

- Tab items: path ownership + canonical query tab (retired `?tab=` still highlights the absorbed section).
- Home: **exact** `/` or it swallows every route.
- Else: pathname equals path or `startsWith(path + "/")`.
- `alsoAt` widens ownership (mail console also at `/`).

Foundry: Home exact. Issue detail is `/issues/[id]` — if the list is `/`, do not highlight Home on the detail page; highlight Issues. If the list *is* Home, then Home is exact and Issue pages highlight nothing in the rail except maybe Issues if you add `/issues` as the list.

Recommended Foundry IA:

- `/` — intake + Issue list (Home)
- `/issues/[id]` — factory walk
- Rail items: Home (exact `/`), then nothing else in v1 besides maybe a dead-quiet “Docs” later
- Inner Walk strip is not the rail

### 5.6 Counts

`sidebar-nav-counts.ts`: revision counter + subscribe. Fetch `projects/home` **after** org is resolved so counts do not race the wrong workspace. Distinct-by-id because local+cloud merge can duplicate. Projects vs Apps split on `isApp`. Hidden at 0 and when collapsed. `text-[13px] tabular-nums text-muted-foreground/45`.

Foundry: if Home shows an Issue count in the rail, same rules. Prefer no count.

### 5.7 CTA

Gradient button at the **bottom of the nav**, not the top. Mail view: “Add mailbox” only once a server is installed; before that the setup row *is* the primary action.

Foundry: intake lives on Home. Do not put “New Issue” as a rainbow button on the rail. A quiet `+` that focuses the intake field is enough. **Do not steal the gradient.**

### 5.8 Identity footer

- Local Better Auth user is always the name.
- Cloud is a credential the local user holds — hint line, not a replacement.
- Desktop zero-auth: `machineName`, never the cloud profile.
- Org switcher: Cloudflare-style trigger, popover above when expanded, to the side when collapsed.
- Role chips per workspace.
- Sign out in the popover footer.

Foundry: no orgs. Footer can be “this machine” / data path, or omitted. If omitted, do not leave an empty ACCOUNT heading.

### 5.9 Collapse

Width 260 → 72. Icons `size-[18px] strokeWidth={1.7}`. Hit target `px-3 py-2.5 text-[15px]`. Collapsed: icon only, title tooltip, section separators as 1px rules. Scroll fade at the bottom so the list does not hard-clip under the CTA.

Foundry: 15px medium is slightly large for a factory; Plane-class density may want 13–14px. Steal the **hit target and section rhythm**, then tune type to Geist.

### 5.10 Mail rail (pattern, not product)

Ten tabs in one row is a wall. Three groups: administer day-to-day, whether mail is flowing, the machine. Setup: **one** entry until installed (`getMailSetupItem`). Host rows lead infrastructure because they exist before a mail server does.

Foundry Walk has twelve stages. Do not put twelve rail items. The Walk is a **strip on the Issue**, not the app nav. If a stage has sub-surfaces (grill tickets vs prior rounds), group them like mail: decide, then check.

---

## 6. Density inventory

Measured from dashboard source. Translate to Foundry tokens.

### 6.1 Type

| Role | Openship | Foundry translation |
|---|---|---|
| App name in rail | `text-base font-semibold tracking-tight` | keep modest; Foundry home h1 is already `text-3xl` |
| Page title | `text-2xl font-medium`, letter-spacing `-0.2px`, `text-foreground/80` | use `text-foreground` on black; skip the 80% fade if it greys out |
| Page subtitle | `text-sm text-muted-foreground/70 mt-1` | `text-neutral-400` / muted |
| Section heading in rail | `text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60` | steal |
| Nav item | `text-[15px] font-medium` | consider `text-sm` |
| Inner project tab | `text-[14px] font-medium` | steal |
| Card title | `text-[15px] font-semibold` | steal |
| Meta / chips | `text-xs` / `text-[10px] font-medium` mono for versions | steal |
| Status pill | `text-[11px] font-semibold rounded-full px-2.5 py-1` | steal geometry, Foundry colors |
| Job row secondary | `text-[12px]` / `text-[13px]` | steal |
| Open/resolved switch | `h-8 … text-[12px]` | steal |

### 6.2 Spacing

| Surface | Classes |
|---|---|
| PageContainer | `max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6` |
| Home header | `mb-6` |
| Main grid | `grid-cols-1 lg:grid-cols-[1fr_340px] gap-6` |
| Card padding header | `px-5 py-4` |
| List row | `px-5 py-3.5` (projects) / `px-5 py-4` (skeletons) |
| Rail item | `px-3 py-2.5`, `space-y-1` between items, `mt-5` between sections |
| Inner tab list | `p-3` card, `space-y-1`, same `px-3 py-2.5` |
| Home shortcuts | `grid-cols-2 sm:grid-cols-4 gap-3`, card `p-4` |
| Sticky inner column | `lg:sticky lg:top-6 lg:self-start`, `space-y-4` |

Foundry Issue page today: `max-w-xl … gap-10 px-6 py-12`. That is a reading column, good for research brief prose. After chrome lands, keep the **brief as a reading column** inside a denser shell. Do not stretch Grill tickets to 1600px of empty card.

Recommended Issue frame density:

- Shell: Openship page padding
- Hero + Walk strip: full content width (~min 0, max ~56rem for prose)
- Grill / plan / evidence: same reading width
- Execute logs: full remaining width, mono `text-[12px]`, like job command pre (`bg` = card, not `#0b0b0c` as a new color — use Foundry card)

### 6.3 Row anatomy (ProjectCard)

- Relative row, stretched `Link` `absolute inset-0 z-0`
- Glyph 40×40 `rounded-xl`
- Name column fixed `w-44 lg:w-56`
- Version chip `font-mono text-[10px]`
- Flex-1 meta: stack chip, hosting, source — hide on overflow
- Status pill at the end
- Kebab `z-10`

Foundry Issue list row should match this **information order**: status line (already), idea (name), then optional size + current stage chip, then updated-at. Not a second paragraph of marketing.

### 6.4 Facet strip

Jobs and Issues: overview facets double as the list filter. Independent predicates. Counts from **unfiltered** list. Search debounce 300ms. Clear filters also cancels the pending debounce.

Foundry home: do not over-filter twelve stages on day one. If a filter appears, use this strip, not a dropdown of twelve.

### 6.5 What density is not

Openship is not Linear-tight. Rows have 14px vertical padding and 40px icons. It is **ops-readable**: you can scan hosting + status without opening the project. Foundry should not go back to `max-w-xl` only, and should not go to 8px table cells. Aim between current Foundry and this dashboard.

---

## 7. Home dashboard (ops workflow)

File: `apps/dashboard/src/app/(dashboard)/DashboardHomeClient.tsx`  
Data: `GET projects/home` via `useDashboardHome`  
Attention: `useAttentionFeed` → `/issues`

### 7.1 Greeting, then work

Title: time-of-day greeting + first name. Subtitle one line. Then the grid. No hero illustration on a populated home.

Foundry: “Tell it what to build.” can stay as Home’s intake heading. Do not add “Good evening, Kartik” unless it earns space. Openship’s lesson is **greeting is small; the list is the page**.

### 7.2 Left column: the list you actually have

Card: icon 36px in `primary/10`, title, count subtitle, “View all” text button.

Body:

- Loading: 4 skeleton rows matching live geometry
- Empty: `HomeWelcome` (onboarding, not a sad void)
- Populated: first **6** projects as `ProjectCard`, then a “view all N” row

Foundry Home already lists all Issues under intake. Steal: **card around the list**, **status on the first line**, **cap + view all** only if the list grows long. Intake stays above the list (Openship’s primary CTA is in the rail; Foundry’s primary CTA is the form).

### 7.3 Shortcut grid

Four quiet cards: Import Git, MCP deploy, Settings, Docs. Icon in muted square, `text-sm` title, `text-xs` description.

Foundry: skip Git import / MCP. Optional later: link to CONTEXT.md language, or “open latest Issue”. Do not fill Home with four empty promises.

### 7.4 Right column: attention ladder

Comment in source is the product:

> The column yields to attention one card at a time, least urgent first: one alert panel takes the Activity overview's space, a second takes the Apps card's. Nothing is lost — lifetime deploy counts live under Deployments and the catalog has its own sidebar entry — and it keeps the fold from becoming an alert panel chased by two pieces of furniture.

Rules:

- `attention.cards` counts what will **render**, hides included
- Dismissing a panel hands space back
- Activity card (counts + SystemStatusRow) only if `attention.cards === 0`
- Apps card only if `attention.cards < 2`
- UpdatesBlock always in the column (advisories live there)

Foundry Home right column (when the shell is wide):

1. If any Issue is `blocked` or job `failed` or grill waiting: **Needs you** card (the Gate inbox)
2. Else: small counts (open Issues, active Walks) + “Operational” analog: “Nothing waiting”
3. Do not show a catalog

Sticky: `lg:sticky lg:top-6`.

### 7.5 SystemStatusRow

Replaces lifetime deploy success rate (“a number nobody acts on”). Reads the **same** `/issues` feed. Advisories do not count. If both attention cards show, Activity is not rendered — at most one alert panel with this line.

Foundry: do not show “87% stages succeeded.” Show “2 waiting on you” or “All quiet.”

### 7.6 Attention feed implementation notes

- Fail-soft to empty (column falls back to product tip)
- Auto-scan infra once if enabled and stale; else read cache
- Hide is browser-local and **self-expiring** for the exact id set; a new issue unhides
- Never hide during SSR first paint (`issues === null`)

Foundry: local hide of a Gate is dangerous. Prefer not to steal hide. Steal fail-soft and single-fetch.

### 7.7 Mail home branch

If `productView === "mail"`, `/` **is** the mail console. No redirect. `projects/home` is never fetched. Rail and page cannot disagree.

Foundry: `/` is always the factory home. No product-view cookie.

---

## 8. Cross-cutting ship list (deployments)

Files: `apps/dashboard/src/app/(dashboard)/deployments/`

This is Openship’s **global Walk board**: every ship in flight or finished.

### 8.1 Header + stats + list + 340px rail

Same grid as home. Filters: search (debounce 300ms), optional project filter, status switch: all / success / failed / building / canceled. (`pending` exists in state but the visible FILTERS omit it — in-flight folds into building.)

### 8.2 DeploymentCard

- Status config (dot + label + duration)
- Framework or app logo
- Project name + commit
- Branch, clock, external link
- **Per-service chips** when a compose stack fans out: success / failure / cancelled / skipped / building / deploying / missing (removed on host) / indeterminate (connection dropped) / pending
- Menu: rollback, pin, etc.

Foundry execute stage: if the worker has substeps, **fan-out chips**, not a second Walk. The Walk stays twelve stages. Chips are inside Execute / Evidence.

### 8.3 Trigger → build idiom

`lib/deploy-nav.ts`: after `deployApi.trigger`, land on `/build/${id}` or the project’s deployments list. One function so Redeploy and domain-add auto-deploy cannot drift.

Foundry: `startResearch` / `startGrill` / `startWalkStage` already fire-and-forget. The UI must **navigate to or stay on the Issue** and show the live panel. Do not dump the operator back to Home. `RefreshWhile` is the right instinct; Openship’s build page is the richer version (stream, not interval only).

### 8.4 Build page

`apps/dashboard/src/app/(dashboard)/(deployment)/build/[id]/page.tsx`

Critical comments:

- Server `requestBuildAccess` already `kickoffBuild`. Client **attaches** via GET stream (`startBuild = false`).
- Previous POST `/build` was racy: stall → reconnect gate refused retry → empty terminal until refresh.
- Redeploy: same attach-not-restart. `router.replace` to the new id without scroll jump.
- Redeploy button holds loading until the new id is in hand.

Foundry jobs: `running | failed` (types) with stale-at-8-minutes. Steal:

- Never double-start on refresh (`startResearch` currently *does* get called from the page when research is running — that is the opposite of Openship’s attach model; call out for 1.4.1: **idempotent start / attach**)
- Empty log is a reconnect bug until proven otherwise
- Stay on the Issue

---

## 9. Project as Issue analog (inner nav)

Files:

- `projects/[id]/[[...slug]]/page.tsx` — tab switcher + content
- `ProjectSidebar.tsx` — identity card + tab list
- `ProjectSettingsContext` — `tabs: { id, label, icon }[]`

### 9.1 Two-column entity layout

Left (main): tab content.  
Right (desktop): sticky identity + nav.  
Mobile: `ProjectMobileTabs` sticky top, horizontal scroll, `backdrop-blur`.

There is also `ProjectsBottomNavigation` — a **fixed bottom pill bar** with inverted colors (`bg-foreground` pills). That is a third nav. **Do not steal it.** Two surfaces (rail + inner tabs) is enough; three is a video-game HUD.

### 9.2 Identity card

- Eyebrow “PROJECT” 11px uppercase tracking
- Name + external link
- Status pill (`PROJECT_STATUS_META`)
- Production vs local URL, domain switcher if many
- If no domain: placeholder + **Add domain** jumps to the tab *and* sets `pendingDomainAction`
- Optional SSH-forward “Open” on desktop managing a remote box
- Last deploy timestamp

Foundry StageHero should be this card’s cousin:

- Eyebrow = current stage label (`STAGE_LABEL`)
- Title = Issue idea
- Pill = stage status (`pending | active | blocked | skipped | done`)
- Meta rows: size, target repo (not a public URL), last event time
- Primary link: none to production; maybe the target GitHub URL as muted text, not a deploy

### 9.3 Tab list = Walk strip with icons

Openship project tabs (icons in `TAB_ICONS`): overview, monitoring, services, domains, deployments, health, source, webhooks, runtime/settings, logs, backup, advanced.

Click: `preventDefault` unless modified click (cmd/middle open new tab). `history.replaceState` to `/projects/:id/:tab`. Preserve scroll.

Domains tab: **1.5px warning dot** if `routingUnsynced` or domain/ssl hard-failed. Pending DNS is **not** flagged.

Foundry WalkStrip today: wrap of `text-xs` labels with “ · now”. Steal:

- Same hit target as rail items if the strip is clickable (jump to a done stage’s artifact)
- Active = `bg-foreground/[0.07]` equivalent using Foundry card/muted
- Blocked stage: amber text already in `stageTone`; add a 6px dot if we need scanability
- Skipped: muted, still listed (forced-L lists all twelve)
- Do not make WalkStrip a second sidebar of 12 rows on desktop *and* a strip. **One strip under the hero.** Detail is the stage panel.

### 9.4 Environment switcher

Branch → environment name. Create env from branch list. Foundry Size (XS–forced-L) is not an environment. Do not add env switcher. Size is chosen at intake and locked for the Walk.

### 9.5 CloudConnectionGate

Wraps every project tab. If deploy target needs cloud and the operator is disconnected, one gate for overview, deployments, settings, env — not a different wall per tab.

Foundry: one Gate component pattern. Grill / plan / phase / evidence should **feel like the same wall** (answer to continue), not four unrelated modals.

---

## 10. Status model (steal the algebra, not the badges)

File: `apps/dashboard/src/utils/project-status.ts`

### 10.1 States

`live | paused | attention | queued | building | deploying | failed | cancelled | deleting | draft`

Presentation is CSS-only; labels from i18n.

### 10.2 Allowlist for healthy latest deploys

`ready`, `cancelled`, `no_changes`. Everything else is “the newest deploy did not land.” Round 1 used a denylist and missed `partial_failure`, `rejected`, `reconciling`.

Foundry stage status is already a small union. Keep it. When jobs grow more verbs, **allowlist done**, do not denylist fail.

### 10.3 Attention reasons (named)

- `decision` — partial failure awaiting keep/reject
- `routing` — live is fine, edge route not synced (Retry routing)
- `blocked` — newest deploy blocked on a **named, clearable** cause (port conflict); never became active
- `newestDeployDidNotLand` — older release still serving

Cards **explain** the amber pill (`projectStatusHint`).

Foundry Gates already have kinds: grill, plan, phase, evidence. Every blocked Walk must show **which Gate** and **what to do**. Do not show “blocked” alone.

### 10.4 Paused vs attention

Paused is operator-chosen (`enabled === false`). Muted badge, not amber. A paused project still has a `ready` active deployment, so status derived only from the row used to say Live over a project serving nothing.

Foundry: skipped stages are chosen by Size, not a Gate. `stageTone` skipped is `text-neutral-600`. Keep that. Do not paint skipped as blocked.

### 10.5 In-flight beats paused

queued / building / deploying claimed first. Then paused. Then attention. Then live / failed / draft.

Foundry: `active` + running job beats everything. `blocked` beats `pending`. `stale` is a job overlay, not a stage status — show retry on the panel.

### 10.6 Self-app exception

Control-plane app template `openship` is always live (no deployment row). Foundry has no analog. Do not special-case the dashboard Issue.

### 10.7 StatusDot (packages/ui)

`queued gray`, `building yellow pulse`, `deploying blue pulse`, `ready green`, `failed red`, `cancelled gray`.

Foundry: pulse only on `active` with running job. Failed = destructive token already in globals. No green-for-done if the rest of the UI is grayscale — done is `text-neutral-400` today. **Keep grayscale done; amber blocked; bright active.** Do not import Openship green.

---

## 11. Jobs page (ops of recurring work)

`apps/dashboard/src/app/(dashboard)/jobs/page.tsx`

- Filters: all / running / failed / scheduled / disabled
- Search
- Sections: custom, system, backup schedules (read-only side view; failure degrades to empty)
- Row: label, cron, last run tone, duration, run / toggle / edit / logs / delete
- Run opens logs modal with `runId`
- SaaS: page does not pretend jobs exist (`selfHosted` gate)

`jobFormat.statusTone`: success / failed / else warning. Icons: CheckCircle2 / XCircle / Loader2.

Foundry workers are **per Issue, per stage**, not cron. Steal:

- Last-run line on the stage panel
- Duration when we have it from the event log
- Logs modal or inline event tail
- Independent facet predicates
- Backup-like secondary lists must not fail the page

Do not add a global Jobs item to the Foundry rail in v1.

---

## 12. Openship Issues page (not Foundry Issues)

`IssuesView.tsx` comment:

> All the judgement lives server-side in `/api/issues` — severity, grouping, and the fix each row carries. What's left here is genuinely presentational state … this page NEVER decides that something is fine. An empty list means every source reported nothing, not that a filter here chose to hide it.

- Tabs: open / resolved — **same geometry as deployments status switch**
- Severity facets: all / outage / action_required / advisory
- Search debounce 300ms
- Rescan (self-hosted) runs scheduled checkers early
- `useReattachActiveFix`: if a fix is already running, reopen the live modal on refresh
- Empty = `EmptyIssues`, honest

Foundry must not name a page “Issues” meaning system health. The Gate inbox on Home is enough. If a dedicated page appears, call it **Gates** or **Needs you**.

Steal: judgement on the server (store), UI is filters + dispatch; empty means empty; reattach live work on refresh.

---

## 13. Servers, backups, audit, monitoring (brief)

- **Servers**: host inventory, tabs, connect-new. Out of scope for Foundry v1.
- **Backups**: scheduled, restore. Out of scope. Hygiene stage is cleanup of the sandbox, not volume snapshots.
- **Audit**: read-only event table. Map to Event log UI later.
- **Monitoring**: edge counts in shared memory; control plane collects. Foundry event log is append-only JSONL on disk — already the right shape. Do not put analytics on the request path of the dashboard.

---

## 14. Map onto the Foundry factory walk

Walk (locked):

Intake → Research → Grill → Spec → Improve → Plan pack → Council → Architecture → Execute → Evidence → Merge → Hygiene

Gates: grill, plan, phase, evidence.

UI slots: `page.tsx` composes StageHero, WalkStrip, one stage panel. Panels must not import each other’s internals.

### 14.1 Intake

Openship analog: Library / New project CTA + empty HomeWelcome.

Foundry: intake form on Home (already). Steal row density for the Issue that appears after submit. After create, **go to the Issue** (Openship `openTriggeredBuild`), do not leave the operator on Home wondering if it started.

### 14.2 Research

Openship analog: building status + build log page.

Foundry: research panel + RefreshWhile + RetryResearch. Steal attach-not-restart. Steal skeleton that matches the brief sections, not a spinner-only card forever. Running copy can stay human (“Reading the repo”).

### 14.3 Grill (Gate)

Openship analog: `awaitingDecision` / keep-or-reject; Issues `action_required`; attention reason `decision`.

Foundry: Decision tickets, frontier empty to advance. Steal: named reason, one wall, reattach if a round is mid-save, facet is round number not severity. Do not use Openship’s “partial deploy” copy.

### 14.4 Spec

Openship analog: Overview tab — the document of what this project is.

Foundry: spec-panel, reading width. Steal page title + muted subtitle pattern (`Spec` / one line of when it was written).

### 14.5 Improve → Architecture (mid-walk)

Openship analog: source / runtime / services tabs — configuration after the thing exists.

Foundry: mid-walk-panel. Steal inner tab **within the panel** only if multiple artifacts must be on screen; default one artifact. WalkStrip shows skipped architecture on Size M as muted, not missing.

### 14.6 Plan pack (Gate)

Openship analog: deploy preview / “this is what will ship.”

Foundry: plan Gate. Steal allowlist thinking: the plan is not done until the operator says so, regardless of extra statuses the worker might invent.

### 14.7 Execute (Gate: phase)

Openship analog: **the ship** — deployments list + live build + per-service chips.

Foundry: late-walk execute. Steal live log layout, trigger→stay, phase Gate as named block (port conflict analog: “phase not approved”). Routing-style: a sandbox hiccup should not mark Execute failed if the lock says otherwise — but Foundry execute *is* the work; do not over-apply “never fail the deploy.”

### 14.8 Evidence (Gate)

Openship analog: Health + Monitoring tabs; evidence the ship is real.

Foundry: evidence-doc + Gate. Steal: optional concerns (like routing) flag a **dot on Evidence**, they do not silently fail Merge.

### 14.9 Merge

Openship analog: domain goes live / edge takeover prompt on the build screen.

Foundry: merge-doc, PR on the target. Steal “action required” on the build page (takeover prompt) as a **Gate-shaped banner on the panel**, not a rail badge.

### 14.10 Hygiene

Openship analog: backup tab + deleting state.

Foundry: sandbox dies at hygiene. Steal muted “chosen stop” for paused if we ever pause a Walk; hygiene itself is a real stage on forced-L.

### 14.11 Collapse / Size

Openship setup-collapsed mail rail: one link until the server exists.

Foundry Size skips stages. WalkStrip still lists them (skipped). Do not hide skipped stages — operators need the map. Do hide **panel chrome** for skipped stages (no empty Improve form on XS).

---

## 15. Foundry chrome slots (for 1.3.x / 1.4.x)

Leaf 1.3.1 owns `app-shell`, `sidebar`, `command-menu`, `globals.css` tokens unchanged.

### 15.1 app-shell

- `h-dvh` flex column
- Optional top banner slot (stale/fail) — idle height 0
- Sidebar + main
- Main `overflow-y-auto`
- No Openship `ms-3 my-3` unless it still looks like Foundry black

### 15.2 sidebar

- Data module for items
- Home exact active
- Optional Issues item if Home is not the list
- No gradient CTA
- No theme cycle control (Foundry is dark-locked)
- Collapse optional; if skipped, 220–260px is enough

### 15.3 command-menu

Openship has none. NAC/Plane own this. From Openship, only: commands should include **open Issue**, **focus intake**, **jump to current Gate**. Do not list twelve stages as commands unless jump-to-artifact is real.

### 15.4 Home (1.3.2)

- Keep intake
- Issue rows → ProjectCard density
- Wide breakpoint: attention column with Gate inbox
- Copy stays CONTEXT.md (Issue, not ticket)

### 15.5 Issue frame (1.3.3)

- StageHero ← identity card (no Openship status colors)
- WalkStrip ← project tab list geometry, still a strip
- RefreshWhile ← attach semantics
- One panel below

### 15.6 Panels (1.4)

- Research: log + brief
- Grill: ticket list density like IssuesView rows
- Spec: document
- Mid: artifacts
- Late: execute log like build page; evidence like health; merge like takeover; hygiene like teardown-in-progress (`deleting`)

---

## 16. Workflow comparison table

| Openship ops workflow | Foundry factory walk |
|---|---|
| New project / import | Intake |
| Detect stack | Research |
| Config / env | Grill + Spec |
| Trigger deploy | Plan pack approved → Execute |
| Build log `/build/:id` | Stage panel + event log |
| action_required (port, routing, keep/reject) | Gate |
| Ready on domain | Merge PR |
| Monitoring / health | Evidence |
| Pause / delete | Hygiene / skip |
| Global deployments page | Optional later; v1 is per-Issue |
| System `/issues` | Gate inbox, never named Issue |
| Jobs cron | Workers; no rail item |
| Audit log | Event log |
| UpdateCenter | Stale/fail banner |

The **order** of Openship’s pipeline (detect, build, run, route) is not the order of Foundry stages. Do not reorder the Walk to match CI. Map concerns, keep the lock.

---

## 17. Anti-patterns observed (steal the lesson)

1. **Denylist of bad statuses** → missed new failure verbs. Use allowlist.
2. **Status from live row only** → blocked newest deploy vanished. Include latest.
3. **Paused still Live** → derive from operator switch too.
4. **POST start on every refresh** → empty terminal. Attach.
5. **Nav counts before org resolved** → wrong tally. Gate on scope.
6. **Duplicate local+cloud rows** → distinct by id.
7. **Notification badge on Issues** → they refused; so should we.
8. **Billing above Servers** on a box you own → last among settings.
9. **Audit inside Settings** → unread. Promote read surfaces.
10. **Ten tabs as ten rail rows before setup** → one setup item.
11. **Lifetime success %** → nobody acts. Show current operational truth.
12. **Alert + two furniture cards** → ladder.
13. **Client-resolved product view** → rail flash. Server-resolve.
14. **Stale active org** → UI scoped to a workspace you are not in. Reconcile membership.
15. **Cached migration flag** → wrong launcher. Skip cache on boot gates.
16. **Third bottom nav** → do not.
17. **Gradient CTA** → do not, theme lock.
18. **Hiding attention without expiry** → would bury new faults. If hide, bind to id set.
19. **Page decides “all fine” because a filter hid rows** — IssuesView forbids this.
20. **Routing failure failing the deploy** — they split optional from ship. Foundry: split optional nags from Gates.

---

## 18. Density details worth copying verbatim (structure only)

### 18.1 Rail item class (semantic)

Inactive: muted text, hover `bg-foreground/[0.04]`.  
Active: `bg-foreground/[0.07]` text-foreground.  
Foundry: `hover:border-neutral-500` on cards today; after shell, use **fill**, not thicker border, for the selected rail item. Issue list can keep a border.

### 18.2 Open/resolved switch

`inline-flex items-center gap-1 rounded-xl bg-muted/35 p-1`  
Active child: `h-8 rounded-lg px-3.5 text-[12px] border border-border/60 bg-card`

Use for: Home “Waiting / All”, Grill “Unanswered / Answered”, Deployments-like stage filters if any.

### 18.3 Search field

`h-10 rounded-xl border … ps-10` with search icon `start-3.5`. Foundry radius 0.625rem → `rounded-md` is closer than `rounded-xl`. Prefer Foundry radius.

### 18.4 Icon stroke

Lucide `strokeWidth={1.7}` at 17–18px. Matches Geist. Steal.

### 18.5 Tabular numbers

Counts and durations: `tabular-nums`. Event log timestamps too.

### 18.6 Skeleton

Never a page-level spinner if the list geometry is known. Four rows of 40px square + two lines.

---

## 19. Copy and language

Openship i18n is large (`t.dashboard.nav`, `t.projects.status`, …). Foundry copy lives in `lib/foundry/copy.ts` and CONTEXT.md.

Do not import Openship strings. Translate:

| Openship | Foundry |
|---|---|
| Project | Issue |
| Deployment | Walk drop / stage run |
| Building | Researching / Working |
| Live | Done (stage) |
| Action required | Waiting on you / Gate |
| Attention | Blocked |
| Draft | Intake incomplete |
| Operational | Nothing waiting |
| View all | All issues |
| New project | (intake) |
| Logs | Event log |
| Rollback | (none in v1) |
| Issues (system) | Needs you |

Never “ticket” except Decision ticket.

---

## 20. What a fork would destroy (do not)

Forking Openship into Foundry would import: Postgres, Redis, orgs, billing, mail, edge, GitHub App, cloud handoff, i18n of nine locales, Electron desktop, compose mode.

Locks forbid that. Steal UX patterns into Next 16 + eve + SQLite.

Integrate points (pattern only):

- Shell layout → `app/_components/app-shell.tsx`
- Nav data → beside sidebar
- Home grid → `app/page.tsx`
- Identity + strip → `stage-hero.tsx`, `walk-strip.tsx`
- Live job → research/walk panels
- Attention → Home side column or hero banner
- Status algebra → keep `types.ts` unions; do not import `ProjectStatus`

---

## 21. README “coming next” vs Foundry

Openship coming next: multi-node, load-balancing UI, private networking, advanced monitoring, visual CI/CD pipelines.

Foundry coming next (this tree): Grill through Hygiene on the operator surface, verified live.

A visual CI pipeline UI is tempting for the Walk. **Do not** turn WalkStrip into a flowchart. Openship themselves still use a list + live log, not a node graph. Foundry already deleted `issue-graph.tsx` in this working tree. Keep the strip.

---

## 22. Desktop vs web

Same dashboard UI. Desktop adds: SSH tunnel “Open localhost”, native updater in UpdateCenter, `desktop.reset` instead of logout.

Foundry is web on the VPS. Do not add Electron. Do not add tunnel buttons. The “stay on the page while it works” rule still holds.

---

## 23. MCP note (do not expand scope)

Openship MCP: opted-in routes, permission re-check, credentials never tools.

Foundry workers are eve tools, not dashboard MCP. No steal required. If a command menu lists “retry research”, that is a server action, not an MCP exposure.

---

## 24. File-level index (for later readers)

| Path in clone | Why it matters |
|---|---|
| `README.md` | Pipeline, interfaces, action-required routing |
| `apps/dashboard/src/app/(dashboard)/layout.tsx` | Shell, boot gates, server product view |
| `apps/dashboard/src/components/sidebar.tsx` | Density, CTA, identity, collapse |
| `apps/dashboard/src/lib/sidebar-nav.ts` | IA, order, mail collapse, active rules |
| `apps/dashboard/src/lib/sidebar-nav-counts.ts` | Count invalidation |
| `apps/dashboard/src/lib/deploy-nav.ts` | Trigger → live screen |
| `apps/dashboard/src/app/(dashboard)/DashboardHomeClient.tsx` | Home ops layout, attention ladder |
| `apps/dashboard/src/hooks/useAttentionFeed.ts` | Broken vs behind |
| `apps/dashboard/src/components/overview/SystemStatusRow.tsx` | Operational roll-up |
| `apps/dashboard/src/components/ui/PageContainer.tsx` | Page width |
| `apps/dashboard/src/app/(dashboard)/projects/page.tsx` | Grid/list, filters, localStorage view |
| `apps/dashboard/src/app/(dashboard)/projects/components/ProjectCard.tsx` | Row density |
| `apps/dashboard/src/app/(dashboard)/projects/[id]/components/ProjectSidebar.tsx` | Entity nav, attention dot |
| `apps/dashboard/src/app/(dashboard)/deployments/components/*` | Ship list |
| `apps/dashboard/src/app/(dashboard)/(deployment)/build/[id]/page.tsx` | Live ship |
| `apps/dashboard/src/app/(dashboard)/jobs/page.tsx` | Facets, last run |
| `apps/dashboard/src/app/(dashboard)/issues/IssuesView.tsx` | Honest empty, reattach fix |
| `apps/dashboard/src/utils/project-status.ts` | Status algebra |
| `apps/dashboard/src/components/updates/UpdateCenter.tsx` | Idle-zero banner |
| `packages/ui/src/components/status-dot.tsx` | Dot language (recolor) |
| `docs/monitoring.md` | Edge vs control plane (event log philosophy) |

---

## 25. Recommended Foundry information architecture (post-chrome)

```
/                         Home: intake + Issue list + optional Needs-you column
/issues/[id]              Hero + Walk strip + one panel
  panels by stage         research | grill | spec | mid | late
```

Rail:

```
Foundry
  Home
────────────────
  (footer: local data, no theme toggle)
```

Issue inner (not rail):

```
[Intake] [Research] [Grill] … [Hygiene]
              ^ strip, twelve always visible, skipped muted
```

That is Openship’s **projects list + project tabs**, renamed to factory walk, without deployments/apps/servers.

---

## 26. Steal-list (checklist for synthesis 1.1.6)

Repeat of §0, one line each, for the synthesis leaf.

1. Sectioned rail, testable nav data  
2. Exact `/` active rule  
3. No notification badges on health/Issue  
4. Counts tabular, hide at 0  
5. Idle-zero top banner  
6. Home list + 340px attention column  
7. Attention ladder (alerts eat furniture)  
8. Operational line ≠ issue rows  
9. Broken vs advisory  
10. Allowlist healthy  
11. Paused/skipped muted  
12. Named attention reasons  
13. Tab warning dots for optional faults  
14. Optional fault ≠ failed ship / ≠ failed Walk  
15. Trigger → stay on live surface  
16. Attach to running job; no re-POST  
17. Facets from unfiltered list  
18. Pill status switch geometry  
19. Row: glyph, name, chips, status  
20. Stretched link + kebab z-index  
21. Entity identity card + inner nav  
22. Mobile horizontal tabs only (no third bar)  
23. PageContainer width + padding  
24. Title/subtitle type  
25. Last-run + duration on work rows  
26. Audit/event log not in Settings  
27. Collapse nav until the subsystem exists  
28. Quiet shortcut cards, if any  
29. Skeletons match rows  
30. Server-first rail/mode  
31. Local identity ≠ linked cloud  
32. Per-service (per-substep) chips inside a stage  
33. Reattach in-flight fix/job on refresh  
34. Empty means empty  
35. Walk strip, not a graph, not twelve rail items  

---

## 27. Explicit non-goals

- Openship colors, gradients, light/dim themes  
- Fork of the monorepo  
- Mail product view  
- Billing, orgs, SaaS  
- Global deployments board in v1  
- Naming Foundry work “projects”  
- Naming system health “Issues”  
- Green Live badges  
- Command palette copied from here (it does not exist)  
- Visual CI node graph  
- Electron  
- Postgres  

---

## 28. Closing

Openship’s dashboard is a **shipping ops** workplace: a stable rail, a dense list of running things, a sticky column that yields to faults, a live log for the ship in flight, and a status algebra that would rather nag a named tab than lie that you are Live.

Foundry’s dashboard should feel like that workplace for a **factory walk**: same density and nav discipline, Foundry black, CONTEXT.md nouns, twelve stages in a strip, Gates as the only hard stops, SQLite as the record.

Steal layout, density, nav, and the ops workflow. Do not steal the palette. Do not steal the PaaS.

---

## 29. Appendix A — WalkStrip geometry proposal (for 1.3.3)

Current:

```
ol.flex.flex-wrap gap-x-3 gap-y-1 text-xs
  li.stageTone  Label  [· now]
```

Proposed (Openship-informed, Foundry-colored):

- `flex flex-wrap gap-1` (tighter)
- Each stage: `rounded-md px-2 py-1 text-[11px]`
- active: `bg-card text-foreground` (Foundry card token)
- blocked: `text-amber-200` + optional 6px `bg-amber-200` dot
- done: `text-neutral-400`
- pending/skipped: `text-neutral-600`
- Do not use Openship `rounded-xl` pills for twelve items — too much chrome
- Clicking a `done` stage may later scroll to a read-only artifact; v1 can be non-clickable
- Current stage is the hero; the strip is status, matching `gates/leaf-1.3.3-issue-frame.md`

---

## 30. Appendix B — Home Issue row proposal (for 1.3.2)

Current: bordered block, status `text-sm text-neutral-500`, idea below.

Proposed:

- Same border (Foundry already uses `border-neutral-800`)
- Inner: `flex items-center gap-4 px-4 py-3`
- No 40px framework glyph (Foundry has no stack icon). Use a 6px status dot + stage label
- Idea `text-sm font-medium truncate`
- Right: Size chip + relative time
- Whole row is the link
- If grill waiting: status line “Waiting on you” stays first (copy.ts)

---

## 31. Appendix C — Stage panel header proposal (for 1.4)

Match Openship page headers inside the panel:

- `h2 text-2xl font-medium` only on the Issue hero, not again on the panel
- Panel: `h2 text-[15px] font-semibold` + one muted line (job state / duration)
- Failed: destructive border already used on ResearchFailed — keep
- Running: spinner + copy; add a mono event tail when JSONL exists
- Primary actions: Foundry `primary` (near-white on black), not orange gradient

---

## 32. Appendix D — Gate wall (grill/plan/phase/evidence)

Openship CloudConnectionGate covers every tab the same way.

Foundry Gate wall:

- Same card chrome on all four kinds
- Title = Gate kind in human words (from copy, not raw `plan_pack`)
- Body = what is blocked
- Actions = answer / approve / retry
- Worker does not continue until the operator acts (CONTEXT.md)

Openship keep/reject is a two-button decision. Grill is N Decision tickets. Layout: list like IssuesView (search only if rounds are huge), not a keep/reject pair.

---

## 33. Appendix E — Event log vs UpdateCenter

UpdateCenter: platform-wide, idle zero.  
Event log: per Issue, append-only JSONL.

Do not mix. A worker tool call is not an advisory. A stale job may use the **banner slot** (UpdateCenter analog) because it is about the operator’s current session, then point at the Issue.

---

## 34. Appendix F — Product-view lesson for a single-view app

Openship spends a lot of code making mail vs platform rails agree. Foundry has one view. The lesson is still: **one function decides IA**, the layout and the page both call it (or receive it from the server). Do not let `page.tsx` and `sidebar.tsx` diverge on what Home is.

---

## 35. Appendix G — Self-hosted vs cloud gating

Many Openship pages no-op on cloud (jobs, rescan, servers). Foundry is always “self-hosted” in the sense of local SQLite. Do not add `selfHosted` branches. Do add **job present vs absent** branches.

---

## 36. Appendix H — Library / Apps (do not steal destinations)

Library is the catalog of what you can deploy. Apps are catalog installs (`isApp`). They get their own rail item so Projects stays “real projects.”

Foundry has no catalog. Intake *is* the only create path. Do not add Apps.

---

## 37. Appendix I — HelpMenu

Projects page includes `HelpMenu`. Not studied in depth. Foundry: CONTEXT.md is law; a Help menu that duplicates README is noise. Skip.

---

## 38. Appendix J — i18n

Openship translates nav labels and status pills. Foundry v1 is English. Keep copy.ts. Structure keys the way they do (`STAGE_LABEL` map) so a later locale cannot skip a stage.

---

## 39. Appendix K — Testing they bothered to write

- `sidebar-nav.test.ts` — nav as data  
- `project-status.test.ts` — blocked deploy needs attention; failed latest is never Live; paused  

Foundry: `scripts/check-walk.ts` is the analog. UI tests are later. The *algebra* of status belongs next to `types.ts` / `gateFor`, already exhaustive.

---

## 40. Appendix L — Final mapping sentence

Openship teaches Foundry how an operator **watches a ship**: dense lists, a rail that does not lie about where you are, a column that shuts up when something is on fire, a live log you attach to, and statuses that name the next human move. The factory walk is that ship, twelve holds, four docks (Gates). Build the dashboard like the ops console. Keep the paint black.
