# Gates: 1.3 Operator shell (integration)

Scope: chrome + home + issue frame; Foundry theme

- [x] N1: shell wraps every page via layout
  CHECK: node -e "const t=require('fs').readFileSync('app/layout.tsx','utf8'); if (!t.includes('AppShell')) process.exit(1); console.log('SHELL_HOME_OK');"
  EXPECT: SHELL_HOME_OK
  EVIDENCE: SHELL_HOME_OK

- [x] N2: theme lock
  CHECK: node -e "const t=require('fs').readFileSync('app/globals.css','utf8'); if (!t.includes('--background: oklch(0 0 0)')) process.exit(1); console.log('SHELL_THEME_OK');"
  EXPECT: SHELL_THEME_OK
  EVIDENCE: SHELL_THEME_OK
