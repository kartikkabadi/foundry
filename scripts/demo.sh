#!/usr/bin/env bash
# Foundry hackathon demo — CI-safe skeleton + optional live plan.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/.nvmrc" ] && command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
  fnm use >/dev/null 2>&1 || true
fi

echo "==> rebuild sqlite3 (optional, for live @cursor/sdk)"
npm rebuild sqlite3 --silent 2>/dev/null || true

echo "==> build"
npm run build

DEMO_TMP="$(mktemp -d)"
trap 'rm -rf "$DEMO_TMP"' EXIT

echo "==> H0: foundry init layout"
mkdir -p "$DEMO_TMP/project"
cd "$DEMO_TMP/project"
git init -q
FOUNDRY_HOME="$DEMO_TMP/foundry-home" node "$ROOT/dist/cli.js" init
test -f .foundry/config.toml
test -d .foundry/runs
echo "    OK: .foundry/config.toml + runs/ exist"

echo "==> doctor --for plan (CI-safe; composer smoke skipped without --deep)"
if FOUNDRY_HOME="$DEMO_TMP/foundry-home" node "$ROOT/dist/cli.js" doctor --for plan; then
  echo "    OK: doctor --for plan passed (or warn-only for missing optional deps)"
else
  echo "    NOTE: doctor failed — expected in CI without pi/Cursor key"
fi

echo "==> setup doctor loop (non-interactive exits on failures)"
if [ -t 0 ]; then
  FOUNDRY_HOME="$DEMO_TMP/foundry-home" node "$ROOT/dist/cli.js" setup || true
else
  echo "    SKIP: non-TTY (CI) — setup loop requires interactive terminal"
fi

echo "==> publish local drafts from fixture issue-plan"
RUN_DIR="$DEMO_TMP/project/.foundry/runs/demo-run"
mkdir -p "$RUN_DIR"
cat > "$RUN_DIR/issue-plan.md" <<'EOF'
## Issue 1: Demo issue

Acceptance criteria for demo.

## Issue 2: Second demo issue

More AC.
EOF
FOUNDRY_HOME="$DEMO_TMP/foundry-home" node "$ROOT/dist/cli.js" publish --run-dir "$RUN_DIR"
test -f "$RUN_DIR/issues/issue-01.md"
echo "    OK: local issue drafts generated"

echo "==> live plan (requires Cursor key + pi + --deep doctor)"
if [ -n "${CURSOR_API_KEY:-}" ] || [ -f "${HOME}/.pi/agent/auth.json" ]; then
  if [ "${FOUNDRY_DEMO_LIVE_PLAN:-}" = "1" ]; then
    IDEA='CLI that converts markdown PRDs to GitHub issues'
    FOUNDRY_HOME="$DEMO_TMP/foundry-home" node "$ROOT/dist/cli.js" plan "$IDEA"
    PLAN_DIR="$(find .foundry/runs -mindepth 1 -maxdepth 1 -type d | head -1)"
    for artifact in run.json status.md intake.md research.md intent.md summary.md prd.md implementation-plan.md issue-plan.md build-goal.md algorithm-pass.md autonomy-contract.md; do
      test -f "$PLAN_DIR/$artifact"
      echo "    OK: $artifact"
    done
    if grep -r "CURSOR_API_KEY" "$PLAN_DIR" 2>/dev/null; then
      echo "    FAIL: secrets found in run artifacts"
      exit 1
    fi
    echo "    OK: live plan artifacts present, no secrets leaked"
  else
    echo "    SKIP: set FOUNDRY_DEMO_LIVE_PLAN=1 for live plan demo"
  fi
else
  echo "    SKIP: set CURSOR_API_KEY or Pi cursor auth + FOUNDRY_DEMO_LIVE_PLAN=1"
fi
echo "    Canned idea: \"CLI that converts markdown PRDs to GitHub issues\""

echo "==> demo complete"
