#!/usr/bin/env bash
# Control-CLI harness: deterministic tmux session exercising foundry commands.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm run build >/dev/null

CLI="$ROOT/packages/cli/bin/foundry.js"
SESSION="foundry-cli-harness-$$"
WORK="$(mktemp -d)"
trap 'tmux kill-session -t "$SESSION" 2>/dev/null || true; rm -rf "$WORK"' EXIT

TMUX_CMD=(tmux)
if [ -f /exec-daemon/tmux.portal.conf ]; then
  TMUX_CMD=(tmux -f /exec-daemon/tmux.portal.conf)
fi

"${TMUX_CMD[@]}" new-session -d -s "$SESSION" -c "$WORK" -- bash -l

send() {
  "${TMUX_CMD[@]}" send-keys -t "$SESSION:0.0" "$1" C-m
}

capture() {
  "${TMUX_CMD[@]}" capture-pane -pt "$SESSION:0.0" -S -200
}

wait_for() {
  local pattern="$1"
  local label="$2"
  for _ in $(seq 1 80); do
    local out
    out="$(capture)"
    if [[ "$out" =~ $pattern ]]; then
      return 0
    fi
    sleep 0.25
  done
  echo "FAIL: timed out waiting for $label"
  capture
  exit 1
}

echo "==> harness session $SESSION in $WORK"

send "node \"$CLI\" --version"
wait_for '0\.1\.0' "version output"
send "node \"$CLI\" --help"
wait_for 'Usage: foundry <command>' "help output"
send "mkdir -p project && cd project"
wait_for 'project \$' "project shell prompt"
send "FOUNDRY_HOME=\"$WORK/home\" node \"$CLI\" init"
wait_for 'project initialized|config\.toml' "init output"
send "FOUNDRY_HOME=\"$WORK/home\" node \"$CLI\" doctor --for plan"
wait_for 'Foundry doctor \(for=plan\)' "doctor output"
send "FOUNDRY_HOME=\"$WORK/home\" node \"$CLI\" status"
wait_for 'No runs yet|Run .* \(' "status output"

OUT="$(capture)"
echo "$OUT"

[[ "$OUT" =~ Foundry\ v|foundry@|0\.1\.0 ]] || { echo 'FAIL: missing version output'; exit 1; }
[[ "$OUT" =~ Foundry\ doctor|doctor\ \(for= ]] || { echo 'FAIL: doctor did not run'; exit 1; }
[[ "$OUT" =~ project\ initialized|config\.toml ]] || { echo 'FAIL: init did not run'; exit 1; }

echo "==> cli-harness OK"
