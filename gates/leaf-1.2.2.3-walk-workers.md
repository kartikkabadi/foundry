# Gates: 1.2.2.3 Spec + later workers

Scope: Spec and later-stage workers persist artifacts via eve.

- [x] G1: spec.ts uses eve and spec_doc
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/spec.ts','utf8'); if (!t.includes('eve/client') || !t.includes('spec_doc')) process.exit(1); console.log('SPEC_WORKER_OK');"
  EXPECT: SPEC_WORKER_OK
  EVIDENCE: SPEC_WORKER_OK

- [x] G2: walk.ts covers remaining stages with artifacts
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/walk.ts','utf8'); for (const s of ['improve','plan_pack','council','architecture','execute','evidence','merge','hygiene']) { if (!t.includes(s)) process.exit(1);} if (!t.includes('eve/client')) process.exit(2); console.log('WALK_WORKER_OK');"
  EXPECT: WALK_WORKER_OK
  EVIDENCE: WALK_WORKER_OK
