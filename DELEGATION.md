# Delegation plan
Units: 4

| # | Unit | Files (mine) | Worker (subagent) | Acceptance | Status |
|---|------|--------------|-------------------|------------|--------|
| 1 | Durable background supervisor and authority model | `lib/foundry/authority.ts`, `lib/foundry/automation-supervisor.ts`, `tests/automation-supervisor.test.ts` | supervisor-worker | Durable one-pass scheduling is lease-fenced, bounded, crash-safe, and disabled by default | verified |
| 2 | Evidence-policy approval for lessons and mechanical gates | `lib/foundry/learning.ts`, `lib/foundry/approval-policy.ts`, `tests/learning.test.ts`, `tests/approval-policy.test.ts` | approval-worker | Independent evidence can approve low-risk facts; self-review and policy relaxation remain impossible | verified |
| 3 | Idempotent branch and PR publication | `lib/foundry/publication.ts`, `tests/publication.test.ts` | publication-worker | Exact verified SHA publishes idempotently without force-push or merge | verified |
| 4 | Integrate controls and operator UI | `lib/foundry/automation-control.ts`, `lib/foundry/store.ts`, `app/actions.ts`, `app/automation/page.tsx`, `tests/automation-control.test.ts`, `tests/automation-actions.test.ts` | controls-worker | New authority is explicit, disabled by default, CAS-protected, and UI starts no work | verified |

## Evidence

- Parent integrated verification: 34 test files and 813 tests passed; typecheck, production build, nine behavioral proofs, and `git diff --check` passed.
- Transactional supervisor repair: 70 focused tests passed; stale owners cannot mutate after takeover because lease validation and mutation commit atomically under `BEGIN IMMEDIATE`.
- Independent final security review: PASS, high confidence, no findings.
- Independent final release review: correct, confidence 0.95, no blocking findings.
