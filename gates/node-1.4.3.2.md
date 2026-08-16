# Gates: 1.4.3.2 Later walk (integration)

Scope: mid + late

- [x] N1: both panels exist
  CHECK: node -e "const fs=require('fs'); if (!fs.existsSync('app/issues/[id]/mid-walk-panel.tsx') || !fs.existsSync('app/issues/[id]/late-walk-panel.tsx')) process.exit(1); console.log('LATER_WALK_OK');"
  EXPECT: LATER_WALK_OK
  EVIDENCE: LATER_WALK_OK
