# Gates: 1.4.2 Grill HITL (integration)

Scope: UI + rounds + worker

- [x] N1: grill panel and grill.ts exist
  CHECK: node -e "const fs=require('fs'); if (!fs.existsSync('app/issues/[id]/grill-panel.tsx') || !fs.existsSync('lib/foundry/grill.ts')) process.exit(1); console.log('GRILL_INT_OK');"
  EXPECT: GRILL_INT_OK
  EVIDENCE: GRILL_INT_OK
