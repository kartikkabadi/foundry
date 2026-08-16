# Gates: 1.4.3.2.1 Mid-walk UI

Scope: Improve, plan pack, council, architecture as real stored artifacts.

- [x] G1: mid-walk panel exists
  CHECK: test -f app/issues/[id]/mid-walk-panel.tsx && echo MID_PANEL_OK
  EXPECT: MID_PANEL_OK
  EVIDENCE: MID_PANEL_OK

- [x] G2: names those four stages
  CHECK: node -e "const t=require('fs').readFileSync('app/issues/[id]/mid-walk-panel.tsx','utf8'); for (const s of ['improve','plan_pack','council','architecture']) { if (!t.includes(s)) process.exit(1);} console.log('MID_STAGES_OK');"
  EXPECT: MID_STAGES_OK
  EVIDENCE: MID_STAGES_OK
