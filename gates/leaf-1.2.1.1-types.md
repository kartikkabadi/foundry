# Gates: 1.2.1.1 Domain types

Scope: Job stale status, artifact kind constants, exhaustive helpers; forced-L still skips nothing.

- [x] G1: JobStatus includes stale
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/types.ts','utf8'); if (!t.includes('\"stale\"')) process.exit(1); console.log('JOB_STALE_TYPE_OK');"
  EXPECT: JOB_STALE_TYPE_OK
  EVIDENCE: JOB_STALE_TYPE_OK

- [x] G2: twelve walk stages still listed
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/types.ts','utf8'); for (const s of ['intake','research','grill','spec','improve','plan_pack','council','architecture','execute','evidence','merge','hygiene']) { if (!t.includes('\"'+s+'\"')) process.exit(1);} console.log('STAGES_12_OK');"
  EXPECT: STAGES_12_OK
  EVIDENCE: STAGES_12_OK

- [x] G3: skippedStages forced_l is empty object
  CHECK: npx tsx -e "import { skippedStages } from './lib/foundry/types.ts'; if (Object.keys(skippedStages('forced_l')).length!==0) process.exit(1); console.log('FORCED_L_OK');"
  EXPECT: FORCED_L_OK
  EVIDENCE: FORCED_L_OK
