# Gates: 1.2.2.2 Grill worker

Scope: Generate Decision tickets via eve; recommendations; rounds.

- [x] G1: grill module exists and uses eve/client
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/grill.ts','utf8'); if (!t.includes('eve/client')) process.exit(1); console.log('GRILL_EVE_OK');"
  EXPECT: GRILL_EVE_OK
  EVIDENCE: GRILL_EVE_OK

- [x] G2: writes decision tickets to store
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/grill.ts','utf8'); if (!/saveDecision|insertTicket|decision/i.test(t)) process.exit(1); console.log('GRILL_WRITE_OK');"
  EXPECT: GRILL_WRITE_OK
  EVIDENCE: GRILL_WRITE_OK

- [x] G3: frontier-empty helper exists
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/grill.ts','utf8'); if (!/frontier|unanswered/i.test(t)) process.exit(1); console.log('GRILL_FRONTIER_OK');"
  EXPECT: GRILL_FRONTIER_OK
  EVIDENCE: GRILL_FRONTIER_OK
