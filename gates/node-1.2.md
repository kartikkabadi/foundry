# Gates: 1.2 Kernel (integration)

Scope: types + store + workers compose

- [x] N1: worker modules exist
  CHECK: node -e "const fs=require('fs'); for (const p of ['lib/foundry/research.ts','lib/foundry/grill.ts','lib/foundry/spec.ts','lib/foundry/walk.ts','lib/foundry/store.ts','lib/foundry/types.ts']) { if (!fs.existsSync(p)) process.exit(1);} console.log('KERNEL_FILES_OK');"
  EXPECT: KERNEL_FILES_OK
  EVIDENCE: KERNEL_FILES_OK

- [x] N2: typecheck
  CHECK: npm run typecheck
  EXPECT: 
  EVIDENCE: > foundry@0.0.0 typecheck | > tsc --noEmit -p tsconfig.json
