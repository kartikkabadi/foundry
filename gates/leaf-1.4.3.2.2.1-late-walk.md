# Gates: 1.4.3.2.2.1 Late-walk UI

Scope: Execute, evidence, merge, hygiene wired to stored artifacts (depth-7 leaf).

- [x] G1: late-walk panel exists
  CHECK: test -f app/issues/[id]/late-walk-panel.tsx && echo LATE_PANEL_OK
  EXPECT: LATE_PANEL_OK
  EVIDENCE: LATE_PANEL_OK

- [x] G2: names execute evidence merge hygiene
  CHECK: node -e "const t=require('fs').readFileSync('app/issues/[id]/late-walk-panel.tsx','utf8'); for (const s of ['execute','evidence','merge','hygiene']) { if (!t.includes(s)) process.exit(1);} console.log('LATE_STAGES_OK');"
  EXPECT: LATE_STAGES_OK
  EVIDENCE: LATE_STAGES_OK

- [x] G3: issue page routes current stage to a real panel (not a dead stub)
  CHECK: node -e "const t=require('fs').readFileSync('app/issues/[id]/page.tsx','utf8'); for (const n of ['ResearchPanel','GrillPanel','SpecPanel','MidWalkPanel','LateWalkPanel']) { if (!t.includes(n)) process.exit(1);} console.log('PAGE_PANELS_OK');"
  EXPECT: PAGE_PANELS_OK
  EVIDENCE: PAGE_PANELS_OK
