# pi-cursor-sdk in-house options (2026-05-26)

**Recommendation: extract-first** — portable auth, Composer policy, and smokes into Foundry `packages/adapters` before any fork of [fitchmultz/pi-cursor-sdk](https://github.com/fitchmultz/pi-cursor-sdk).

## Current stack (verified)

| Layer | Foundry today | Pi / powerpack |
|-------|---------------|----------------|
| npm | `@cursor/sdk` only (`packages/adapters/package.json`) | pi-cursor-sdk pins SDK |
| Auth | `CURSOR_API_KEY` → Pi `auth.json` (`packages/core/src/config/cursor-auth.ts`) | Same order in pi-cursor-sdk README |
| Plan/build agent | `promptComposer` / `Agent.prompt` | Pi provider + tool bridge |
| pi-cursor-sdk dep | **None** | powerpack `extensions/cursor-sdk.ts` re-exports |

## Parity matrix

| Concern | pi-cursor-sdk | Foundry | Gap |
|---------|---------------|---------|-----|
| Auth resolution | env, `--api-key`, Pi auth | env, Pi auth | CLI `--api-key` not in Foundry |
| Model IDs | `cursor/composer-2.5` | `composer-2.5` / `composer-2.5-fast` in smokes | Align IDs with DECISIONS |
| Fast default | `~/.pi/agent/cursor-sdk.json` | explicit fast in doctor only | Policy doc needed |
| Smoke token | provider-specific | `FOUNDRY_COMPOSER_OK` | Adopt shared constant or cross-test fixtures |
| Tool bridge | Pi-only | N/A | **Stay in Pi** — not portable |
| `Agent.create` + stream | future in SDK skill | not used | defer until build workers need it |

## Three options

### 1. Extract portable core (primary)

Move shared logic into `packages/adapters` (future `FoundryAgentClient` — **no new public type until post-V3 merge + G4 complete**):

- Auth order + scrubbing
- Composer 2.5 Standard/Fast policy (no silent fallback)
- Smoke helpers used by doctor and plan/build

Powerpack remains thin re-export or depends on shared package later.

**Cost:** Medium engineering after V3 merge. **Risk:** Low. **AFK fit:** Best.

### 2. Fork pi-cursor-sdk (Pi surface only)

Only if upstream cannot accept Composer-only / AFK constraints for **interactive Pi** users.

**Cost:** Ongoing fork maintenance. **Risk:** Medium divergence. **Not for Foundry CLI default path.**

### 3. Hybrid workers (post-V3)

Foundry orchestrates via (1); optional `pi` + pi-cursor-sdk for worker paths when `doctor pi-runtime` ready.

**Cost:** High integration. **Defer** until V3 DoD + G4.

## Fork scope (if audit fails extract)

Limited to: Pi provider hooks, fast/thinking UX, tool bridge — **not** copying into Foundry CLI.

## Node runtime note

Repo pins **Node 20** (`.nvmrc`, `package.json` `engines`). pi-cursor-sdk may document 22.19+; **bump is post-swarm slice C** with DECISIONS entry — do not block G4 on 22 unless explicitly bumped first.
