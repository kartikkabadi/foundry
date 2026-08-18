# Foundry Design Principles

Extracted from reference materials, video lessons, and project research. These are law — every design decision, every line of code, every UI component must comply.

## Core Principles

### 1. Environment Over Documentation
Encode standards into verification systems, not documentation. Hooks, lints, tests, and gates enforce quality. Documentation is fallback, not primary control.

### 2. Structured Over Unstructured
Use databases/JSONL for context, not markdown files. Structured data is queryable, versionable, and agent-first. Markdown is for humans to read, not agents to parse.

### 3. Planning Over Review
Invest 90% of effort in planning to avoid review loops. Write ideas by hand first. Understand architecture before planning. Sleep on ideas. Never talk to coding agents during planning.

### 4. Isolation Over Shared State
Each agent gets its own worktree/environment. Never let agents work on the same codebase simultaneously. Ephemeral sandboxes per run.

### 5. Verification Over Trust
Build systems that make failure impossible, not trust that agents won't fail. Maker/verifier separation. Evals on every deployment. Test coverage ratcheting.

### 6. Sequential Over Parallel (for single features)
Work sequentially for control and quality. Parallel only for independent top-level workstreams.

### 7. Decomposition Over Complexity
Break everything into atomic, context-window-sized tasks (~200k tokens). Forward-chaining: each task builds on previous.

### 8. Anti-Slop Is Engineering
LLM code is not inherently slop. Poor output is an engineering problem. Never fix bad output; diagnose, reset, fix root cause, rerun. Pre-commit hooks, strict linting, test ratcheting.

### 9. Minimal Core, Everything as Plugin
Keep Foundry core small. Every capability is replaceable. Extensions, skills, prompt templates, themes — all swappable. Ask the agent to build what it needs.

### 10. Agent-as-Teammate
Agents are workspace members, not tools. Assign issues, @mention in context. AgentSession for lifecycle visibility. Saved Skills from conversations.

## UX Principles

### Information Density
- Like Linear/NAC: dense, scannable, keyboard-first
- Like Plane: app-shell pattern, command palette navigation
- Like Warren: live agent view, approval gates for side effects

### Premium Feel
- Dark theme locked (black, Geist, OKLCH tokens, 0.625rem radius)
- No foreign light-default overrides
- Clean typography, consistent spacing
- No decorative emoji, no AI tells

### Agent Communication
- Like Codex: PROGRESS.md for intent, side chats for understanding
- Like Linear: AgentSession/AgentActivity for progress visibility
- Like Devin: shell view for transparency
- Like NAC: structured episodes for audit trail

### Human Control
- Like Warren: every outward action requires approval
- Like Eve: park sessions until resolved
- Like Linear: assign issues to agents, steer mid-run
- Pause/resume/cancel always available

## Quality Bar

- No stubs, no TODOs, no "rest as exercise"
- No commented-out dead code
- No narrating comments
- No bloat, no parallel/duplicate code
- Smallest complete change that satisfies the named scope
- Every claim verified against the real artifact
- Thermos + code quality + functional review after each batch
- 3-4x review agents vs build agents
- Live E2E testing before declaring done
