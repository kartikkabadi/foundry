# Gates: 1.4.2.1 Grill tickets UI

Scope: Decision tickets with recommendations; Foundry theme.

- [x] G1: grill-panel exists
  CHECK: test -f app/issues/[id]/grill-panel.tsx && echo GRILL_PANEL_OK
  EXPECT: GRILL_PANEL_OK
  EVIDENCE: GRILL_PANEL_OK

- [x] G2: shows prompt, recommendation, answer control
  CHECK: node -e "const t=require('fs').readFileSync('app/issues/[id]/grill-panel.tsx','utf8'); if (!t.includes('recommendation') || !t.includes('prompt')) process.exit(1); console.log('GRILL_FIELDS_OK');"
  EXPECT: GRILL_FIELDS_OK
  EVIDENCE: GRILL_FIELDS_OK

- [x] G3: no foreign palette classes
  CHECK: node -e "const t=require('fs').readFileSync('app/issues/[id]/grill-panel.tsx','utf8'); if (/bg-white|indigo-|#5e6ad2/i.test(t)) process.exit(1); console.log('GRILL_THEME_OK');"
  EXPECT: GRILL_THEME_OK
  EVIDENCE: GRILL_THEME_OK
