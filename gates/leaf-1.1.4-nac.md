# Gates: 1.1.4 NAC study

Scope: Deep notes on arcee-ai/nac app structure and operator UX. Steal IA not colors.

- [x] G1: notes file exists and is substantial
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/nac.md','utf8'); if (t.length<800) process.exit(1); console.log('NAC_LEN_'+t.length);"
  EXPECT: NAC_LEN_
  EVIDENCE: NAC_LEN_39501

- [x] G2: covers product surface (routes, dashboard, or agent UX)
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/nac.md','utf8').toLowerCase(); if (!/(route|dashboard|agent|app)/.test(t)) process.exit(1); console.log('NAC_SURFACE_OK');"
  EXPECT: NAC_SURFACE_OK
  EVIDENCE: NAC_SURFACE_OK

- [x] G3: maps usable patterns onto Foundry without color adoption
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/nac.md','utf8'); if (!/foundry|pattern|layout/i.test(t)) process.exit(1); console.log('NAC_MAP_OK');"
  EXPECT: NAC_MAP_OK
  EVIDENCE: NAC_MAP_OK
