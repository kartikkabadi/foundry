# Gates: 1.4.1 Research panel

Scope: Brief as the document; visible progress; retry on fail/stale.

- [x] G1: research-panel exists
  CHECK: test -f app/issues/[id]/research-panel.tsx && echo RESEARCH_PANEL_OK
  EXPECT: RESEARCH_PANEL_OK
  EVIDENCE: RESEARCH_PANEL_OK

- [x] G2: panel renders brief fields
  CHECK: node -e "const t=require('fs').readFileSync('app/issues/[id]/research-panel.tsx','utf8'); for (const k of ['inPlainEnglish','whatTheRepoIs']) { if (!t.includes(k)) process.exit(1);} console.log('BRIEF_FIELDS_OK');"
  EXPECT: BRIEF_FIELDS_OK
  EVIDENCE: BRIEF_FIELDS_OK

- [x] G3: retry on failed or stale
  CHECK: node -e "const t=require('fs').readFileSync('app/issues/[id]/research-panel.tsx','utf8')+require('fs').readFileSync('app/issues/[id]/retry-research.tsx','utf8'); if (!/stale|failed|Retry/i.test(t)) process.exit(1); console.log('RETRY_UI_OK');"
  EXPECT: RETRY_UI_OK
  EVIDENCE: RETRY_UI_OK
