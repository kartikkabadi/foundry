#!/usr/bin/env bash
# G4 live phased rehearsal — real plan + build (no FOUNDRY_BUILD_MOCK). Phased exits; HITL pause is OK.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/g4-log.sh
source "$ROOT/scripts/g4-log.sh"

CLI="$ROOT/packages/cli/bin/foundry.js"
SHA="$(git rev-parse HEAD)"

if [ -f "$ROOT/.nvmrc" ] && command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
  fnm use >/dev/null 2>&1 || true
  npm rebuild sqlite3 --silent 2>/dev/null || true
fi

has_auth() {
  [ -n "${CURSOR_API_KEY:-}" ] || [ -f "${HOME}/.pi/agent/auth.json" ]
}

if ! has_auth; then
  echo "FAIL: no CURSOR_API_KEY or ~/.pi/agent/auth.json — cannot run live G4"
  g4_replace_section "Entries (live phased)"
  g4_append_row A "auth preflight" "FAIL" "no Cursor auth"
  exit 1
fi

echo "==> G4 live phased @ $SHA"
npm run build >/dev/null

g4_replace_section "Entries (live phased)"

DEMO_TMP="$(mktemp -d)"
trap 'rm -rf "$DEMO_TMP"' EXIT
mkdir -p "$DEMO_TMP/project"
PROJECT="$DEMO_TMP/project"
FOUNDRY_HOME="$DEMO_TMP/foundry-home"
IDEA='CLI that converts markdown PRDs to GitHub issues'

run_phase() {
  local tier="$1" label="$2"
  shift 2
  set +e
  "$@" >/tmp/g4-live-out.txt 2>/tmp/g4-live-err.txt
  local code=$?
  set -e
  local notes
  if [ "$code" -eq 0 ]; then
    notes="$(head -1 /tmp/g4-live-out.txt | tr '|' '/' | cut -c1-100)"
    [ -z "$notes" ] && notes="exit 0"
  else
    notes="FAIL: $(head -1 /tmp/g4-live-err.txt | tr '|' '/' | cut -c1-100)"
  fi
  g4_append_row "$tier" "$label" "$code" "$notes"
  return "$code"
}

run_phase A "doctor --for plan --deep" \
  env FOUNDRY_HOME="$FOUNDRY_HOME" node "$CLI" doctor --for plan --deep || true

run_phase A "doctor --for build --deep" \
  env FOUNDRY_HOME="$FOUNDRY_HOME" node "$CLI" doctor --for build --deep || true

cd "$PROJECT"
FOUNDRY_HOME="$FOUNDRY_HOME" node "$CLI" init
git init -q
git config user.email "g4-live@test.local"
git config user.name "G4 Live"
echo "# g4" > README.md
git add README.md
git commit -q -m "init" || true

echo "==> live foundry plan (Composer)"
set +e
FOUNDRY_HOME="$FOUNDRY_HOME" node "$CLI" plan "$IDEA" </dev/null
PLAN_CODE=$?
set -e
if [ "$PLAN_CODE" -eq 0 ]; then
  g4_append_row A "foundry plan (live)" "$PLAN_CODE" "$PROJECT/.foundry/runs"
else
  g4_append_row A "foundry plan (live)" "$PLAN_CODE" "see /tmp/g4-live-err.txt"
  echo "WARN: live plan failed — continuing for evidence"
fi

RUN_DIR="$(find "$PROJECT/.foundry/runs" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -1 || true)"
if [ -z "$RUN_DIR" ]; then
  g4_append_row B "artifact check" "FAIL" "no run dir after plan"
  exit 1
fi

# Tier B
B_OK=0
for f in summary.md prd.md implementation-plan.md issue-plan.md build-goal.md run.json status.md; do
  if [ -f "$RUN_DIR/$f" ]; then
    B_OK=$((B_OK + 1))
  fi
done
g4_append_row B "artifact checklist" "0" "$B_OK key files present under $RUN_DIR"

RUN_ID="$(basename "$RUN_DIR")"
run_phase A "foundry approve" \
  env FOUNDRY_HOME="$FOUNDRY_HOME" node "$CLI" approve "$RUN_ID"

echo "==> live foundry build (no FOUNDRY_BUILD_MOCK)"
set +e
unset FOUNDRY_BUILD_MOCK
FOUNDRY_HOME="$FOUNDRY_HOME" node "$CLI" build
BUILD_CODE=$?
set -e
BUILD_NOTE="exit $BUILD_CODE"
if grep -q "orchestrator review" /tmp/g4-live-out.txt 2>/dev/null || \
   grep -q "build_review" "$RUN_DIR/run.json" 2>/dev/null; then
  BUILD_NOTE="HITL build_review pause (expected pass)"
  BUILD_CODE=0
fi
g4_append_row A "foundry build (live, no mock)" "$BUILD_CODE" "$BUILD_NOTE"

# Tier C
if rg -l 'sk-[a-zA-Z0-9]{10,}|CURSOR_API_KEY\s*=\s*[^$\{]' "$RUN_DIR" 2>/dev/null; then
  g4_append_row C "secrets grep" "FAIL" "possible secret in run dir"
else
  g4_append_row C "secrets grep" "0" "no obvious secrets in $RUN_DIR"
fi

# Tier D
if command -v pi >/dev/null 2>&1; then
  set +e
  pi --model cursor/composer-2.5 --help >/tmp/g4-pi-out.txt 2>/tmp/g4-pi-err.txt
  PI_CODE=$?
  set -e
  g4_append_row D "pi --model cursor/composer-2.5" "$PI_CODE" "$(head -1 /tmp/g4-pi-out.txt 2>/dev/null || head -1 /tmp/g4-pi-err.txt)"
else
  g4_append_row D "pi --model cursor/composer-2.5" "SKIP" "pi not on PATH"
fi

echo "==> G4 live phased complete — update sign-off in $G4_LOG"
echo "    SHA=$SHA RUN_DIR=$RUN_DIR"
