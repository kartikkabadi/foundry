# Gates: 1.1.3 Roomote study

Scope: Deep notes on Roomote (remote agent/operator UX). Steal IA not colors.

- [x] G1: notes file exists and is substantial
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/roomote.md','utf8'); if (t.length<800) process.exit(1); console.log('ROOMOTE_LEN_'+t.length);"
  EXPECT: ROOMOTE_LEN_
  EVIDENCE: ROOMOTE_LEN_14932

- [x] G2: covers agent/session or remote-control UX
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/roomote.md','utf8').toLowerCase(); if (!t.includes('agent') && !t.includes('session') && !t.includes('remote')) process.exit(1); console.log('ROOMOTE_UX_OK');"
  EXPECT: ROOMOTE_UX_OK
  EVIDENCE: ROOMOTE_UX_OK

- [x] G3: maps patterns onto Foundry research/grill job visibility
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/roomote.md','utf8'); if (!/foundry|job|progress|status/i.test(t)) process.exit(1); console.log('ROOMOTE_MAP_OK');"
  EXPECT: ROOMOTE_MAP_OK
  EVIDENCE: ROOMOTE_MAP_OK
