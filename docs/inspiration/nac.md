# NAC (arcee-ai/nac) — Foundry inspiration notes

Leaf 1.1.4 of the unlazy tree-7 rebuild. Source clone: `/tmp/foundry-inspiration/nac` (upstream https://github.com/arcee-ai/nac). Apache 2.0. This note is layout/IA only. **No product code** was changed in this leaf.

**Theme lock.** Steal layout, information architecture, density, and operator loops. Do **not** adopt NAC colors, Figma `HeaderSurface` gradients, `--blue-500` drop slots, light-mode tokens, or the Arcee elevation ladder. Foundry keeps black, Geist / Geist Mono, and `app/globals.css` tokens (`bg-black`, `text-neutral-100`, `border-neutral-800`). A fork of NAC’s React tree is allowed only if those tokens are stripped and remapped.

**Five-product eligibility.** Foundry may **fork or integrate Warren, Plane, Roomote, NAC, and Openship** — not Plane-only. NAC is the strongest substrate for **agent session UX**: live run, thread DAG, workspace inspector, and sandbox isolation. It is **not** the Issue tracker. Plane/Warren remain stronger for list density and HITL queues. Roomote is stronger for remote-job status. Openship is stronger for ops pipelines. Combine; do not replace the factory Walk.

Locked Foundry model this leaf must not delete: SQLite Issue tracker, Issue as the unit of work, Walk stages, Gates, Grill Decision tickets, eve/GLM workers, sandbox as Docker checkout of the **target** repo, Event log JSONL, GitHub on the target only for PRs.

---

## 1. What NAC is (product, not palette)

NAC is an **open-source agent harness for long, ambitious tasks** — experiments, training runs, infrastructure, prototyping that must stay aligned with original intent. The README states a **thread-and-episode architecture** inspired by slate (https://randomlabs.ai/blog/slate): a **central orchestrator plans and decomposes work but cannot execute commands or edit files**. It only **launches threads**. Threads return **episodes** — structured summaries of what they accomplished. Further inspiration: nanocode and pi.

The operator surface is **`nac-web`**: a local dashboard (default `http://127.0.0.1:3210/`) plus a Rust HTTP API. Install puts `nac-web` on `$HOME/.local/bin`. Auth is separate from the UI: Arcee device-code, ChatGPT Codex OAuth, or catalog provider API keys. The dashboard is the place you **launch sessions, watch the orchestrator chat, inspect worker threads, browse the worktree, and manage MCP / model / SSH configs**.

Foundry mapping: NAC’s “session” is closer to **one live agent run against a workspace** than to an **Issue**. Foundry’s Issue is durable factory record with a Walk. NAC’s session is an orchestrator conversation with disposable (or worktree-isolated) execution. Steal the **session screen pattern** for Grill + later implementation stages; keep Issue list + Walk as the spine.

---

## 2. Repo / app structure

Workspace (`Cargo.toml`): three crates.

| Crate | Role |
| --- | --- |
| `crates/nac-core` | Sessions, SQLite store, tools, sandbox (Podman/SSH), skills, MCP, model clients, workspace/git revisions, worker dispatch |
| `crates/nac-server` | `nac-web` binary: HTTP + SSE + embedded Vite React app under `crates/nac-server/web` |
| `crates/nac-catalog-gen` | Model catalog generation |

**Core module map** (`nac-core/src/lib.rs`): `session_service`, `sessions`, `store`, `runtime`, `sandbox`, `skills`, `model`, `tools` (read/write/edit/grep/glob/exec_command/thread/workset), `workspace`, `upgrade`, `view`. Named reusable **model configurations**, **SSH configurations**, and **MCP server configurations** are first-class — the dashboard edits `config.toml` for MCP; sessions parse it when a worker launches.

**Web app** is Vite + React 19 + React Router **HashRouter** + TanStack Query. Hash routing is explicit: `nac-web` only serves `/` and `/app`; deep links must not require a server catch-all. Query cache is tuned for SSE: `staleTime` 30s, `refetchOnWindowFocus: false` — REST covers the gap until the first stream event.

Web layout:

```
crates/nac-server/web/src/
  main.tsx          HashRouter, QueryClient, ThemeProvider
  App.tsx           Routes + ToastProvider + SessionActionsProvider
  app/
    lib/routes.ts   URL scheme, SESSION_PANELS
    components/
      AppShell.tsx  fixed TopBar + Outlet
      TopBar.tsx    logo, breadcrumbs, session actions, MCP, header menu
      pages/        SessionsListPage, SessionPage, DesignPreviewPage
      sessions/     SessionCard, SessionFilters, SessionsEmptyState
      inspector/    Transcript, ChatInputBox, SessionSideBox, Threads/Files/Worksets/History
      modals/       Launch, Configurations, MCP, SSH, PathPicker, Revert, Rename, Delete
    store/          sessionLayout, sessionFilters, runtime, attention, composer, sshConnection
    services/       api.ts, queries.ts, eventStream.ts, sessionRefresh.ts
    providers/      Theme, Toast, SessionActions
    atoms/          design-system primitives (do not fork colors)
```

**Pattern for Foundry:** keep Next.js App Router (not HashRouter). Steal the **split of “shell chrome vs page-owned scroll”** and the **provider that owns launch/rename/delete/stop** so list cards and issue headers share one action set.

---

## 3. Routes (IA)

From `app/lib/routes.ts` and `App.tsx`:

| Path | Screen | Notes |
| --- | --- | --- |
| `/` | Sessions list (dashboard) | Primary home |
| `/session/:sessionId` | Redirects to default panel `threads` | Canonical session URL always includes a panel |
| `/session/:sessionId/:panel` | Session: chat always on; URL selects side-box tab | Panels: `threads`, `files`, `worksets`, `history` |
| `/design` | Design preview (atom playground) | Outside AppShell |
| `*` | Navigate to `/` | |

**Session panels.** Order is tab order. Labels: Threads, Files, Worksets, History. The Files panel is **Changes** in the design; the route keeps `files` so old links still land. **Wide layouts omit History as a tab** — revisions live in the side-box **footer chip**. History is a **phone-only** bottom-bar panel.

**URL vs store.** The URL selects which **panel** is open. Collapse/expand of the side box, selected thread/file/workset/revision, folder toggles, and file listing mode (`tree` vs `changed`) live in `sessionLayoutStore` — “viewing preferences, not locations.”

**Top bar reads session id from the path** because it sits in the layout route above `:sessionId`. Helper: `sessionIdFromPath`.

**Foundry route mapping (steal IA, keep names):**

| NAC | Foundry |
| --- | --- |
| `/` session list | `/` Issue list + intake |
| `/session/:id/threads` | `/issues/:id` with a **worker / threads** inspector tab |
| `/session/:id/files` | Issue **sandbox / diff** tab (when Docker sandbox exists) |
| `/session/:id/worksets` | Walk + Decision tickets / plan items — not a second tracker |
| `/session/:id/history` | Event log + workspace revisions; phone-only extra tab if split is tight |
| Configurations / MCP / SSH modals | Settings, not first-class routes |

Do not invent `/session`. Foundry’s noun is **Issue**. If a later stage needs a live agent pane, nest it under `/issues/:id` with a query or segment for inspector tab (`?panel=threads` or `/issues/:id/threads`) — same **chat-always-visible, URL-selects-inspector** pattern.

---

## 4. Dashboard: sessions list

`SessionsListPage` is the operator home. Layout:

**Desktop**

- Fixed **TopBar** (logo → all sessions, breadcrumbs, header menu).
- Left **rail** `360px`: `BoxSurface` titled with session count (`N sessions`) + **New** primary button; body is `SessionFilters` (search, env chips, provider chips, created/modified range, sort).
- Main column: **card grid** `minmax(360px, 1fr)` — three-up at ~1520px reference; extra columns on wider viewports instead of empty space. Padding `pt-16` clears the bar.
- **Pinned** group then **unpinned** group. Pin is a first-class presentation field, not a filter.

**Phone**

- No filter rail. Search is a **fixed bar under the header** (`top-16`). Filters open as a **full-screen Modal** that **closes as soon as one filter changes** so results are visible without a second tap.
- **New session** is a round primary in the TopBar (no rail to hang it on).
- Single-column cards; extra top padding (`pt-36`) for search.

**Empty vs filtered-empty**

- Zero sessions ever: `SessionsEmptyState` (start CTA).
- Sessions exist but filters match none: muted “No sessions match the current filters.”
- Fetch error: inline message + **Try again**.

**Session card density** (`SessionCard`)

Each card is a full-bleed interactive surface (NAC tokens — do not copy colors). Content pattern:

- Avatar + title (`displaySessionTitle`).
- Provenance row: **env label** (local / SSH / sandbox) + **provider** label.
- Metrics: **cost** (micro-USD formatted) if known, **run count**.
- If running: **elapsed clock** ticking every 1s (`useNow`).
- Actions (shared via `SessionActionsProvider`): pin, rename, delete, **stop run**.
- **Attention dot**: run finished while you were elsewhere (`attentionStore`). Cleared on open.
- Default sort: **drag handle** (two vertical bars) on desktop; **move up/down** on mobile. Custom sorts hide reorder.

**Reorder IA**

- Pointer-driven (not HTML5 DnD — source re-renders cancelled native drag).
- Drop slots: empty outlined insertion before/after a card.
- Empty pin zone: dashed slot when dragging an unpinned card and pinned group is empty.
- Reorder only in **default sort**; otherwise cards are not handles.

**Keyboard**

- New session: `⌘⇧O` / `Ctrl+Shift+O` — not `⌘N`, which the browser keeps.

**Foundry dashboard steal**

Today Foundry `/` is a **max-w-xl column**: intake + a vertical list of Issues (status line + idea). That is honest for v1 intake, but it does not scale to many live Walks.

Steal from NAC list:

1. **Shell + rail + grid** (or dense list) instead of a single centered column once Issues are numerous.
2. **Count in the rail title** + primary **New** next to filters, not only at the top of the page.
3. **Pin / attention / running clock** on Issue cards: research running, Grill waiting, worker running.
4. **Shared session (Issue) actions provider**: retry research, skip stage, stop worker — same from list and detail.
5. **Filter rail** by stage, Size, gate-blocked, failed job — analog of NAC env/provider chips.
6. **Empty vs no-match** distinction.

Do not steal: 360px card min if Foundry Issues are better as **dense rows** (Plane/Warren). NAC’s card is right for **long-running agent sessions**; Foundry Issues may stay row-like with NAC’s **attention + clock + pin** grafted on.

---

## 5. App shell and global chrome

`AppShell`: `h-screen flex flex-col`; TopBar; `main.flex-1.min-h-0`. **One scrolling region owned by the active page.** The bar is `fixed`; pages pad themselves (`pt-16` list, `pt-[72px]` session side box).

**TopBar composition (left → right)**

- Logo link to list (`aria-label="All sessions"`). Mark-only on tablet/phone.
- `Breadcrumbs`: list label + current session title. Phone: no trail; session title **is** the back control.
- `SessionHeaderActions` (inspector-only: stop, settings, etc.).
- `McpServersButton` → MCP modal.
- `HeaderMenu`: store path (copy), docs, repo, **Configurations**, **SSH configs**.

**Header surface (do not copy).** NAC stacks a ground-to-transparent gradient twice so content scrolling under the bar fades. Foundry: keep a **solid black bar** or a thin `border-neutral-800` rule. Steal the **overhang + padding contract**, not the fade.

**Modals as app-level, not routes.** Configurations, MCP, SSH, Launch, Rename, Delete, Settings, Path picker, Revert. The operator never loses the session URL to open settings.

**Foundry:** `app/layout.tsx` already wraps Geist + TooltipProvider. Add a **Foundry TopBar** (wordmark → `/`, Issue title on `/issues/:id`, overflow for store path / docs) without NAC’s light/dark theme toggle as a product requirement. Theme stays locked dark.

---

## 6. Agent / session screen (the money layout)

Comment in `SessionPage`: **“the Files/Worksets/Threads box beside a permanent chat.”**

### 6.1 Split

**Desktop**

- Left **half** is the side box, **pinned absolutely at 50% width** and translated off-screen when collapsed. A spacer `w-1/2` or `w-0` yields space to the chat **without reflowing the box tree during the 150ms slide**.
- Right: **Transcript** (full height) + **ChatInputBox** absolutely bottom, `max-w-[840px]` centered.
- Collapsed: chat full width; a **ghost “Show panel”** button sits where the box header was (`left-2 top-[77px]`).

**Expand:** side box lifts into a **chromeless fullscreen Modal** (`keepOnNavigate` so tab changes do not close it).

**Phone**

- Chat is the whole screen. Side box is a **Modal** whose title is the **selected row** (thread name / file basename / workset id / History), not the panel name when a row is open.
- Files title carries **+/- badge** for the current file.
- `MobileBottomBar`: floating pill with four tabs (Threads / Files / Worksets / History), icon + micro label, 16px-tall items, `rounded-[18px]`.
- Composer paints its own ground fade and bleeds past column inset (`-mx-2`). Foundry: solid black composer, same **float-over-transcript** geometry.

### 6.2 Side box chrome (`SessionSideBox`)

Wide box: `rounded-[8px] overflow-hidden border` (map to `border-neutral-800`), header **horizontal tabs** (`WIDE_SESSION_PANELS`: threads, files, worksets) + collapse + expand controls.

**Footer chips (wide only):** repo label, **BranchPicker**, **RevisionPicker**, live **+additions / -deletions**. This is how History is omitted as a tab.

**Panel bodies** all use `PanelSplit`: **list of rows | detail of selection**. Below desktop, list and detail do not sit side by side: open on the selected row; list via a list button (dialog on phone, column swap on tablet). List width is user-draggable (`usePanelListWidth`).

**Foundry layout steal:** Issue detail today is a **single max-w-xl column** (idea, research brief, `WalkStrip`, skip-stage). That is Grill-document density. When workers run, Foundry needs NAC’s **permanent conversation + inspector half**. Propose:

```
[ TopBar: Foundry · Issue title · gate status ]
[ WalkStrip full width, compact ]
[ Inspector 50% | Transcript + composer 50% ]
```

WalkStrip stays **above** the split (factory spine). Inspector tabs: **Walk / Threads (workers) / Files (sandbox) / Log**. Do not name them Worksets unless the product later stores NAC-style workset records; map worksets onto **Walk stages + Decision tickets**.

### 6.3 Transcript (agent UX)

`Transcript` is **read-only canonical snapshot + live typing from SSE runtime store**. Stick-to-bottom unless the operator scrolls up (`useStickToBottom`). Older messages paginate (`useLoadOlderMessages`).

Turn kinds: user bubbles, model messages (markdown, tool markup, thread dispatch cards), recovery notice, error notice with repair action.

**ThreadWave / ThreadBox:** when the orchestrator dispatches `thread` tool calls, the chat shows **cards per thread**: name, state icon (running loader, pending, error, cancelled, done), **tail of latest log line**. Clicking a card **focuses the Threads panel** and selects that thread (`onFocusPanel("threads")`). Waves (DAG levels from partitioned thread calls) rank later waves higher in the Threads list.

**Cross-panel pointing** is a core pattern: chat is not a dead log. Mentions of files / worksets / threads **drive the inspector**. Foundry Event log + research brief should similarly **deep-link into Walk stage, Decision ticket, or sandbox file**.

**InitialPrompts:** empty session shows four starter cards that **send the prompt as written** (Explore repo, Review changes, Find improvement, Help me get started). Foundry analog: empty Issue after intake could offer **research-already-started** instead of chat starters; at Grill, offer **answer this Decision ticket** cards — same “card is the payload” pattern.

**Resend:** action sits on the **newest user bubble**, including a prompt that failed before a reply. Regenerating is a first-class run (`useRegenerateRun`).

**Revert:** `RevertModal` ties transcript turns to **workspace revisions** (`revisionsByTurn`). Operator can roll the tree back. Foundry analog: Gate “reject this stage output” + Event log bookmark — not git-revert of the operator’s laptop.

### 6.4 Composer (`ChatInputBox`)

Permanent bottom field. Placeholder “Ask anything…”; if prompt history exists, “…or press ↑ for an earlier prompt.”

Growth: one row 40px mobile / 48px wide; max 128 / 200px then scroll.

**Slash commands:** if the field is only `/prefix`, query definitions from the server; submit maps to a named command with optional arguments.

**Stat row under / beside the field:** model picker, env badge (SSH reconnect), **context gauge** (`6.8K / 200K`, `est.` when window is guessed), **token + cost** for the active run, elapsed clock, stop, compact-session.

**Light vs heavy:** launch can attach a cheaper **light worker model**. Orchestrator `thread` tool then requires `weight: light | heavy`. Foundry: GLM 5.2 workers are locked; do not copy multi-provider picker as a v1 requirement. Steal the **gauge + stop + env badge** cluster.

**Optimistic user prompt** in `runtimeStore` so the bubble appears before snapshot refresh.

### 6.5 Threads inspector (`ThreadsView`)

List grouped **pending / running / done**. Pending placeholder thread if the stream named a thread the store has not written yet — **clicking a chat card never lands on the wrong first thread**.

Detail: episode list + **live tool log**. Tool lines: `▸ toolName: keyArg`; result `✓` / `✕` on the glyph only (failure text stays readable, not a full red line). Pending tools **shimmer** while the thread is running. Standalone worker stdout as tertiary code.

`ThreadLogTail` on chat cards vs full log in the panel. Height hook `useThreadLogHeight`.

**Foundry:** map thread rows to **eve worker jobs** (research, grill, implement). Episode = one job completion summary written to the Event log. Orchestrator-cannot-edit-files is a **safety pattern** Foundry should keep: dashboard/orchestrator plans; sandbox workers mutate.

### 6.6 Files inspector (`FilesView`)

Git-aware workspace: changed files with additions/deletions, full tree or changes-only listing, syntax highlight + **diff highlight**, `CommitPopover`, live workspace hook (`useLiveWorkspace`). Markdown in chat can **open a path in the Files panel** (`workspaceLink`) without HashRouter swallowing the click.

Footer revision picker shows that revision’s totals, not live totals.

**Foundry:** when sandbox exists, this is the **Issue sandbox diff**. Until then, skip Files tab rather than fake a host checkout. NAC’s isolation story (throwaway worktree) is closer to Foundry’s **Sandbox** noun than to editing the Foundry repo itself.

### 6.7 Worksets inspector (`WorksetsView`)

Durable **high-level plan** the orchestrator writes via `workset_define`:

- Workset: `id`, `goal`, `status`, `summary`, optional `verification_recipe`.
- Items: `title`, `scope` (ownership boundary), `description`, `role` (research / implementation / verification / cleanup / coordination), `depends_on`, `acceptance`, `notes`.

UI: list of worksets; detail shows goal, status tone, items as cards with role badge, scope in mono, acceptance field, dependency list.

Slash `/run <workset>` is mentioned in the tool schema — operator can drive a named plan.

**Foundry mapping (important):** Worksets look like a second Issue tracker. **Do not fork them as Issues.** Map:

| NAC workset field | Foundry |
| --- | --- |
| workset.id / goal | Issue idea + research brief |
| workset.status | Walk current stage + gate |
| workset_items | Walk stages and/or Decision tickets |
| role: research | research stage |
| role: verification | Grill / later verify |
| acceptance | Gate criteria |
| verification_recipe | Event log + tests the worker must run |
| depends_on | serial Walk; collapse may SKIP |

Steal the **inspector rendering** (goal, status tone, item cards with acceptance) for Grill Decision tickets and for a richer WalkStrip.

### 6.8 History inspector (`HistoryView`)

Newest-first revisions + **Working tree** row at top (“files as they are right now”). Phone-only as a tab; desktop uses footer chip.

**Foundry:** Event log JSONL listing + optional sandbox snapshots. Same “live vs historical” toggle.

---

## 7. Launch flow (creating work)

`LaunchModal` is remounted every open so defaults reset. Modes:

| Mode | Copy | Foundry analog |
| --- | --- | --- |
| Local | Runs on this machine with access to local files | **Forbidden for target mutations** — Foundry sandbox is Docker, not live laptop |
| SSH | Runs on a connected remote machine | Optional later; Roomote is the better remote-job UX donor |
| Sandbox | Isolated environment, limited access | **Foundry Sandbox** (Docker, not NAC’s Podman) |

SSH form **blocks the rest until a connection answers**. Sandbox probes **Podman availability** while that mode is selected (`useSandboxAvailability`) and shows **phase + elapsed** on first image pull (`useSandboxActivity`).

Sandbox docs (steal policy, not Podman):

- Default mount cwd at `/workspace`.
- If cwd is a git repo: **throwaway worktree** under nac home `worktrees/<session-key>` on branch `nac/<session-key>`, forked from HEAD, **uncommitted host changes invisible**, shared git dir read-only, session objects overlay read-write.
- Worktree removed on session delete; **if the session committed, keep the branch and log the path**.
- Fallback to live mount is **logged as a warning** — operator must not rely on isolation then.
- Symlink / git-dir escape → **refuse launch** rather than expose live checkout.

Foundry already defined Sandbox as **Docker checkout of the target git repo, disposable, Foundry data does not live there**. Steal NAC’s **worktree isolation rules and refuse-unsafe-launch** behavior. Do not steal Podman or `python:3.13-bookworm` as defaults.

Launch also picks **model configuration** (saved named configs), optional **light model**, reasoning effort, compaction, extra headers (cannot override auth headers — see security doc). After create, navigate to `routes.session(id)`.

**Foundry intake** is already a single idea field (`IntakeForm`) → Issue → research. Do not add NAC’s model/SSH form to intake. When implementation stage exists, a **Launch worker into sandbox** modal can reuse NAC’s mode tabs **with only Sandbox enabled**.

---

## 8. Live system: SSE, attention, snapshots

**HTTP:** generated from Rust; live Swagger at `/docs`, OpenAPI at `/openapi.json`. `GET /health` is 200 only if SQLite store opens and session schema queries. 503 otherwise **without exposing store path**. SQLite connections are operation-scoped; max 32 opening/checked-out, max 4 per canonical store.

**Remote bind:** API has **no client authentication**. Loopback default. `--allow-remote` requires explicit ack. Fetch Metadata / Origin guard CSRF; not a substitute for authenticating clients. Foundry on Tailscale `:3100` is closer to NAC’s “private network, no extra login” — keep that; do not copy NAC’s public-bind footguns into docs as a feature.

**SSE** (`eventStream.ts`): custom EventSource wrapper. Retries carry `after_epoch_id` + `after_sequence_id`. Native EventSource retry would reuse a stale URL. Events: `session_event` (sequenced envelope), `assistant_delta` (unsequenced, never replayed — following assistant message is authoritative), `replay_boundary`, `replay_gap`, lagged. Status: idle / connecting / live / reconnecting / error. Broken model config → 400; stop retrying after a few never-open attempts.

**Snapshot** (`SessionFrontendSnapshot`): metadata, messages (paged), recovery warning, active run, active compaction, all session summaries (for switcher), active thread names, thread snapshots, episodes by thread, thread events, steering records, overview, worksets, workspace.

**Attention store:** list poll/stream sees `active_run` fall; if that session is not the open one, flag it. List card shows a dot until open. **Foundry must steal this** for research/Grill/implement finishing while the operator is on another Issue.

**Session switcher** in breadcrumbs: popover of other sessions without dumping you to the list. Foundry: switch Issues from the Issue page.

---

## 9. Agent architecture (steal as factory discipline)

### 9.1 Orchestrator vs workers

Orchestrator tools include `thread`, `threads`, `thread_read`, thread delete, `workset_define` / read / update. **Workers** get file/exec tools. Orchestrator **does not exec or edit**. Skills: orchestrator passes `skills[]` on dispatch; **workers cannot activate skills** (no `activate_skill`, no catalog in worker prompt). Preload is a system message: “The orchestrator preloaded this skill for this worker dispatch.”

Thread dispatch schema: `name` (create or reuse), `action` (task), optional `threads[]` (load latest retained episodes from others), `timeout` (default 3600s, min 1800s), optional `weight`, optional `skills`.

**Foundry:** eve host / dashboard is the orchestrator. GLM workers in Docker are threads. Research stage already approximates one worker episode (brief on disk). Grill should be **human episodes**, not worker exec. Implementation workers must not be callable from a chat that can also `rm -rf` the Foundry SQLite store — isolation is the point of Sandbox.

### 9.2 Episodes

A finished dispatch **commits an episode** (`append_episode`): action + response summary, retained as the thread’s history. Other threads can pull **latest retained episode** by name. This is how long jobs stay aligned without stuffing full tool traces into the orchestrator context.

**Foundry Event log** is append-only JSONL of stage enter, tool calls, tokens, gate actions. Map: **episode ≈ compacted Event log slice + worker summary**. Dashboard should show the episode (readable) and let operators expand raw JSONL (NAC thread log).

### 9.3 AGENTS.md / skills

Hierarchical `AGENTS.md` (override → AGENTS.md → config fallback names), global NAC_HOME then repo root down to workspace. Combined size cap. Orchestrator: separate system message. Workers: appended to system prompt.

Skills discovery order: project `.nac/skills`, `.agents/skills`, `$NAC_HOME/skills`, `~/.agents/skills`. Sandbox/SSH: **user trees only**; project skills not registered. Foundry already has `AGENTS.md` / eve docs — do not copy NAC skill trees into the operator UI as a v1 surface. MCP modal is optional later.

### 9.4 Compaction / steering / slash

Orchestrator compaction threshold on session config; active compaction snapshot in the UI. Thread steering records in the snapshot. Slash commands from server definitions. Steal **compact as an operator action** when transcripts get long; Foundry Grill transcripts will need it.

---

## 10. Density, motion, responsive breakpoints

NAC is **explicit about three widths**: phone, tablet, desktop. Behaviors that change:

- Tab placement (header vs bottom pill vs footer chips).
- List+detail vs list-over-detail.
- Search in rail vs sticky under bar.
- Logo mark-only vs wordmark.
- Composer padding and fade.
- Session card reorder (handle vs arrows).

Motion is short (`150ms ease-out`) and **avoids layout thrash** (absolute side box). Shimmer on running titles and pending tools is the “still alive” signal.

**Foundry:** WalkStrip + Issue header should use the same **three-width honesty**. Do not ship NAC’s tablet modal complexity on day one; do ship **phone: chat/document first, inspector as sheet**.

---

## 11. Mapping onto Foundry surfaces (pattern × layout)

### Home `/` (dashboard)

- **Now:** intake + list, max-w-xl.
- **NAC pattern:** shell, filter rail, countable work, pin, attention, running clock, shared actions.
- **Keep:** “Tell it what to build.” copy, Geist, black, Issue noun.
- **Integrate with other four:** Plane/Warren for row density and project chrome; NAC for **live run affordances** on those rows; Roomote for remote worker badge; Openship for pipeline-stage chips that match Walk.

### Issue `/issues/[id]` (agent + walk)

- **Now:** brief sections, WalkStrip, skip-stage `<details>`.
- **NAC pattern:** permanent human/agent column; inspector for structure; URL-selected tab; SSE stickiness; error notice with retry (Foundry already has `RetryResearch` / `RefreshWhile` — keep those, generalize).
- **Gate analog:** NAC stop/cancel run + revert. Foundry Gate is **harder**: workers must not continue. Composer should **disable send** (or only allow steering comments) while a Gate is open, unlike NAC’s always-on Ask anything.
- **Grill:** Decision tickets as workset items / thread cards that **require operator text**, not worker tools.

### App shell

- **Now:** no top bar; each page repeats “All issues” text link.
- **NAC pattern:** fixed chrome, breadcrumbs, overflow for store path (`data/foundry.sqlite` analog of NAC store path in HeaderMenu).

### Workers

- **Now:** research job in SQLite + eve.
- **NAC pattern:** named threads, episodes, live tool tail, DAG waves in the transcript.
- **Lock:** GLM 5.2 / eve. Do not add NAC’s catalog of DeepSeek/Fireworks/Together as Foundry product UI.

---

## 12. Fork vs integrate (NAC among the five)

**Fork NAC** if Foundry wants a real agent IDE (chat + files + threads) quickly: the web app is a complete operator console. Cost: Rust+Vite vs Next.js; HashRouter; theme system; session≠Issue; Podman sandbox; no Walk/Grill/Gates.

**Integrate (recommended):** keep Foundry Next.js + SQLite Issue tracker. **Copy IA and component shapes**, restyle with globals.css:

- AppShell / TopBar / breadcrumb switcher.
- Issue list rail + attention/pin/clock.
- Issue detail split: WalkStrip + inspector + transcript.
- PanelSplit list|detail.
- SSE cursor retry (when live workers stream).
- Launch-into-sandbox modal (Sandbox-only).
- Workset item card layout for Decision tickets.
- SessionActionsProvider analog.

**Do not fork** NAC’s model catalog UI, Arcee login, Codex OAuth, light/dark ThemeProvider, `/design` atom page, or MCP library picker as blockers for factory v1.

**Combine with the other four (all eligible):**

| Product | What it donates vs NAC |
| --- | --- |
| **Plane** | Issue tracker density, projects/cycles/modules, command menu — NAC has none of this |
| **Warren** | HITL queue, human review of agent output — NAC is autonomous-leaning (“avoid interactive skills”) |
| **Roomote** | Remote agent fleet / machine status — NAC SSH is per-session, not a fleet dashboard |
| **Openship** | Ops pipeline, order/ship workflow chrome — NAC worksets are plans, not shipping ops |
| **NAC** | Session split, threads/episodes, live tool log, sandbox isolation, attention, composer gauges |

If a fork pattern conflicts with a lock, **keep the factory model** and steal only the UX pattern.

---

## 13. Steal-list (layout / IA only)

Numbered so synthesis can cite. Each item is **pattern**, not color.

1. **Chat always on; URL selects inspector panel** (`/session/:id/:panel` → `/issues/:id` + panel).
2. **Wide: inspector tabs in box header; History as footer revision chip. Narrow: bottom pill including History.**
3. **Side box slides at full width (absolute) so the tree does not reflow.**
4. **Collapse inspector to give the transcript the screen; toggle stays where the header was.**
5. **PanelSplit: list | detail; below desktop, detail-first + list overlay.**
6. **Dashboard: filter rail + countable title + primary New in the rail header.**
7. **Card/row: env/stage, provider/worker, cost/tokens optional, run count, live elapsed clock.**
8. **Attention dot when a run finishes off-screen; clear on open.**
9. **Pin group above the rest; pin-drop zone when pinning the first item.**
10. **Shared actions provider (launch/new, rename, delete, stop, pin) for list and header.**
11. **Empty-state vs filtered-empty vs fetch-error+retry.**
12. **New-item shortcut that is not the browser’s New Window.**
13. **Breadcrumb session/Issue switcher without bouncing to the list.**
14. **Settings/MCP/config as modals, not routes that unmount the run.**
15. **Transcript stick-to-bottom with pause-on-scroll-up.**
16. **Chat cards for dispatched workers; click focuses Threads panel.**
17. **Pending placeholder rows so stream names resolve to the clicked thread.**
18. **Tool log: glyph for success/fail; pending shimmer; keep failure stdout readable.**
19. **Initial/empty cards send the full instruction, not a title-only hint.**
20. **Resend on the newest user prompt, including failed-before-reply.**
21. **Composer: slash commands, prompt history via ↑, model/env/context/cost/stop cluster.**
22. **Context gauge with honest `est.` when the window is unknown.**
23. **Launch modal modes; disable Local for Foundry target writes; Sandbox-only for workers.**
24. **Refuse unsafe sandbox launch (symlink/git escape) instead of mounting live.**
25. **Throwaway worktree / Docker checkout; uncommitted host noise stays out.**
26. **SSE with cursor retry; unsequenced deltas vs sequenced events.**
27. **Health check that does not leak store paths.**
28. **Store path visible in an overflow menu (operator can copy `data/foundry.sqlite`).**
29. **Workset item cards (role, scope, acceptance, depends_on) for Decision tickets — not a second tracker.**
30. **Orchestrator cannot exec/edit; workers return episodes; skills preloaded not self-activated.**
31. **Live +/- footer on the inspector; file title badge on phone.**
32. **Markdown / log links open the Files (sandbox) panel instead of navigating away.**
33. **Three-width layout honesty (phone / tablet / desktop) for inspector chrome.**
34. **One page-owned scroll region under a fixed shell.**
35. **HeaderMenu overflow: docs, repo, configurations — keep Foundry copy, not Arcee links.**
36. **Recovery notice when a transcript was repaired.**
37. **Error notice that explains broken config vs fetch failure, with one repair action.**
38. **Mobile filters: change-one-and-dismiss.**
39. **Default-sort-only reorder; don’t fight the user’s chosen sort.**
40. **Gate-aware composer: unlike NAC, block continuation when a Foundry Gate is open.**

---

## 14. Explicitly do not steal

- Color tokens, light mode, `bg-elevation-*`, blue drop outlines, HeaderSurface double gradient.
- HashRouter (Foundry is Next App Router).
- Atom design-system CSS (`atoms.css`, `primitives.css`) as a second theme.
- `/design` preview route in production Foundry.
- Multi-provider catalog as the home of the product.
- Autonomous default (“avoid interactive skills”) — Foundry is HITL; Grill is the point.
- Podman-only sandbox; Foundry lock is Docker.
- Binding `--allow-remote` without Tailscale/auth story.
- Session as the factory record (Issue stays the record).
- Worksets as a parallel Issue database.
- Figma-named components as user-visible vocabulary (Side Box, HeaderSurface). Use Foundry nouns: Issue, Walk, Gate, Sandbox, Event log, Decision ticket.

---

## 15. Concrete Foundry screen recipes

### Recipe A — Issue list (dashboard)

Keep intake at top on empty/small lists. When `listIssues().length` grows:

- `h-screen` shell, TopBar “Foundry”.
- Left rail: “N issues”, filters (stage, Size, blocked Gate, failed), New is the intake shortcut.
- Main: dense rows (Plane/Warren) **plus** NAC attention/clock/pin.
- Status line already exists (`issueListStatus`) — promote it to card metadata like NAC provenance + metrics.

### Recipe B — Issue running research

Keep `RefreshWhile` + spinner copy. Add NAC **elapsed clock** and **stick the running state on the home card** if the operator leaves. Retry stays on the error notice pattern (NAC `toNotice` + Foundry `RetryResearch`).

### Recipe C — Issue after research / Grill

Left: Decision tickets as workset-like cards (question, why it matters, acceptance = “answered”). Right: conversation. Gate: cannot Advance Walk until tickets resolve — **harder than NAC stop button**.

### Recipe D — Implementation (future)

NAC session screen almost verbatim in IA: Threads = workers, Files = sandbox diff, History = Event log + revisions, composer = steering. WalkStrip remains the factory header. Local mode off.

---

## 16. File-level index (for later implementers)

| Concern | NAC files (clone) |
| --- | --- |
| Routes | `web/src/app/lib/routes.ts`, `web/src/App.tsx` |
| Shell | `AppShell.tsx`, `TopBar.tsx`, `Breadcrumbs.tsx`, `HeaderMenu.tsx` |
| Dashboard | `pages/SessionsListPage.tsx`, `sessions/SessionCard.tsx`, `SessionFilters.tsx` |
| Session layout | `pages/SessionPage.tsx`, `store/sessionLayoutStore.ts` |
| Inspector | `SessionSideBox.tsx`, `PanelSplit.tsx`, `ThreadsView.tsx`, `FilesView.tsx`, `WorksetsView.tsx`, `HistoryView.tsx`, `MobileBottomBar.tsx` |
| Agent chat | `Transcript.tsx`, `ChatInputBox.tsx`, `ThreadWave.tsx`, `InitialPrompts.tsx` |
| Live | `services/eventStream.ts`, `hooks/useSessionStream.ts`, `store/runtimeStore.ts`, `store/attentionStore.ts` |
| Launch | `modals/LaunchModal.tsx`, `docs/usage/sandbox.md` |
| Agent core | `nac-core/src/tools/thread/mod.rs`, `tools/workset.rs`, `docs/usage/skills.md`, `docs/usage/agents-md.md` |
| API / security | `docs/api/http.md`, `docs/security/model-requests.md` |

---

## 17. README claims vs UI (trust but verify)

README: thread-and-episode, orchestrator cannot exec/edit, `nac-web` on 3210, Arcee/Codex/API key auth, upgrade command, portable onboarding skill.

UI confirms: sessions list, launch modes including Sandbox (Podman), SSH, local; MCP button; configurations menu; session split with Threads/Files/Worksets; composer stats; attention on cards.

Docs confirm: hierarchical AGENTS.md, skill preload-only, worktree sandbox, unauthenticated HTTP, SQLite health.

Gaps vs Foundry: no Walk, no Gate, no Grill, no Issue tracker, no eve, no Docker sandbox in this clone’s default path.

---

## 18. Synthesis hooks for leaf 1.1.6

When writing `docs/inspiration/synthesis.md`, NAC should appear as:

- **Eligible fork/integrate substrate** (all five: Warren, Plane, Roomote, NAC, Openship).
- **Primary donor for agent session layout** and live-run dashboard affordances.
- **Not** the Issue tracker donor.
- **Theme lock restated:** layout not colors; Foundry black / Geist / `globals.css`.

Steal-list items 1–5, 7–8, 10, 15–18, 23–26, 29–30, 40 are the highest leverage for the factory rebuild.

---

## 19. Operator vocabulary cheat sheet

| NAC says | Foundry says |
| --- | --- |
| Session | Issue (record) + optional live run |
| Run | Worker job / stage execution |
| Thread | Worker (eve/GLM in Sandbox) |
| Episode | Compacted Event log + summary |
| Workset | Walk plan / Decision tickets |
| Files / Changes | Sandbox diff |
| History / revision | Event log + sandbox snapshot |
| Launch | Open Issue / start sandbox worker |
| Attention | “This Issue needs you” |
| Gate (none) | Gate (hard stop) |
| Ask anything | Allowed only when no Gate blocks; Grill is questions, not free chat |

---

## 20. Closing

NAC is a **local agent IDE** with an unusually clear split: orchestrator chat, worker threads, workspace inspector, and isolated execution. Foundry is a **HITL software factory**. The rebuild should look more like NAC **while a worker is running**, and more like Plane/Warren **while the operator is choosing what to build**, and like Warren **when a Gate is up**. Colors stay Foundry. Nouns stay Foundry. All five products remain eligible; NAC is not optional color inspiration — it is a layout donor for the agent half of the app.
