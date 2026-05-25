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

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s "$SESSION" -c "$WORK" -- bash -l

send() {
  tmux -f /exec-daemon/tmux.portal.conf send-keys -t "$SESSION:0.0" "$1" C-m
  sleep 0.6
}

capture() {
  tmux -f /exec-daemon/tmux.portal.conf capture-pane -pt "$SESSION:0.0" -S -200 | tail -n 120
}

echo "==> harness session $SESSION in $WORK"

send "node \"$CLI\" --version"
send "node \"$CLI\" --help"
send "mkdir -p project && cd project"
send "FOUNDRY_HOME=\"$WORK/home\" node \"$CLI\" init"
send "FOUNDRY_HOME=\"$WORK/home\" node \"$CLI\" doctor --for plan"
send "FOUNDRY_HOME=\"$WORK/home\" node \"$CLI\" status"

OUT="$(capture)"
echo "$OUT"

echo "$OUT" | grep -qE 'Foundry v|foundry@|0\.1\.0' || { echo 'FAIL: missing version output'; exit 1; }
echo "$OUT" | grep -qiE 'foundry doctor|doctor \(for=' || { echo 'FAIL: doctor did not run'; exit 1; }
echo "$OUT" | grep -qiE 'project initialized|config\.toml' || { echo 'FAIL: init did not run'; exit 1; }

echo "==> cli-harness OK"
