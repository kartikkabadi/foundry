# Gates: 1.4 Factory walk product (integration)

Scope: issue page composes all stage panels

- [x] N1: page imports all panels
  CHECK: node -e "const t=require('fs').readFileSync('app/issues/[id]/page.tsx','utf8'); for (const n of ['ResearchPanel','GrillPanel','SpecPanel','MidWalkPanel','LateWalkPanel','StageHero','WalkStrip']) { if (!t.includes(n)) process.exit(1);} console.log('WALK_COMPOSE_OK');"
  EXPECT: WALK_COMPOSE_OK
  EVIDENCE: WALK_COMPOSE_OK
