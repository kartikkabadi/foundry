# Gates: 1.3.3 Issue frame

Scope: Current stage is the hero; walk is a status strip.

- [x] G1: StageHero and WalkStrip composed on issue page
  CHECK: node -e "const t=require('fs').readFileSync('app/issues/[id]/page.tsx','utf8'); if (!t.includes('StageHero') || !t.includes('WalkStrip')) process.exit(1); console.log('FRAME_COMPOSE_OK');"
  EXPECT: FRAME_COMPOSE_OK
  EVIDENCE: FRAME_COMPOSE_OK

- [x] G2: no xyflow graph as main event
  CHECK: node -e "const t=require('fs').readFileSync('app/issues/[id]/page.tsx','utf8'); if (t.includes('@xyflow') || t.includes('IssueGraph')) process.exit(1); console.log('NO_GRAPH_OK');"
  EXPECT: NO_GRAPH_OK
  EVIDENCE: NO_GRAPH_OK

- [x] G3: stage-hero file exists
  CHECK: test -f app/issues/[id]/stage-hero.tsx && echo STAGE_HERO_OK
  EXPECT: STAGE_HERO_OK
  EVIDENCE: STAGE_HERO_OK
