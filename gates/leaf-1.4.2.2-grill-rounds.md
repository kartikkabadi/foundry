# Gates: 1.4.2.2 Grill rounds

Scope: Answer tickets; new round until frontier empty; then advance.

- [x] G1: actions include answer + advance grill
  CHECK: node -e "const t=require('fs').readFileSync('app/actions.ts','utf8'); if (!/answerDecision|answerTicket/.test(t)) process.exit(1); console.log('GRILL_ACTIONS_OK');"
  EXPECT: GRILL_ACTIONS_OK
  EVIDENCE: GRILL_ACTIONS_OK

- [x] G2: complete grill only when unanswered count is 0
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/grill.ts','utf8')+require('fs').readFileSync('app/actions.ts','utf8'); if (!/unanswered|frontier/i.test(t)) process.exit(1); console.log('FRONTIER_GATE_OK');"
  EXPECT: FRONTIER_GATE_OK
  EVIDENCE: FRONTIER_GATE_OK
