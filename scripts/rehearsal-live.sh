#!/usr/bin/env bash
# Live demo rehearsal — requires Pi Cursor key (env or ~/.pi/agent/auth.json) and pi CLI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/.nvmrc" ] && command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
  fnm use >/dev/null 2>&1 || true
fi

echo "==> rebuild native deps (sqlite3 for @cursor/sdk)"
sfw npm rebuild sqlite3 2>/dev/null || npm rebuild sqlite3 2>/dev/null || true

echo "==> build"
npm run build

export FOUNDRY_DEMO_LIVE_PLAN=1

CLI="$ROOT/packages/cli/bin/foundry.js"

echo "==> doctor --for plan --deep (live Composer smoke)"
node "$CLI" doctor --for plan --deep

echo "==> live plan"
IDEA='CLI that converts markdown PRDs to GitHub issues'
node "$CLI" plan "$IDEA"

echo "==> rehearsal complete"
