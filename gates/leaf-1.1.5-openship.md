# Gates: 1.1.5 Openship study

Scope: Deep notes on Openship shipping/ops dashboard. Steal IA not colors.

- [x] G1: notes file exists and is substantial
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/openship.md','utf8'); if (t.length<800) process.exit(1); console.log('OPENSHIP_LEN_'+t.length);"
  EXPECT: OPENSHIP_LEN_
  EVIDENCE: OPENSHIP_LEN_55100

- [x] G2: covers dashboard or ops workflow
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/openship.md','utf8').toLowerCase(); if (!/(dashboard|order|ship|workflow|ops)/.test(t)) process.exit(1); console.log('OPENSHIP_UX_OK');"
  EXPECT: OPENSHIP_UX_OK
  EVIDENCE: OPENSHIP_UX_OK

- [x] G3: maps density/nav patterns onto Foundry factory walk
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/openship.md','utf8'); if (!/foundry|walk|layout|density|nav/i.test(t)) process.exit(1); console.log('OPENSHIP_MAP_OK');"
  EXPECT: OPENSHIP_MAP_OK
  EVIDENCE: OPENSHIP_MAP_OK
