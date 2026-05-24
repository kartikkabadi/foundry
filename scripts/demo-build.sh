#!/usr/bin/env bash
# Foundry V3 end-to-end build fixture — plan → approve → build → proofs (CI-safe).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/.nvmrc" ] && command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
  fnm use >/dev/null 2>&1 || true
fi

echo "==> build"
npm run build

DEMO_TMP="$(mktemp -d)"
trap 'rm -rf "$DEMO_TMP"' EXIT

echo "==> fixture plan smoke"
mkdir -p "$DEMO_TMP/project"
FOUNDRY_HOME="$DEMO_TMP/foundry-home" npx tsx "$ROOT/scripts/fixture-plan-smoke.ts" "$DEMO_TMP/project"

cd "$DEMO_TMP/project"
git init -q
git config user.email "foundry-demo@test.local"
git config user.name "Foundry Demo"
git add .
git commit -q -m "init" || true
RUN_DIR="$(find .foundry/runs -mindepth 1 -maxdepth 1 -type d | head -1)"
RUN_DIR_ABS="$(cd "$RUN_DIR" && pwd)"

echo "==> foundry approve"
FOUNDRY_HOME="$DEMO_TMP/foundry-home" node "$ROOT/packages/cli/bin/foundry.js" approve --run-dir "$RUN_DIR" 2>/dev/null || \
  FOUNDRY_HOME="$DEMO_TMP/foundry-home" node "$ROOT/packages/cli/bin/foundry.js" approve

echo "==> foundry build --dry-run"
FOUNDRY_HOME="$DEMO_TMP/foundry-home" node "$ROOT/packages/cli/bin/foundry.js" build --dry-run

echo "==> foundry build (mock worker — FOUNDRY_BUILD_MOCK=1)"
FOUNDRY_BUILD_MOCK=1 FOUNDRY_HOME="$DEMO_TMP/foundry-home" node "$ROOT/packages/cli/bin/foundry.js" build

test -d "$RUN_DIR/proofs"
PROOF_COUNT="$(find "$RUN_DIR/proofs" -name '*.json' | wc -l | tr -d ' ')"
test "$PROOF_COUNT" -ge 1
echo "    OK: $PROOF_COUNT proof(s) recorded"

RUN_STATUS="$(node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log(r.status)" "$RUN_DIR_ABS/run.json")"
test "$RUN_STATUS" = "complete" -o "$RUN_STATUS" = "running"
echo "    OK: build run status=$RUN_STATUS"

echo "==> live build (requires Cursor key + pi + --deep doctor)"
if [ -n "${CURSOR_API_KEY:-}" ] || [ -f "${HOME}/.pi/agent/auth.json" ]; then
  if [ "${FOUNDRY_DEMO_LIVE_BUILD:-}" = "1" ]; then
    echo "    SKIP in CI: live build opt-in only"
  else
    echo "    SKIP: set FOUNDRY_DEMO_LIVE_BUILD=1 for live build demo"
  fi
else
  echo "    SKIP: set CURSOR_API_KEY or Pi cursor auth + FOUNDRY_DEMO_LIVE_BUILD=1"
fi

echo "==> demo-build complete"
