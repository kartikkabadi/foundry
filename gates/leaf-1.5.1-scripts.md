# Gates: 1.5.1 Scripts

Scope: Typecheck, theme lock, walk store checks at report time.

- [x] G1: typecheck
  CHECK: npm run typecheck
  EXPECT: 
  EVIDENCE: > foundry@0.0.0 typecheck | > tsc --noEmit -p tsconfig.json

- [x] G2: theme lock script or globals check
  CHECK: node -e "const t=require('fs').readFileSync('app/globals.css','utf8'); if (!t.includes('--background: oklch(0 0 0)')) process.exit(1); console.log('THEME_OK');"
  EXPECT: THEME_OK
  EVIDENCE: THEME_OK

- [x] G3: walk check
  CHECK: npx tsx scripts/check-walk.ts
  EXPECT: WALK_OK
  EVIDENCE: (node:3743462) ExperimentalWarning: SQLite is an experimental feature and might change at any time | (Use `node --trace-warnings ...` to show where the warning was created)
