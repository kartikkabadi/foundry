# Gates: 1.5 Proof (integration)

Scope: typecheck + live E2E

- [x] N1: typecheck
  CHECK: npm run typecheck
  EXPECT: 
  EVIDENCE: > foundry@0.0.0 typecheck | > tsc --noEmit -p tsconfig.json

- [x] N2: live 200
  CHECK: curl -sS -o /dev/null -w "%{http_code}" http://vps.tailb387b4.ts.net:3100/
  EXPECT: 200
  EVIDENCE: 200
