# Gates: 1.5.2 Live E2E

Scope: agent-browser against http://vps.tailb387b4.ts.net:3100/ named session; intake → research brief → grill if built.

- [x] G1: live home returns 200
  CHECK: curl -sS -o /dev/null -w "%{http_code}" http://vps.tailb387b4.ts.net:3100/
  EXPECT: 200
  EVIDENCE: 200

- [x] G2: verification writeup exists
  CHECK: test -f docs/verification/live-e2e.md && echo E2E_FILE_OK
  EXPECT: E2E_FILE_OK
  EVIDENCE: E2E_FILE_OK

- [x] G3: writeup records named session and PASS
  CHECK: node -e "const t=require('fs').readFileSync('docs/verification/live-e2e.md','utf8'); if (!t.includes('vps.tailb387b4.ts.net:3100')) process.exit(1); if (!/PASS/i.test(t)) process.exit(2); console.log('E2E_PASS_OK');"
  EXPECT: E2E_PASS_OK
  EVIDENCE: E2E_PASS_OK
