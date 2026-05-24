#!/usr/bin/env bash
# G4 batch verification — automated tiers (no live Composer plan/build unless keys present).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
CLI="$ROOT/packages/cli/bin/foundry.js"
LOG="$ROOT/docs/superpowers/specs/2026-05-26-live-verification-log.md"
SHA="$(git rev-parse HEAD)"
NODE_V="$(node -v)"

append_row() {
  local tier="$1" cmd="$2" exit_code="$3" notes="$4"
  printf '| %s | `%s` | %s | %s |\n' "$tier" "$cmd" "$exit_code" "$notes" >> "$LOG"
}

run_cmd() {
  local tier="$1"
  local label="$2"
  shift 2
  set +e
  "$@" >/tmp/g4-out.txt 2>/tmp/g4-err.txt
  local code=$?
  set -e
  local notes="stdout+stderr captured"
  if [ "$code" -ne 0 ]; then
    notes="FAIL: $(head -1 /tmp/g4-err.txt | tr '|' '/')"
  fi
  append_row "$tier" "$label" "$code" "$notes"
  return 0
}

echo "==> G4 batch @ $SHA (Node $NODE_V)"

# Ensure table section exists
if ! grep -q '^| A |' "$LOG" 2>/dev/null; then
  cat >> "$LOG" <<EOF

## Entries (automated batch $(date -u +%Y-%m-%dT%H:%MZ))

| Tier | Command | Exit | Artifacts / notes |
|------|---------|------|-------------------|
EOF
fi

run_cmd E "npm test" npm test
run_cmd E "scripts/demo.sh" bash scripts/demo.sh
run_cmd E "scripts/demo-build.sh" bash scripts/demo-build.sh
run_cmd A "foundry --version" node "$CLI" --version
run_cmd A "foundry --help" node "$CLI" --help
run_cmd A "doctor --json --for plan" node "$CLI" doctor --json --for plan
run_cmd A "doctor --json --for build" node "$CLI" doctor --json --for build

DEMO_TMP="$(mktemp -d)"
trap 'rm -rf "$DEMO_TMP"' EXIT
mkdir -p "$DEMO_TMP/project"
run_cmd A "foundry init" bash -c "cd '$DEMO_TMP/project' && FOUNDRY_HOME='$DEMO_TMP/home' node '$CLI' init"

if [ -n "${CURSOR_API_KEY:-}" ] || [ -f "${HOME}/.pi/agent/auth.json" ]; then
  echo "    Cursor auth detected — live plan/build rows require manual run per LIVE_VERIFICATION.md"
  append_row A "foundry plan (live)" "SKIP" "auth present; run manually in isolated worktree"
  append_row A "foundry build (live, no mock)" "SKIP" "run after approve; FOUNDRY_BUILD_MOCK unset"
else
  append_row A "foundry plan (live)" "SKIP" "no CURSOR_API_KEY or Pi auth"
  append_row A "foundry build (live)" "SKIP" "no Cursor auth"
fi

append_row D "pi-cursor-sdk smoke" "SKIP" "manual: pi --model cursor/composer-2.5"
append_row C "secrets grep .foundry/runs" "SKIP" "run after live plan in worktree"

echo "==> G4 batch appended to $LOG"
