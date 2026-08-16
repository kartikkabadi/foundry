# Gates: 1.1.6 Synthesis

Scope: Combine steal-list from all five products; concrete integration/fork strategy; theme lock restated.

- [x] G1: synthesis file names all five products
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/synthesis.md','utf8'); for (const n of ['Warren','Plane','Roomote','NAC','Openship']) { if (!t.includes(n)) process.exit(1);} console.log('SYNTH_NAMES_OK');"
  EXPECT: SYNTH_NAMES_OK
  EVIDENCE: SYNTH_NAMES_OK

- [x] G2: all five are eligible fork/integrate substrates (not Plane-only)
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/synthesis.md','utf8'); if (!/all five|not Plane-only|eligible/i.test(t)) process.exit(1); if (!/fork|integrat/i.test(t)) process.exit(2); console.log('SYNTH_FIVE_OK');"
  EXPECT: SYNTH_FIVE_OK
  EVIDENCE: SYNTH_FIVE_OK

- [x] G3: theme lock: steal layout/density/nav, keep Foundry tokens
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/synthesis.md','utf8'); if (!/globals.css|Geist|oklch\\(0 0 0\\)|black background/i.test(t)) process.exit(1); if (!/do not adopt|theme lock/i.test(t)) process.exit(2); console.log('SYNTH_THEME_OK');"
  EXPECT: SYNTH_THEME_OK
  EVIDENCE: SYNTH_THEME_OK

- [x] G4: keeps factory walk and SQLite tracker
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/synthesis.md','utf8'); if (!/SQLite/i.test(t) || !/walk/i.test(t) || !/Decision ticket/i.test(t)) process.exit(1); console.log('SYNTH_LOCK_OK');"
  EXPECT: SYNTH_LOCK_OK
  EVIDENCE: SYNTH_LOCK_OK
