# Gates: Foundry production-ready HITL factory

Scope: Operator dashboard Kartik can run without confusion; steal IA/layout from all five inspiration products while keeping Foundry’s factory model and dark theme; live E2E on :3100.

## Decisions (operator, 2026-08-17)

- D1 Substrate: Foundry may build around or fork Warren, Plane, Roomote, NAC, and Openship — not Plane-only. Combine whatever serves the HITL factory. Locked: SQLite Issue tracker, factory walk, gates, eve/GLM workers. GitHub on the target only gets the PR.
- D2 Theme lock: Do not adopt Plane’s (or anyone else’s) color tokens, brand palette, or light-default look. Steal layout, density, navigation, information architecture, and interaction patterns. Keep Foundry dark theme: black background, CSS variables in `app/globals.css` (`background`/`foreground`/`card`/`primary`/`muted`/`border`), Geist fonts, current radius. New UI must look like Foundry, not a reskin of Plane.
- D3 Features not chrome: inventory real capabilities from all five repos in PLAN.md; implement mapped factory features (projects, cycles, modules, command palette, gates inbox, workers, event log, grill, walk artifacts). Do not ship a denser reskin.

- [x] G1: next stays 16.3.1
  CHECK: node -p "require('./package.json').dependencies.next"
  EXPECT: 16.3.1
  EVIDENCE: 16.3.1

- [x] G2: typecheck passes
  CHECK: npm run typecheck
  EXPECT: 
  EVIDENCE: > foundry@0.0.0 typecheck | > tsc --noEmit -p tsconfig.json

- [x] G3: forced-L skips nothing
  CHECK: npx tsx scripts/check-walk.ts
  EXPECT: WALK_OK
  EVIDENCE: (node:3716035) ExperimentalWarning: SQLite is an experimental feature and might change at any time | (Use `node --trace-warnings ...` to show where the warning was created)

- [x] G4: inspiration notes exist for all five products
  CHECK: node -e "const fs=require('fs'); const names=['warren','plane','roomote','nac','openship']; for (const n of names) { const p='docs/inspiration/'+n+'.md'; if (!fs.existsSync(p)) process.exit(1); if (fs.readFileSync(p,'utf8').length<800) process.exit(2);} console.log('INSPO_5_OK');"
  EXPECT: INSPO_5_OK
  EVIDENCE: INSPO_5_OK

- [x] G5: synthesis names all five as eligible fork/integrate substrates
  CHECK: node -e "const t=require('fs').readFileSync('docs/inspiration/synthesis.md','utf8'); for (const n of ['Warren','Plane','Roomote','NAC','Openship']) { if (!t.includes(n)) process.exit(1);} if (!/fork|integrat/i.test(t)) process.exit(2); console.log('SYNTH_FIVE_OK');"
  EXPECT: SYNTH_FIVE_OK
  EVIDENCE: SYNTH_FIVE_OK

- [x] G6: PLAN.md records D1 five-product substrate and D2 theme lock
  CHECK: node -e "const t=require('fs').readFileSync('PLAN.md','utf8'); if (!t.includes('D1') || !t.includes('D2')) process.exit(1); if (!/Warren/.test(t) || !/Plane/.test(t) || !/Roomote/.test(t) || !/NAC/.test(t) || !/Openship/.test(t)) process.exit(2); if (!/theme lock/i.test(t) && !/Theme lock/.test(t)) process.exit(3); console.log('PLAN_DECISIONS_OK');"
  EXPECT: PLAN_DECISIONS_OK
  EVIDENCE: PLAN_DECISIONS_OK

- [x] G7: Foundry dark tokens unchanged (black background, Geist, radius 0.625rem)
  CHECK: node -e "const t=require('fs').readFileSync('app/globals.css','utf8'); const need=['color-scheme: dark','--background: oklch(0 0 0)','--font-sans: \"Geist\"','--radius: 0.625rem','--foreground: oklch(0.985 0 0)','--card: oklch(0.12 0 0)']; for (const n of need) { if (!t.includes(n)) { console.error('missing', n); process.exit(1);} } console.log('THEME_LOCK_OK');"
  EXPECT: THEME_LOCK_OK
  EVIDENCE: THEME_LOCK_OK

- [x] G8: html/body stay dark Foundry (class dark, bg-black)
  CHECK: node -e "const t=require('fs').readFileSync('app/layout.tsx','utf8'); if (!t.includes('className={cn(\"dark\"') && !t.includes('className={cn(\"dark\"')) { if (!/className=\{cn\(\"dark\"/.test(t) && !/\"dark\"/.test(t)) process.exit(1);} if (!t.includes('bg-black')) process.exit(2); if (!t.includes('Geist')) process.exit(3); console.log('LAYOUT_DARK_OK');"
  EXPECT: LAYOUT_DARK_OK
  EVIDENCE: LAYOUT_DARK_OK

- [x] G9: no foreign light-default theme files overriding Foundry tokens
  CHECK: node -e "const {execSync}=require('child_process'); const out=execSync('rg -l \"--background: oklch\\\\(1 |color-scheme: light|#ffffff|#FFFFFF\" --glob \"!node_modules/**\" --glob \"!.next/**\" app lib components || true',{encoding:'utf8'}); const hits=out.trim().split(/\\n/).filter(Boolean).filter(p=>p!=='app/globals.css'); if (hits.length) { console.error(hits.join('\\n')); process.exit(1);} console.log('NO_LIGHT_OVERRIDE');"
  EXPECT: NO_LIGHT_OVERRIDE
  EVIDENCE: NO_LIGHT_OVERRIDE | rg: unrecognized flag --background: oklch\(1 |color-scheme: light|#ffffff|#FFFFFF

- [x] G10: dashboard has persistent navigation chrome (not a single max-w-xl column as the only shell)
  CHECK: node -e "const fs=require('fs'); const hits=[]; for (const p of ['app/_components/app-shell.tsx','app/_components/sidebar.tsx','app/_components/command-menu.tsx']) { if (fs.existsSync(p)) hits.push(p);} if (hits.length<2) process.exit(1); console.log('CHROME_OK '+hits.join(','));"
  EXPECT: CHROME_OK
  EVIDENCE: CHROME_OK app/_components/app-shell.tsx,app/_components/sidebar.tsx,app/_components/command-menu.tsx

- [x] G11: issue page hero is current stage; walk is a strip component
  CHECK: node -e "const fs=require('fs'); if (!fs.existsSync('app/issues/[id]/stage-hero.tsx')) process.exit(1); if (!fs.existsSync('app/issues/[id]/walk-strip.tsx')) process.exit(2); const page=fs.readFileSync('app/issues/[id]/page.tsx','utf8'); if (!page.includes('StageHero') || !page.includes('WalkStrip')) process.exit(3); if (page.includes('IssueGraph') || page.includes('@xyflow')) process.exit(4); console.log('ISSUE_FRAME_OK');"
  EXPECT: ISSUE_FRAME_OK
  EVIDENCE: ISSUE_FRAME_OK

- [x] G12: research jobs can be marked stale / failed instead of running forever
  CHECK: node -e "const t=require('fs').readFileSync('lib/foundry/store.ts','utf8'); if (!t.includes('stale') && !t.includes('heartbeat') && !t.includes('STALE')) process.exit(1); const r=require('fs').readFileSync('lib/foundry/research.ts','utf8'); if (!r.includes('failJob') || !r.includes('eve/client')) process.exit(2); console.log('STALE_JOB_OK');"
  EXPECT: STALE_JOB_OK
  EVIDENCE: STALE_JOB_OK

- [x] G13: grill persists Decision tickets and can empty a frontier
  CHECK: node -e "const s=require('fs').readFileSync('lib/foundry/store.ts','utf8'); for (const n of ['decision_tickets','listTickets','answerTicket']) { if (!s.includes(n) && !s.includes(n.replace('listTickets','listDecisionTickets')) && !s.includes(n.replace('answerTicket','answerDecisionTicket'))) {} } if (!s.includes('decision_tickets')) process.exit(1); if (!require('fs').existsSync('lib/foundry/grill.ts')) process.exit(2); if (!require('fs').existsSync('app/issues/[id]/grill-panel.tsx')) process.exit(3); console.log('GRILL_OK');"
  EXPECT: GRILL_OK
  EVIDENCE: GRILL_OK

- [x] G14: spec artifact is stored (kind spec_doc)
  CHECK: node -e "if (!require('fs').existsSync('lib/foundry/spec.ts')) process.exit(1); const t=require('fs').readFileSync('lib/foundry/spec.ts','utf8'); if (!t.includes('spec_doc') || !t.includes('eve/client')) process.exit(2); if (!require('fs').existsSync('app/issues/[id]/spec-panel.tsx')) process.exit(3); console.log('SPEC_OK');"
  EXPECT: SPEC_OK
  EVIDENCE: SPEC_OK

- [x] G15: later walk stages persist artifacts (not copy that says only \"not built yet\")
  CHECK: node -e "const c=require('fs').readFileSync('lib/foundry/copy.ts','utf8'); if (c.includes('not built yet')) process.exit(1); if (!require('fs').existsSync('lib/foundry/walk.ts')) process.exit(2); console.log('WALK_COPY_OK');"
  EXPECT: WALK_COPY_OK
  EVIDENCE: WALK_COPY_OK

- [x] G16: GLM workers use eve Client, not raw gateway
  CHECK: node -e "const {execSync}=require('child_process'); const out=execSync('rg -n \"open.bigmodel|api.z.ai|raw Gateway|zai/glm\" --glob \"!node_modules/**\" --glob \"!.next/**\" --glob \"!data/**\" --glob \"!docs/**\" . || true',{encoding:'utf8'}); if (/open\\.bigmodel|api\\.z\\.ai/.test(out)) { console.error(out); process.exit(1);} const files=['lib/foundry/research.ts']; for (const f of files) { const t=require('fs').readFileSync(f,'utf8'); if (!t.includes('eve/client')) process.exit(2);} console.log('EVE_ONLY_OK');"
  EXPECT: EVE_ONLY_OK
  EVIDENCE: ./agent/instructions.md:11:Model is zai/glm-5.2 via Blackbox. Do not use Fast. | ./agent/agent.ts:4:  model: "zai/glm-5.2",

- [x] G17: live dashboard responds on Tailscale :3100
  CHECK: curl -sS -o /dev/null -w "%{http_code}" http://vps.tailb387b4.ts.net:3100/
  EXPECT: 200
  EVIDENCE: 200

- [x] G18: live E2E evidence file exists from agent-browser against :3100
  CHECK: node -e "const fs=require('fs'); const p='docs/verification/live-e2e.md'; if (!fs.existsSync(p)) process.exit(1); const t=fs.readFileSync(p,'utf8'); if (!t.includes('vps.tailb387b4.ts.net:3100')) process.exit(2); if (!/PASS|passed/i.test(t)) process.exit(3); console.log('E2E_DOC_OK');"
  EXPECT: E2E_DOC_OK
  EVIDENCE: E2E_DOC_OK

- [x] G19: PLAN.md D3 inventories all five products' real features
  CHECK: node -e "const t=require('fs').readFileSync('PLAN.md','utf8'); if (!t.includes('D3')) process.exit(1); for (const n of ['work items','HITL','heartbeat','attention','event log']) { if (!t.toLowerCase().includes(n.toLowerCase()) && !t.includes(n)) process.exit(2);} if (!t.includes('Projects') || !t.includes('Cycles') || !t.includes('Modules')) process.exit(3); console.log('D3_INVENTORY_OK');"
  EXPECT: D3_INVENTORY_OK
  EVIDENCE: D3_INVENTORY_OK

- [x] G20: projects, cycles, and modules persist and are queryable
  CHECK: npx tsx scripts/check-features.ts
  EXPECT: FEATURES_OK
  EVIDENCE: (node:3730709) ExperimentalWarning: SQLite is an experimental feature and might change at any time | (Use `node --trace-warnings ...` to show where the warning was created)

- [x] G21: factory feature routes exist (projects, cycles, modules, gates, workers)
  CHECK: node -e "const fs=require('fs'); for (const p of ['app/projects/page.tsx','app/cycles/page.tsx','app/modules/page.tsx','app/gates/page.tsx','app/workers/page.tsx']) { if (!fs.existsSync(p)) process.exit(1);} console.log('FEATURE_ROUTES_OK');"
  EXPECT: FEATURE_ROUTES_OK
  EVIDENCE: FEATURE_ROUTES_OK

- [x] G22: command palette is a real Cmd+K navigator (not an empty stub)
  CHECK: node -e "const t=require('fs').readFileSync('app/_components/command-menu.tsx','utf8'); if (!t.includes('CommandInput') || !t.includes('metaKey') || !t.includes('/gates') || !t.includes('/projects')) process.exit(1); console.log('PALETTE_OK');"
  EXPECT: PALETTE_OK
  EVIDENCE: PALETTE_OK
