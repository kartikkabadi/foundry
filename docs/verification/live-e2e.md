# Live E2E — Foundry on :3100

Session: `foundry-e2e-f93a3bdd8883` (agent-browser `--scope worktree --prefix foundry-e2e`)
URL: http://vps.tailb387b4.ts.net:3100/
Date: 2026-08-17

## PASS

1. Home 200. Dark shell (`html.dark`, `body.bg-black`). Sidebar: Issues, Gates, Projects, Cycles, Modules, Workers with counts. Attention column “Waiting on you”. List / Spreadsheet toggle.
2. Intake: filled idea, submitted Open issue → `/issues/688132bb-e910-47d5-a8e8-82833f41357a`. Stage hero Research, WalkStrip, properties rail (size forced_l, project foundry, job Running).
3. Research completed (~169s). Artifact `research_brief` length **4728**. Stage advanced to grill. Brief headings present: In plain English, What this repo is, What your idea would change.
4. Grill worker wrote **5** Decision tickets (`grill.tickets`, `grill.round`). Page showed Record decision forms. Answered 1 ticket (persisted in SQLite: answered **1** of 5).
5. Gates inbox 200: lists grill Issues including the E2E Issue. Projects 200: foundry project lists the E2E Issue. Cycles/modules/workers 200.
6. Theme: no Plane light reskin. CSS tokens unchanged (`--background: oklch(0 0 0)`).

## Notes

- Command palette button Search ⌘K is on the header; overlay uses Foundry tokens (not CommandDialog portal). Lightpanda screenshot engine has no graphical renderer; a11y snapshot used instead.
- Grill tickets take ~3 minutes (eve GLM), same as research. Do not skip that wait in tests.
- Issue id for this run: `688132bb-e910-47d5-a8e8-82833f41357a`.
