# Delegation plan
Units: 12

| # | Unit | Files (mine) | Worker (subagent) | Acceptance | Status |
|---|---|---|---|---|---|
| 1 | Claim canonicalization | `lib/foundry/orchestration-types.ts`, `lib/foundry/scheduler.ts`, `lib/foundry/orchestration-store.ts`, `tests/scheduler.test.ts`, `tests/orchestration-store.test.ts` | ClaimPaths | Alias-equivalent claims overlap; traversal and platform path aliases fail closed | verified |
| 2 | Verification fencing | `lib/foundry/orchestration-store.ts`, `lib/foundry/orchestration-execute.ts`, `tests/orchestration-store.test.ts`, `tests/orchestration-execute.test.ts` | VerifyFence | Verification and all worker-owned mutations require the active unexpired owner lease | verified |
| 3 | Audit redaction | `lib/foundry/log.ts`, `tests/log.test.ts` | AuditRedaction | Secrets are redacted recursively at the append boundary without damaging ordinary evidence | verified |
| 4 | Cleanup containment | `lib/foundry/workspace.ts`, `tests/workspace.test.ts` | CleanupContainment | Destructive cleanup steps are released only after physical root/target containment succeeds | verified |
| 5 | Automatic learning lifecycle | `lib/foundry/execute-learning.ts`, `lib/foundry/orchestration-runtime.ts`, `tests/orchestration-runtime.test.ts`, `tests/execute-learning.test.ts` | AutoLearning | Terminal execute outcomes can harvest evidence automatically through explicit injected policy; replay is idempotent and never installs rules | verified |
| 6 | Autonomous policy driver | `lib/foundry/improvement-loop.ts`, `lib/foundry/unattended.ts`, `lib/foundry/automation.ts`, `tests/automation.test.ts` | AutomationDriver | Pure selector and improvement decisions compose into bounded actions without answering gates or causing effects | verified |
| 7 | Bounded automation runtime | `lib/foundry/automation-runtime.ts`, `lib/foundry/automation-driver.ts`, `tests/automation-driver.test.ts` | RuntimeBuilder2 | One bounded pass runs only under durable operator control; disabled or operator-held control returns with no planning and no start effects | verified |
| 8 | Learning improvement candidates | `lib/foundry/improvement-candidates.ts`, `tests/improvement-candidates.test.ts` | LearningBuilder2 | Promoted lessons plus explicit operator proposals derive evidence-backed candidates; approval is never inferred | verified |
| 9 | Operator control storage | `lib/foundry/automation-control.ts`, `lib/foundry/store.ts`, `tests/automation-control.test.ts` | OperatorBuilder2 | Durable operator control is versioned, bounded, and fail-closed; stale CAS writes and out-of-bounds patches are rejected | verified |
| 10 | Disposable proof | `scripts/prove-orchestration.ts`, `tests/prove-orchestration.test.ts`, `tests/prove-automation.test.ts` | ProofBuilder | Disposable behavioral proof exercises the orchestration and automation runtime slices end to end without effects | verified |
| 11 | Operator dashboard | `app/automation/page.tsx`, `app/actions.ts`, `app/_components/sidebar.tsx` | OperatorBuilder2 | Operator inspects and controls the automation surface truthfully; live /automation toggles disabled, enabled, paused | verified |
| 12 | Independent graders | read-only review of runtime, learning, operator storage, and proof units | RuntimeGrade, OperatorGrade, ReleaseGrade, FinalSecurityGrade | Each grader reports with evidence; findings fixed with tests and docs reconciled; no material findings remain | verified |

## Evidence

- Parent repository verification on 2026-08-25: `npm test` passed 30 test files and 627 tests; `npm run typecheck` passed; `npm run build` passed.
- Focused automation verification: 67 tests pass across the automation control, driver, runtime, and improvement-candidate units.
- Disposable proof: `npm test -- --run tests/prove-orchestration.test.ts tests/prove-automation.test.ts` passed 9 tests; covers isolated mutation, durable retry recovery, meaningful verification, exactly-once finalization, bounded automation runtime under durable control, and no remote publication.
- Physical-claim production wiring: focused physical/runtime/driver verification passed 49 tests; sanctioned-root aliases collapse to physical identities before task creation and invalid claims fail closed.
- Behavioral release gate: `node_modules/.bin/tsx scripts/check-orchestration.ts` printed all seven section markers and `ORCHESTRATION_GATES_OK`.
- Live operator dashboard: browser loaded `/automation` and exercised disabled → enabled → paused with a screenshot.
- Independent architecture grade: PASS (0.92 confidence).
- Independent correctness grade: PASS (0.90 confidence).
- Independent post-integration security grade: PASS; no material findings.
- Independent runtime grade (RuntimeGrade): PASS (0.85 overall correctness) across runtime, learning, operator storage, and proof units.
- Independent security grade (FinalSecurityGrade): PASS with high confidence; no material findings.
- Operator storage grade (OperatorGrade): exposed an empty numeric field issue; fixed with regression tests; parent full suite, typecheck, and build pass after the fix.
- Release grade (ReleaseGrade): found stale documentation; reconciled with current behavior.
