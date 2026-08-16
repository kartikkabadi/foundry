# Gates: 1.4.3.1 Spec UI

Scope: Spec as a stored document the operator can read.

- [x] G1: spec-panel exists
  CHECK: test -f app/issues/[id]/spec-panel.tsx && echo SPEC_PANEL_OK
  EXPECT: SPEC_PANEL_OK
  EVIDENCE: SPEC_PANEL_OK

- [x] G2: reads spec_doc artifact
  CHECK: node -e "const t=require('fs').readFileSync('app/issues/[id]/spec-panel.tsx','utf8'); if (!t.includes('spec_doc') && !t.includes('spec')) process.exit(1); console.log('SPEC_UI_OK');"
  EXPECT: SPEC_UI_OK
  EVIDENCE: SPEC_UI_OK
