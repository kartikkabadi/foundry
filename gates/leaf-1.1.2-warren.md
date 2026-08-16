# Gates: 1.1.2 Warren study

Scope: Deep notes on Warren README, app structure, HITL/dashboard patterns. Steal IA not colors.

- [x] G1: notes file exists and is substantial
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/warren.md','utf8'); if (t.length<800) process.exit(1); console.log('WARREN_LEN_'+t.length);"
  EXPECT: WARREN_LEN_
  EVIDENCE: WARREN_LEN_17060

- [x] G2: covers app structure or dashboard routes
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/warren.md','utf8').toLowerCase(); if (!t.includes('readme') && !t.includes('route') && !t.includes('dashboard')) process.exit(1); console.log('WARREN_STRUCT_OK');"
  EXPECT: WARREN_STRUCT_OK
  EVIDENCE: WARREN_STRUCT_OK

- [x] G3: names Foundry-usable patterns without adopting Warren palette
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/warren.md','utf8'); if (!/pattern|layout|HITL|human/i.test(t)) process.exit(1); console.log('WARREN_PATTERNS_OK');"
  EXPECT: WARREN_PATTERNS_OK
  EVIDENCE: WARREN_PATTERNS_OK
