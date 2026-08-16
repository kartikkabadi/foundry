# Gates: 1.2.2.1 Research worker

Scope: Reliable research via eve Client; fail/stale instead of infinite running.

- [x] G1: uses eve/client
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/research.ts','utf8'); if (!t.includes('from \"eve/client\"') && !t.includes(\"from 'eve/client'\")) process.exit(1); console.log('RESEARCH_EVE_OK');"
  EXPECT: RESEARCH_EVE_OK
  EVIDENCE: RESEARCH_EVE_OK

- [x] G2: failJob on errors
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/research.ts','utf8'); if (!t.includes('failJob')) process.exit(1); console.log('RESEARCH_FAIL_OK');"
  EXPECT: RESEARCH_FAIL_OK
  EVIDENCE: RESEARCH_FAIL_OK

- [x] G3: no raw z.ai / bigmodel URLs
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/research.ts','utf8'); if (/api\\.z\\.ai|open\\.bigmodel/.test(t)) process.exit(1); console.log('RESEARCH_NO_RAW_OK');"
  EXPECT: RESEARCH_NO_RAW_OK
  EVIDENCE: RESEARCH_NO_RAW_OK
