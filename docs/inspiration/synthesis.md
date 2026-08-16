# Synthesis: five-product substrate for Foundry

Operator (2026-08-17): Foundry may **fork or integrate all five** — Warren, Plane, Roomote, NAC, Openship — **not Plane-only**. Steal **features and functionality**, not only denser chrome. Theme lock: do not adopt their palettes; keep Foundry black background, `app/globals.css` tokens (`--background: oklch(0 0 0)`), Geist, radius `0.625rem`.

Locked factory: SQLite Issue tracker, JSONL event log, walk, Decision tickets, gates, eve/GLM workers. GitHub on the target only gets the PR.

## Eligible substrates

All five are eligible. Each donates a different capability slice:

| Product | Capability donor | Not donated |
| --- | --- | --- |
| Plane | Issue tracker depth: projects, cycles, modules, command palette, list/spreadsheet layouts, properties rail, gate inbox (their Intake) | Colors, light theme, Django API, estimates, Gantt as source of truth |
| Warren | Live unit list, HITL above the log, re-run vs continue, serial walk children, explicit advance, pulse only while in-flight | Green palette, GitHub Issues as the factory record |
| Roomote | Job liveness vs walk stage, heartbeat → stale, phase verbs, typed failure + retry, needs-input is not running | Lime/green theme |
| NAC | Attention on the list, Decision-ticket workset cards, inspector split, health without leaking store paths | Arcee branding, chat-as-the-tracker |
| Openship | Sectioned rail, attention column, event log as a first-class surface, facet filters, counts as metadata, named Gates | Shipping-domain objects as Issues |

## What we implement in Foundry (mapped)

1. **Projects** — one per target git repo. Issues belong to a project. Not a second tracker.
2. **Cycles** — timeboxed batches of Issues (this week’s factory work). Plane cycles without sprint burndown.
3. **Modules** — named buckets on a project (capability slices). Issues can be assigned.
4. **Command palette** — Cmd+K navigates Issues / Gates / Projects / Cycles / Modules / Workers and jumps to an Issue.
5. **Gates inbox** — Issues whose current stage is a Gate (grill, plan, phase, evidence).
6. **Workers board** — running / failed / stale jobs with retry. Heartbeat marks stale after 8 minutes.
7. **Event log** — JSONL on disk, readable on the Issue.
8. **Grill Decision tickets** — rounds until frontier empty; recommendations; operator answers.
9. **Walk artifacts** — research brief, spec, and later-stage documents stored in SQLite.
10. **Home attention column** — waiting-on-you + stalled workers (Openship/NAC).
11. **List + spreadsheet layouts** for Issues.
12. **Properties rail** on the Issue: size, project, cycle, module, stage, job.

Do not ship a reskin that only looks denser.
