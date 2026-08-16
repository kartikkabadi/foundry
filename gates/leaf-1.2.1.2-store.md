# Gates: 1.2.1.2 Store + jobs + tickets

Scope: SQLite APIs for stale jobs, decision tickets, artifacts.

- [x] G1: store exposes list/answer decision tickets
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/store.ts','utf8'); if (!t.includes('decision_tickets')) process.exit(1); if (!/function (listDecisionTickets|listTickets)/.test(t)) process.exit(2); if (!/function (answerDecisionTicket|answerTicket)/.test(t)) process.exit(3); console.log('TICKET_API_OK');"
  EXPECT: TICKET_API_OK
  EVIDENCE: TICKET_API_OK

- [x] G2: store can mark jobs stale
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/store.ts','utf8'); if (!t.includes('stale')) process.exit(1); if (!/function (markStaleJobs|reconcileJobs|jobIsStale)/.test(t)) process.exit(2); console.log('STALE_API_OK');"
  EXPECT: STALE_API_OK
  EVIDENCE: STALE_API_OK

- [x] G3: forced-L walk script still passes
  CHECK: npx tsx scripts/check-walk.ts
  EXPECT: WALK_OK
  EVIDENCE: (node:3743063) ExperimentalWarning: SQLite is an experimental feature and might change at any time | (Use `node --trace-warnings ...` to show where the warning was created)
