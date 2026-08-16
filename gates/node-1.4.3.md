# Gates: 1.4.3 Spec and later (integration)

Scope: spec + mid + late panels

- [x] N1: three panel files exist
  CHECK: node -e "const fs=require('fs'); for (const p of ['app/issues/[id]/spec-panel.tsx','app/issues/[id]/mid-walk-panel.tsx','app/issues/[id]/late-walk-panel.tsx']) { if (!fs.existsSync(p)) process.exit(1);} console.log('LATER_PANELS_OK');"
  EXPECT: LATER_PANELS_OK
  EVIDENCE: LATER_PANELS_OK
