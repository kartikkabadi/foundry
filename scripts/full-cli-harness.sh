#!/usr/bin/env bash
# Exhaustive non-interactive CLI harness — all dispatch commands with deterministic env.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "${NVM_DIR:-$HOME/.nvm}/nvm.sh" 2>/dev/null && nvm use 20 >/dev/null 2>&1 || true

npm run build >/dev/null
CLI="$ROOT/packages/cli/bin/foundry.js"
WORK="$(mktemp -d)"
PROJECT="$WORK/project"
export FOUNDRY_HOME="$WORK/home"
mkdir -p "$PROJECT"

LIVE_READY=0
if [ -n "${CURSOR_API_KEY:-}" ]; then
  LIVE_READY=1
fi

run() {
  echo ""
  echo "==> $*"
  (cd "$PROJECT" && node "$CLI" "$@")
}

# Doctor may exit 1 without Pi/Cursor credentials (expected in CI); require pass when LIVE_READY.
run_doctor() {
  echo ""
  echo "==> doctor $*"
  set +e
  OUT="$(cd "$PROJECT" && node "$CLI" doctor "$@")"
  EC=$?
  set -e
  echo "$OUT"
  echo "$OUT" | grep -q 'Foundry doctor' || fail 'doctor produced no report'
  if [ "$LIVE_READY" = 1 ] && [ "$EC" -ne 0 ]; then
    fail "doctor exited $EC with CURSOR_API_KEY set"
  fi
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "==> full-cli-harness in $WORK"

# Tier A — baseline
node "$CLI" --version | grep -q '0.1.0' || fail 'version'
node "$CLI" --help | grep -qi 'foundry' || fail 'help'

# init (no team pack here — governed handoffs block mock build without agent-published files)
run init
test -f "$PROJECT/.foundry/config.toml" || fail 'config.toml'

echo "==> init --team (team pack load only)"
TEAM_WORK="$(mktemp -d)"
mkdir -p "$TEAM_WORK/proj"
(cd "$TEAM_WORK/proj" && FOUNDRY_HOME="$FOUNDRY_HOME" node "$CLI" init --team "$ROOT/fixtures/team-pack-valid.toml") \
  | grep -q 'team:' || fail 'team pack init'

# doctor variants
run_doctor --for plan
run_doctor --for setup
run_doctor --for build
JSON_DOC="$(cd "$PROJECT" && node "$CLI" doctor --json --for plan 2>&1)" || true
echo "$JSON_DOC" | grep -q '"checks"' || fail 'doctor json'
run_doctor --deep --for plan

# fixture plan (mock composer via script — not foundry plan CLI)
echo "==> fixture plan smoke"
(cd "$ROOT" && FOUNDRY_HOME="$FOUNDRY_HOME" npx tsx scripts/fixture-plan-smoke.ts "$PROJECT")
RUN_DIR="$(ls -1 "$PROJECT/.foundry/runs" | head -1)"
RUN_PATH="$PROJECT/.foundry/runs/$RUN_DIR"
test -f "$RUN_PATH/summary.md" || fail 'summary.md'
test -f "$RUN_PATH/comms/events.jsonl" || fail 'events.jsonl'

# status — fixture ends awaiting_approval
run status

# pause only applies to active runs; awaiting_approval should reject cleanly
echo "==> pause (expect no active run)"
set +e
(cd "$PROJECT" && node "$CLI" pause)
PAUSE_EC=$?
set -e
if [ "$PAUSE_EC" -ne 1 ]; then
  fail "pause should exit 1 when latest run is awaiting_approval (got $PAUSE_EC)"
fi

run approve

# publish local drafts
run publish --run-dir "$RUN_PATH"
test -d "$RUN_PATH/issues" || fail 'issue drafts'

# build mock path (requires git for worktrees)
(
  cd "$PROJECT"
  git init -q
  git config user.email 'harness@foundry.local'
  git config user.name 'Harness'
  echo '# harness' > README.md
  git add README.md
  git commit -q -m 'harness init'
)
export FOUNDRY_BUILD_MOCK=1
run build --dry-run
run build

# post-v1 commands
run tui
run daemon start
run daemon status
run daemon stop
run notify --dry-run --event approval_waiting --channel http
run update --dry-run | grep -q 'foundry' || fail 'update dry-run'

# Live plan when Cursor key present (deep budget; resume through checkpoints)
if [ -n "${CURSOR_API_KEY:-}" ]; then
  echo "==> live plan (deep budget, resume checkpoints)"
  (
    cd "$PROJECT"
    set +e
    node "$CLI" plan "Harness smoke: markdown to issues CLI" --budget deep 2>&1 | tail -8
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      node "$CLI" status 2>&1 | grep -q 'awaiting_approval' && break
      node "$CLI" status 2>&1 | grep -q 'Status: complete' && break
      node "$CLI" resume 2>&1 | tail -3
    done
    set -e
    node "$CLI" status 2>&1 | grep -qE 'awaiting_approval|complete' || fail 'live plan did not finish'
  )
else
  echo "SKIP: live plan (no CURSOR_API_KEY)"
fi

# secrets grep gate
if grep -rE 'CURSOR_API_KEY|sk-[a-zA-Z0-9]{20,}' "$PROJECT/.foundry/runs" 2>/dev/null; then
  fail 'secrets leaked into run artifacts'
fi

echo ""
echo "==> full-cli-harness OK"
