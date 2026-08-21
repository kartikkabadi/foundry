# Decision ticket — Grill auto-resolve vs Oneshot v2 permission split

> Filed **before any Oneshot v2 application code is written**, as required by the
> Oneshot v2 — Minimal v1 Runtime Spec (acceptance #1). This is the prerequisite
> Decision ticket referenced by the spec contract at
> `docs/specs/oneshot-v2-minimal-v1-runtime-spec.md` (sections "v1 lock handling"
> and "Permission split").

- **Decision ticket ID:** `oneshot-v2/grill-autoresolve-vs-permission-split`
- **Status:** Filed · Accepted (operator)
- **Filed:** pre-code, against the v1 lock (issue #1)
- **Supersedes:** any reading of the Oneshot v2 design that forces grill to hard-stop.

## Prompt (the question)

Foundry's v1 oneshot mode (`lib/foundry/oneshot.ts`) auto-resolves grill Decision
tickets using the worker's recommendation: `autoAnswerGrillTickets` answers each
open Decision ticket with `ticket.recommendation` and emits a `gate.auto` event
(`stage: "grill", action: "answer_ticket"`). It then auto-advances the Walk.

The Oneshot v2 design introduces a permission split: **the model may not change
goal status.** Only the runtime and the human may write `paused`,
`budget_limited`, `usage_limited`, or `clear`, and only the verifier-gated path
may write `complete`.

Does the v2 permission split force grill auto-resolve to hard-stop, or is it
preserved? If preserved, under what scope, and why does it not violate the
permission split?

## Recommendation

Preserve grill auto-resolve unchanged in v1 of Oneshot v2. It is a low-risk gate
that answers Decision tickets with the worker recommendation, exactly as v1 does
today.

## Answer (accepted resolution)

Grill auto-resolve is **preserved**. Resolving a grill Decision ticket answers a
Decision ticket; it is **not** a goal-status write. The v2 permission split
governs the `goals.status` column only. Answering a Decision ticket does not
touch `goals.status`, so it cannot violate the split.

Concretely:

- The oneshot Walk keeps calling `autoAnswerGrillTickets(issueId)`.
- `answerDecisionTicket(ticket.id, ticket.recommendation)` writes the
  `decision_tickets.answer` column only. It does not write `goals.status`.
- The emitted `gate.auto` event records an answered Decision ticket, not a goal
  transition. Goal lifecycle uses the `goal.*` event kinds
  (`goal.status_change`, `goal.budget_delta`, `goal.soft_stop`, etc.), which grill
  auto-resolve never emits.
- Therefore grill auto-resolve remains in the "auto-resolve (low-risk, consistent
  with v1 oneshot policy)" bucket of gate policy, alongside nothing else — it is
  the only auto-resolve in v1.

## Rationale

1. **Different fields.** The permission split is narrowed to goal-status writes
   (`goals.status`). A Decision ticket answer is a row in `decision_tickets`, a
   separate relation with a separate lifecycle. There is no shared write.
2. **Different trust boundary.** A grill recommendation is the worker proposing
   an answer to an operator question; the operator may still override any ticket
   (`clearTicketAnswer`). It is a HITL gate, not an autonomous status mutation.
3. **No regression.** Forcing grill to hard-stop would change the v1 oneshot
   contract under the v1 lock without a Decision ticket — which is itself the
   thing this ticket exists to prevent. Preserving it keeps the existing path
   unchanged behind the feature switch (acceptance #2).
4. **No status inflation.** v1 of the goal record only makes `active`,
   `paused`, and `budget_limited` live. Grill auto-resolve never writes any of
   them; it cannot accidentally complete or block a goal.

## Relationship to the v1 lock (issue #1)

Issue #1 locks the v1 oneshot behavior, including "Grill tickets auto-answer with
the worker recommendation" (CONTEXT.md, "One shot"). This ticket does **not**
reopen that decision. It clarifies that the v2 permission split — a new
constraint on a new `goals` table — does not retroactively forbid the existing,
locked grill behavior.

This ticket is additive: it scopes a new constraint, it does not relax an old
one.

## Non-effects (what this ticket does NOT authorize)

- It does **not** let the model write `goals.status` for any value.
- It does **not** let grill auto-resolve skip the interview gate or the budget
  soft stop. Those are separate, runtime-owned gates.
- It does **not** make `complete` reachable. `complete` stays inert and gated
  behind the separate Sandbox Issue.
- It does **not** change the 4-round grill cap
  (`ONESHOT_GRILL_MAX_ROUNDS`) or the `grill.hold` operator override.
- It does **not** write any Foundry data (GOAL.md, PROGRESS.md) into the sandbox.

## Verification

When the implementation Issue lands, the following must hold and are traceable
from this ticket:

- `lib/foundry/oneshot.ts` still calls `autoAnswerGrillTickets` on the oneshot
  path behind the feature switch.
- Answering a grill ticket never issues a `goals.status` write or a `goal.*`
  event; it still emits `gate.auto` / `grill.answered` as today.
- The permission-split test set includes: "the model cannot write
  `paused`/`budget_limited`/`usage_limited`/`clear`" and, separately, "grill
  Decision tickets are still auto-resolved with the worker's recommendation."
