# Gates: 1.2.2 Eve workers (integration)

Scope: research, grill, spec, walk all eve Client

- [x] N1: every worker imports eve/client
  CHECK: node -e "const fs=require('fs'); for (const p of ['lib/foundry/research.ts','lib/foundry/grill.ts','lib/foundry/spec.ts','lib/foundry/walk.ts']) { const t=fs.readFileSync(p,'utf8'); if (!t.includes('eve/client')) process.exit(1);} console.log('WORKERS_EVE_OK');"
  EXPECT: WORKERS_EVE_OK
  EVIDENCE: WORKERS_EVE_OK
