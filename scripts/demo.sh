#!/usr/bin/env bash
# Foundry hackathon demo skeleton — H0 section must pass; later phases may fail until shipped.
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

echo "==> Phase 2+ (doctor) — may fail until Issue #2"
if FOUNDRY_HOME="$DEMO_TMP/foundry-home" node "$ROOT/dist/cli.js" doctor --for plan; then
  echo "    OK: doctor --for plan passed"
else
  echo "    SKIP: doctor not implemented yet (expected in H1–2)"
fi

echo "==> Phase 5+ (plan artifacts) — may fail until Issue #6"
PLAN_ID="demo-run"
PLAN_DIR=".foundry/runs/$PLAN_ID"
for artifact in summary.md prd.md implementation-plan.md issue-plan.md build-goal.md intent.md autonomy-contract.md; do
  if test -f "$PLAN_DIR/$artifact"; then
    echo "    OK: $artifact"
  else
    echo "    SKIP: $PLAN_DIR/$artifact (plan mode not shipped)"
  fi
done

echo "==> demo skeleton complete"
