# Gates: 1.1.1 Plane study

Scope: Deep notes on Plane as a dashboard substrate (tracker, projects, cycles, modules, layouts, command menu, density, nav). Steal IA not colors.

- [x] G1: notes file exists and is substantial
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/plane.md','utf8'); if (t.length<2000) process.exit(1); console.log('PLANE_LEN_'+t.length);"
  EXPECT: PLANE_LEN_
  EVIDENCE: PLANE_LEN_18017

- [x] G2: covers issue tracker, projects, cycles, modules, layouts, command menu
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/plane.md','utf8').toLowerCase(); for (const n of ['issue','project','cycle','module','layout','command']) { if (!t.includes(n)) process.exit(1);} console.log('PLANE_TOPICS_OK');"
  EXPECT: PLANE_TOPICS_OK
  EVIDENCE: PLANE_TOPICS_OK

- [x] G3: records theme lock — steal layout not Plane colors
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/plane.md','utf8'); if (!/layout|density|navigation/i.test(t)) process.exit(1); if (!/not .*colou?r|theme lock|do not adopt/i.test(t)) process.exit(2); console.log('PLANE_THEME_NOTE_OK');"
  EXPECT: PLANE_THEME_NOTE_OK
  EVIDENCE: PLANE_THEME_NOTE_OK

- [x] G4: proposes concrete fork/integrate points that keep Foundry walk
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/plane.md','utf8'); if (!/walk|grill|foundry/i.test(t)) process.exit(1); if (!/fork|integrat/i.test(t)) process.exit(2); console.log('PLANE_FORK_OK');"
  EXPECT: PLANE_FORK_OK
  EVIDENCE: PLANE_FORK_OK
