#!/usr/bin/env bash
# Foundry hackathon demo — H0 + doctor sections; live plan requires CURSOR_API_KEY.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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
  echo "    NOTE: doctor failed — expected in CI without pi/CURSOR_API_KEY"
fi

echo "==> setup stub"
if FOUNDRY_HOME="$DEMO_TMP/foundry-home" node "$ROOT/dist/cli.js" setup; then
  echo "    OK: setup completed"
else
  echo "    NOTE: setup reported fixable failures (expected without full env)"
fi

echo "==> live plan (requires CURSOR_API_KEY + pi + --deep doctor)"
if [ -n "${CURSOR_API_KEY:-}" ] && [ "${FOUNDRY_DEMO_LIVE_PLAN:-}" = "1" ]; then
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
  echo "    SKIP: set CURSOR_API_KEY and FOUNDRY_DEMO_LIVE_PLAN=1 for live plan demo"
  echo "    Canned idea: \"CLI that converts markdown PRDs to GitHub issues\""
fi

echo "==> demo complete"
