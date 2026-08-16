# Roomote → Foundry (job visibility)

Source: clone `/tmp/foundry-inspiration/roomote` (github.com/RooCodeInc/Roomote), v0.39.1. Read README, `packages/types/src/task-runs.ts`, web IA (`apps/web`), sandbox session UX (`apps/web/src/app/(sandbox)/task/[taskId]`), worker status stream.

Roomote is a **remote coding agent** you assign work to and walk away from. The product is not an IDE plugin. The operator surface is a web dashboard plus chat (Slack / Teams / Telegram / Discord). Each **task** is a durable conversation; each **run** is a sandbox session that boots, works, idles, fails, or sleeps. Foundry is not that product. Foundry is a human-in-the-loop factory whose dashboard is the operator surface for **research** then **grill**. Steal IA, layout, and job-visibility patterns. Do **not** steal Roomote color (lime/chartreuse `--chart-1: #d8fb2b`, oklch green accents, light `:root`). Foundry stays **dark**: `bg-black`, `text-neutral-100`, `border-neutral-800`. Status meaning uses contrast and copy, not brand green.

---

## What Roomote is (mental model)

README pitch: paste a task → isolated sandbox clones the repo → agent writes code, tests, screenshots → opens a PR. No babysitting.

The UI truth is richer. Roomote splits **durable work** from **live process**:

| Layer | Roomote name | Meaning |
| --- | --- | --- |
| Work item | `tasks` | Title, initiator, workflow, surface, visibility. Lives forever. |
| Process | `task_runs` | One sandbox attempt. `RunStatus` plus `taskPhase`. |
| Operator view | `sessionState` | What chrome to show: boot screen vs chat vs history vs boot-fail. |
| Live pulse | `TaskStatusEvent` | Phase, `sessionId`, `isConnected`, `sleepRemainingMs`, `lastErrorMessage`. |

Foundry already has the same split, thinner: **Issue** (durable) vs **IssueJob** (`running` / `failed` on a stage). Research is a remote agent session (`eve` `sessions.create`). Grill will be another job that waits on the human. Roomote’s lesson is that operators cannot infer “is it still working?” from a single boolean.

---

## App structure (IA)

Monorepo: `apps/web` (Next.js operator UI), `apps/worker` (sandbox runtime + tRPC sandbox-server), `packages/types` (shared vocab), `packages/cloud-agents` (launch / workflows).

Web route groups:

- `(authenticated)` — home compose box, `/tasks` list, settings, analytics, background agents. Shell: top banner + **left SideNav** of live/pinned tasks + **FramedSurface** content.
- `(sandbox)` — `/task/[taskId]`. Full-bleed **session** workspace: header (title, workspace badge, PR badge) + transcript + prompt stack + **right rail** of tools (preview, diff, artifacts, logs, info, terminal). Mobile hides the rail.
- `(unauthenticated)` — sign-in.

Home is **launch**, not a status wall. Status lives in three places at once:

1. **List** (`TaskCard`): actor + title + relative `activityAt` + spinner if `isActivelyRunningTask(status, phase)`.
2. **Nav** (`SideNavTaskItem`): compact pulse (spinner or `TaskStatusIndicator` dot). Pinned + recent. Hover pin.
3. **Session page**: boot sequence, live phase label, logs, retry.

Foundry today: home is intake + issue list (`issueListStatus`); issue page is the only session. Steal Roomote’s **three-place pulse** without stealing a side nav of fifty agent chats. For Foundry, the three places are: home issue row, issue header/stage strip, and the job card on the issue page.

---

## Remote-agent / operator UX

Roomote’s operator job is **assign, leave, return to a verdict**. While away, the UI must still be honest if they stay.

**Launch.** Home prompt + workspace + model. Disabled reason if compute is missing. Task is created before the sandbox is ready (`waiting_for_sandbox_provider`). Foundry analog: submit intake → Issue exists → research job claimed (`tryClaimJob`) even if the worker is not up yet. Show “queued / starting” as distinct from “reading the repo.”

**Boot vs work.** `getSessionState` (`sandbox-session/session-state.ts`) is the operator chrome state machine:

- `booting` — run still in Pending→Connecting, **or** sandbox is “running” but no harness message yet (7s timeout then fall through so prompt-less resumes are not stuck).
- `resuming` — same, but `payloadKind === SnapshotResume`. Copy says wake, not first start.
- `boot-failed` — Failed/Canceled **before any transcript**. Keep the **startup screen + logs + error**, do not dump the operator into an empty historical chat.
- `historical` — exited after output existed. Read-only transcript.
- `interactive` — live chat. Steer, follow-up, tools.

Foundry research today collapses boot and work into `ResearchRunning` (“Reading the repo”) and polls `router.refresh()` every 2s (`RefreshWhile`). Steal: if eve health fails, that is **boot-failed** (worker unreachable), not “research failed after thinking.” If the job row exists with `running` but the process map `inflight` is empty (server restarted), that is **stale**, not still reading.

**Startup progress.** `useStartupProgress` streams the run row over SSE (`/api/task-runs/[id]/stream`). Poll 1s while booting, 10s once `Running`. Steps map `RunStatus` → human labels via `getBootStatus`: Pending, Dequeued, Processing, Preparing, Spawning, Connecting, Running. Failed stays on the last step with `StartupFailureMessage` + **Retry** (or **Retry resume**). Error **codes** (`TaskRunErrorCode`: docker daemon, image missing, port in use, start timeout, read-only deployment) map to actionable copy — not regex on prose.

Foundry mapping: research job should expose **progress phases** the operator can believe: worker reachable → session opened → brief streaming/parsing → written. Failure copy should say which phase died. `failJob(..., message)` already stores a string; split **code vs message** later the way Roomote does `error` + `errorCode`.

**Live session.** `TaskStatusIndicator`: 2px dot, ping animation only while phase is `running`, label beside it. Phases the operator sees:

| TaskPhase | Label | Operator meaning |
| --- | --- | --- |
| `waiting_for_sandbox_provider` | Waiting for sandbox provider | Queue, not work |
| `running` | Working | Busy; do not treat as stuck |
| `waiting_for_user_input` | Needs input | Paused on human — **not** a running badge |
| `waiting_for_prompt` | Ready | Turn done, sandbox alive |
| `idle` | Idle | Same family as ready |
| `stopped` / `shutting_down` | Stopped / Terminating | Ending |

Critical helper: `isActivelyRunningTask` uses **phase**, not only `RunStatus`. `Idle` run status with `taskPhase === running` is a follow-up turn. `waiting_for_user_input` is **paused**, so list badges do not count it as busy. Foundry grill is exactly this: stage `active` + gate `grill` = needs input. Research running = working. Do not use the same spinner for “waiting on you.”

**Steer vs follow-up.** `isSteerablePhase`: running, waiting_for_user_input, waiting_for_prompt. Prompt input stays available; sending mid-turn is steer. Foundry grill answers are follow-up on a waiting session, not a new Issue.

**Right rail.** Preview / diff / artifacts / logs / info / terminal **disabled while booting or resuming**. Logs remain the escape hatch on boot-fail. Foundry: keep the job card as the only “rail”; put **logs/events** (`appendEvent` already writes `research.started` / `.failed`) behind a details fold, not a second product. Do not add Roomote’s preview/diff chrome to research.

**Failure + retry.** `retryFailedTaskStartCommand` relaunches a **failed first start** on the same task id (capacity, provider). Snapshot resume failures use a different button. Foundry `RetryResearch` already relaunches on the same Issue — keep that. Steal the copy split: “worker not reachable” vs “brief invalid” vs “timed out” so retry feels like the right lever.

**Keepalive / sleep.** Live `TaskStatus` shows remaining minutes until sleep when phase is idle/ready. Heartbeat: worker every 30s; stale after **2 minutes** (`WORKER_HEARTBEAT_STALE_MS`). Sleep reaper snapshots instead of lying that the agent is working. Foundry has no sandbox keepalive yet; the analog is **job row heartbeat**. A `running` row whose `startedAt` is old and whose process is gone is stale.

---

## Session status: the pattern to copy

Roomote never asks the UI to infer liveness from one field. Compose:

1. **Task state** (`active` / `completed` / `failed` / `canceled`) — list filters, not the live badge.
2. **Run status** — process lifecycle (boot → run → idle → exit).
3. **Task phase** — what the agent is doing *inside* a live run.
4. **Session chrome** — which layout (startup vs chat vs history).
5. **Connection** — `isConnected`; disconnected live phases collapse to idle for the client (`normalizeTaskStatusEventForClient`).
6. **Error overlay** — `lastErrorMessage` turns the indicator to “Error” with tooltip even if phase still says running.

Foundry compose:

| Foundry field | Role |
| --- | --- |
| `Issue.currentStage` + `IssueStage.status` | Walk (WalkStrip). Durable. |
| `IssueJob.status` | Process: today `running` \| `failed`. Add **`stale`**. |
| `IssueJob.startedAt` + last event / heartbeat | Liveness. |
| Artifact present (`research_brief`) | Historical / done — like Roomote `historical` once output exists. |
| `RefreshWhile` | Cheap poll; Roomote uses 2s while waiting for first harness message, then backs off. |

**Stale definition for Foundry research/grill jobs.** Treat as stale (not running) when all of: job status is `running`; no matching in-process `inflight` (or no heartbeat within N seconds); no new log event; artifact still missing. UI: amber/neutral copy “This job looks stuck” + same Retry as failed, not a spinner. Do not use Roomote yellow (`text-yellow-500`); use existing Foundry `text-amber-200` already used for `stageTone('blocked')`, or `text-neutral-400` plus the word **stale**. Failed stays `border-red-900/60` as today.

**Progress.** Roomote boot steps are a **checklist of statuses**, not a percent. Foundry should not fake 37%. Show the last honest phase: “Waiting for the Foundry worker” → “Session open” → “Writing the brief”. Grill: “Waiting on you” (already `issueListStatus` for grill) vs “Grill agent running” vs “Grill failed” vs “Grill stale.”

**List vs page.** Roomote list spinner is **binary busy**. Detail page has the full phase label + logs. Foundry home row can stay one line (`issueListStatus`) but must distinguish failed and stale from researching. Issue page owns the job card (running / failed / stale) plus WalkStrip.

---

## Design (layout only)

Steal:

- **One focal column of work** (transcript / brief) + **optional inspector** (logs, stage strip). Roomote’s framed card-in-shell is heavier than Foundry needs; keep Foundry’s `max-w-xl` issue column.
- **Status as a small persistent chip** (dot + short verb: Working / Needs input / Error / Ready), not a hero banner that replaces the brief.
- **Ping only for true work.** Needs-input and stale must not ping.
- **Boot failure keeps the prompt visible** so retry has context. Foundry already shows the idea in the header; keep the error **under** the title, not instead of it.
- **Skeleton / shimmer on first paint**, then replace with steps. Foundry `Spinner` + sentence is enough; do not import Roomote ProductTips / drum icons.

Do not steal:

- Lime charts, green “Working” (`text-emerald-500`), yellow waiting, DM Sans + Monaspace Neon.
- Light theme default.
- Slack emoji ack (👀) as primary status.
- Multi-panel sandbox IDE (terminal + preview + diff) on research.
- Cost badges and model switcher on the issue page.

---

## Map: Roomote session → Foundry research / grill

| Roomote | Foundry research | Foundry grill (next) |
| --- | --- | --- |
| Task | Issue | Same Issue, stage `grill` |
| Run | `IssueJob` stage `research` | `IssueJob` stage `grill` |
| `booting` / waiting for sandbox | Worker health + claim | Same |
| `interactive` + phase `running` | `job.status === running`, brief absent, heartbeat fresh | Agent asking / scoring |
| `waiting_for_user_input` | Should not happen in research | **Waiting on you** (decision tickets) |
| `boot-failed` | Fail before brief, error like worker unreachable | Grill agent never started |
| `historical` + completed | Brief artifact + stage done | Tickets answered, stage done |
| Heartbeat stale / idle lie | **`stale` job** | Stale grill job vs still waiting on human |
| Retry failed start | `RetryResearch` | Retry grill run, not re-intake |
| SSE run stream | `RefreshWhile` 2s while running; stop on artifact, failed, or stale | Same; do not poll while waiting on you |
| Side nav live dots | Home issue list status line | Same list, grill copy already “Waiting on you” |
| Logs panel | `data/logs/*.jsonl` + on-page last error | Grill round transcript |
| TaskPhase vs RunStatus | Do not overload `StageStatus` (`pending/active/blocked/skipped/done`) with job liveness. Stages are the walk. Jobs are the remote agent. | Gate `blocked` = human; job `running` = agent |

`JobStatus` today is `"running" | "failed"`. The Roomote-shaped upgrade is `"running" | "failed" | "stale"` (and optionally `"queued"` if claim and worker start are split). `StageStatus` stays the walk. Mixing them is how operators lose the plot.

---

## Steal-list (IA / visibility only)

1. **Split walk vs job.** Stages (`WalkStrip`) are not liveness. Jobs are.
2. **Three-place pulse.** List line, issue header, job card — same truth.
3. **Session chrome states.** Boot / work / boot-fail / done / waiting-on-you — different layouts, not one spinner.
4. **Phase verbs, not percents.** Working vs queued vs needs input vs stale vs failed.
5. **Ping animation only while actually working.**
6. **Boot-fail keeps logs + original ask + Retry** on the same card.
7. **Typed failure codes** (worker down, timeout, bad brief) mapped to operator sentences.
8. **Heartbeat → stale.** `running` without progress is a first-class status, not an infinite spinner. Poll backoff after first output (Roomote: 2s until first message, then slower).
9. **Needs-input is not running.** Grill “Waiting on you” must never share the research spinner.
10. **Retry on the same Issue/task id**, with different labels for first-start vs resume if grill later snapshots.
11. **Disable inspector toys while booting**; always allow logs on failure.
12. **Live overlay on persisted status** (Roomote `liveStatus` on nav items). Foundry: prefer last event time over assuming SQLite `running` is true.

## Do-not-steal

Roomote palette and light theme. Slack-as-primary operator. PR-as-success-metric for research. Sandbox IDE chrome. Per-seat analytics charts. Automation work-item factory until Foundry has execute.

---

## Foundry lock

Dashboard stays the operator surface. Dark theme lock. Research and grill jobs must be **visible as remote agent sessions**: running, failed, stale, and (grill) waiting on the human. Progress is last honest phase plus retry, not a fake bar.
