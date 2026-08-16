# Gates: 1.1 Product intelligence (integration)

Scope: children 1.1.1–1.1.6 merged; all five eligible; theme lock in synthesis

- [x] N1: child inspiration files exist
  CHECK: node -e "const fs=require('fs'); for (const n of ['plane','warren','roomote','nac','openship','synthesis']) { if (!fs.existsSync('docs/inspiration/'+n+'.md')) process.exit(1);} console.log('INSPO_ALL_OK');"
  EXPECT: INSPO_ALL_OK
  EVIDENCE: INSPO_ALL_OK

- [x] N2: synthesis restates D1 and D2
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/synthesis.md','utf8'); if (!/all five|not Plane-only/i.test(t)) process.exit(1); if (!/theme lock|do not adopt/i.test(t)) process.exit(2); console.log('INSPO_DECISIONS_OK');"
  EXPECT: INSPO_DECISIONS_OK
  EVIDENCE: INSPO_DECISIONS_OK
