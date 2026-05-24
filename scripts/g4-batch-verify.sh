#!/usr/bin/env bash
# G4 batch verification — automated tiers (Tier E + non-live Tier A).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/g4-log.sh
source "$ROOT/scripts/g4-log.sh"

CLI="$ROOT/packages/cli/bin/foundry.js"
SHA="$(git rev-parse HEAD)"
NODE_V="$(node -v)"

# Use active Node (CI: setup-node + .nvmrc + npm rebuild sqlite3). Do not fnm-switch here —
# switching ABI without rebuild breaks sqlite3 and flakes cursor-adapter tests.

run_cmd() {
  local tier="$1"
  local label="$2"
  shift 2
  set +e
  "$@" >/tmp/g4-out.txt 2>/tmp/g4-err.txt
  local code=$?
  set -e
  local notes="ok"
  if [ "$code" -ne 0 ]; then
    notes="FAIL: $(head -1 /tmp/g4-err.txt | tr '|' '/' | cut -c1-120)"
  fi
  g4_append_row "$tier" "$label" "$code" "$notes"
}

echo "==> G4 batch @ $SHA (Node $NODE_V)"
g4_replace_section "Entries (automated batch)"

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

echo "==> Live plan/build: run scripts/g4-live-rehearsal.sh when auth present"
g4_append_row A "foundry plan (live)" "—" "see Entries (live phased)"
g4_append_row A "foundry build (live)" "—" "see Entries (live phased)"
g4_append_row D "pi-cursor-sdk smoke" "—" "see Entries (live phased)"
g4_append_row C "secrets grep" "—" "see Entries (live phased)"

echo "==> G4 batch wrote $G4_LOG"
