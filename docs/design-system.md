# Foundry Design System

Synthesized from Cursor, Linear, Warren, NAC, Devin, Codex, and reference materials. This is the blueprint for all UI work.

## Color System

Foundry's dark theme is locked. Build on top of these tokens.

### Canvas & Surfaces
- **Background**: `oklch(0 0 0)` (pure black) — body `bg-black`
- **Surface 1**: `oklch(0.12 0 0)` — cards, popovers
- **Surface 2**: `oklch(0.15 0 0)` — elevated panels
- **Surface 3**: `oklch(0.18 0 0)` — modals, dropdowns

### Text Hierarchy (Linear-inspired)
- **Primary**: `oklch(0.985 0 0)` — headings, key info
- **Secondary**: `oklch(0.85 0 0)` — body text
- **Tertiary**: `oklch(0.7 0 0)` — labels, timestamps
- **Quaternary**: `oklch(0.5 0 0)` — disabled, placeholder

### Borders
- **Default**: `rgba(255, 255, 255, 0.08)` — semi-transparent white ("moonlight on glass")
- **Strong**: `rgba(255, 255, 255, 0.12)` — focus rings, active states
- **Subtle**: `rgba(255, 255, 255, 0.04)` — dividers

### Accent
- **Primary accent**: `oklch(0.65 0.15 260)` — muted indigo (CTAs, links, focus)
- **Success**: `oklch(0.7 0.15 145)` — completed, passed
- **Warning**: `oklch(0.75 0.15 85)` — stalled, needs attention
- **Error**: `oklch(0.704 0.191 22.216)` — failed, destructive

### Stage Colors (Walk Strip)
Each stage gets a distinct but muted color for the walk strip pills. Use `stageTone()` function.

## Typography

### Font Stack
- **Body**: Geist Sans (already installed)
- **Code**: Geist Mono (already installed)

### Weights
- **Regular**: 400 — body text
- **Medium**: 510 — emphasis (between regular and medium)
- **Semibold**: 590 — strong emphasis (between medium and semibold)
- **Never use 600 or 700** — Linear's discipline

### Sizes
- **Display**: 28-32px, letter-spacing -0.5px — page titles
- **Heading**: 18-20px, letter-spacing -0.3px — section headers
- **Body**: 14-15px — content text
- **Caption**: 12-13px — labels, timestamps
- **Mono**: 13px Geist Mono — code, stats, badges

### Line Heights
- **Tight**: 1.2 — headings
- **Normal**: 1.5 — body
- **Relaxed**: 1.65 — long-form content

## Spacing

### Base Unit
- **4px** base unit for all spacing
- **8px** grid for component placement

### Scale
- `--space-1`: 4px
- `--space-2`: 8px
- `--space-3`: 12px
- `--space-4`: 16px
- `--space-5`: 20px
- `--space-6`: 24px
- `--space-8`: 32px
- `--space-10`: 40px
- `--space-12`: 48px

## Depth & Elevation

### Surface Luminance Stepping (Linear pattern)
Use surface color to indicate depth, not shadows:
- **Flat**: Background color
- **Raised**: Surface 1
- **Elevated**: Surface 2
- **Modal**: Surface 3

### Shadows
- **Ring shadow** for contained elements: `rgba(0, 0, 0, 0.33) 0px 0px 0px 1px`
- **Subtle elevation**: `rgba(0,0,0,0.04) 0px 3px 2px, rgba(0,0,0,0.07) 0px 1px 1px`
- **No colored shadows** — all shadows are pure `rgba(0, 0, 0, ...)`

### Border Radius
- **Small**: 4px — badges, tags
- **Default**: 6.25px (0.625rem) — cards, buttons
- **Large**: 8px — modals, panels
- **Full**: 9999px — pills, avatars

## Component Patterns

### Issue Card
- Dense, scannable layout
- Status badge (color-coded by stage)
- Idea text (primary, truncated to 2 lines)
- Meta row: size, run mode, project, timestamp
- Hover: subtle surface elevation change
- Click: navigate to issue detail

### Stage Hero
- Current stage label (large, prominent)
- Run mode indicator (pill)
- Gate info (if at gate)
- Job status (running/stalled/failed)
- Issue idea as main heading
- "Now what" contextual message

### Walk Strip
- Horizontal pill strip of all stages
- Active stage highlighted with accent
- Completed stages show checkmark
- Skipped stages show dash
- Clickable to navigate (if allowed)

### Agent Activity Feed (Linear-inspired)
Five activity types:
1. **Thought** — collapsed by default, expandable
2. **Action** — tool call with label + parameter + result
3. **Elicitation** — question prompt with input field
4. **Response** — markdown-rendered final result
5. **Error** — error message with details

Thoughts and actions are ephemeral — they fade after completion.

### Approval Gate (Warren-inspired)
- Draft → Edit → Approve/Reject flow
- Not just binary approve/reject
- User can modify the draft before approving
- Hard safety invariant: outward actions always require approval

### Command Palette (Cmd+K)
- Universal action bar
- Factory routes: Issues, Gates, Projects, Cycles, Modules, Workers
- Recent issues (first 20)
- Keyboard-first: arrow keys, Enter, Escape

### Properties Rail (Right sidebar)
- Stage, Size, Run Mode, Job Status
- Project, Cycle, Module assignments
- Reassignment form
- Dense, monospace values

## Interaction Patterns

### Keyboard Shortcuts
- `Cmd+K` — Command palette
- `Cmd+J` — Agent chat sidebar
- `C` — Create issue (from anywhere)
- `Space` — Peek (preview issue)
- `E` — Edit selected
- `T` — Change status
- `A` — Assign
- `J/K` — Navigate lists
- `/` — Filter menu
- `?` — Show all shortcuts

### Progressive Disclosure
- Default: compact, scannable
- Toggle: detailed view
- Ephemeral states fade after completion
- Collapsible sections for long content

### Real-Time Updates
- `RefreshWhile` component polls every 2s when jobs are active
- No WebSockets needed for current scale
- Spinner for active work
- Status transitions are instant

## Agent UX Patterns

### Agent-as-Teammate (Linear)
- Agents have names, avatars, roles
- Show in same assignment UI as humans
- Human stays as primary assignee, agent as contributor
- @mentionable in any text field

### Goal-Based Execution (Codex)
- Goal as completion contract with lifecycle state
- Budget accounting with soft stops
- Evidence-based completion (model cannot self-certify)
- PROGRESS.md as first-class citizen

### Safety-First Gates (Warren)
- Every outward action requires approval
- Edit-before-approve (not just approve/reject)
- Safety invariants are testable and enforced
- Audit trail for every action

### Thread-and-Episode (NAC)
- Orchestrator decomposes, cannot execute
- Workers return structured episodes
- Episode compression for context management
- Meta-orchestrator for human-facing sessions

### Transparency (Devin)
- Shell view for real-time execution
- Knowledge base for cross-session memory
- Planner with structured DSL
- Multiple concurrent workspaces

## Anti-Slop Rules

1. No stubs, no TODOs, no "rest as exercise"
2. No commented-out dead code
3. No narrating comments
4. No bloat, no parallel/duplicate code
5. Smallest complete change that satisfies the named scope
6. Every claim verified against the real artifact
7. Pre-commit hooks: tests, linting, type checking
8. Test coverage ratcheting (can only increase)
9. Worktree isolation for agent work
10. Maker/verifier separation

## Quality Bar

- Pristine in functionality, design, code, architecture
- 3-4x review agents vs build agents
- Thermos + code quality + functional review after each batch
- Live E2E testing before declaring done
- No slop. No low quality. Everything artisanally crafted.
