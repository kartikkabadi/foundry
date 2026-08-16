# Gates: 1.3.1 Chrome

Scope: Plane-class density/nav/command menu in Foundry dark theme.

- [x] G1: app-shell and sidebar exist
  CHECK: node -e "const fs=require('fs'); if (!fs.existsSync('app/_components/app-shell.tsx')) process.exit(1); if (!fs.existsSync('app/_components/sidebar.tsx')) process.exit(2); console.log('SHELL_FILES_OK');"
  EXPECT: SHELL_FILES_OK
  EVIDENCE: SHELL_FILES_OK

- [x] G2: command menu exists
  CHECK: node -e "if (!require('fs').existsSync('app/_components/command-menu.tsx')) process.exit(1); console.log('CMDK_OK');"
  EXPECT: CMDK_OK
  EVIDENCE: CMDK_OK

- [x] G3: globals.css theme lock still holds
  CHECK: node -e "const t=require('fs').readFileSync('app/globals.css','utf8'); if (!t.includes('--background: oklch(0 0 0)')) process.exit(1); if (!t.includes('color-scheme: dark')) process.exit(2); if (!t.includes('--radius: 0.625rem')) process.exit(3); console.log('CHROME_THEME_OK');"
  EXPECT: CHROME_THEME_OK
  EVIDENCE: CHROME_THEME_OK

- [x] G4: chrome uses Foundry tokens not a new palette file
  CHECK: node -e "const t=require('fs').readFileSync('app/_components/app-shell.tsx','utf8'); if (/bg-white|from-indigo|#5e6ad2/i.test(t)) process.exit(1); console.log('CHROME_NO_FOREIGN_OK');"
  EXPECT: CHROME_NO_FOREIGN_OK
  EVIDENCE: CHROME_NO_FOREIGN_OK
