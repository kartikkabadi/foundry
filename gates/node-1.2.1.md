# Gates: 1.2.1 Persistence (integration)

Scope: types + store

- [x] N1: stale + tickets in store against types
  CHECK: node -e "const ty=require('fs').readFileSync('lib/foundry/types.ts','utf8'); const st=require('fs').readFileSync('lib/foundry/store.ts','utf8'); if (!ty.includes('\"stale\"') || !st.includes('stale')) process.exit(1); if (!st.includes('decision_tickets')) process.exit(2); console.log('PERSIST_OK');"
  EXPECT: PERSIST_OK
  EVIDENCE: PERSIST_OK
