# Gates: 1.3.2 Home + intake

Scope: Issue list density + intake that an operator can parse.

- [x] G1: home is wrapped by AppShell (layout)
  CHECK: node -e "const t=require('fs').readFileSync('app/layout.tsx','utf8'); if (!t.includes('AppShell')) process.exit(1); const p=require('fs').readFileSync('app/page.tsx','utf8'); if (!p.includes('IntakeForm')) process.exit(2); console.log('HOME_SHELL_OK');"
  EXPECT: HOME_SHELL_OK
  EVIDENCE: HOME_SHELL_OK

- [x] G2: copy has no \"not built yet\" as the list status
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/copy.ts','utf8'); if (t.includes('not built yet')) process.exit(1); console.log('COPY_OK');"
  EXPECT: COPY_OK
  EVIDENCE: COPY_OK

- [x] G3: intake still creates issues via server action
  CHECK: node -e "const t=require('fs').readFileSync('app/_components/intake-form.tsx','utf8'); if (!t.includes('createIssueAction')) process.exit(1); console.log('INTAKE_OK');"
  EXPECT: INTAKE_OK
  EVIDENCE: INTAKE_OK
