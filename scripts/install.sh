#!/usr/bin/env bash
# Minimal Foundry install from GitHub (Issue #8 hackathon subset).
set -euo pipefail

REPO="${FOUNDRY_INSTALL_REPO:-https://github.com/kartikkabadi/foundry.git}"
BRANCH="${FOUNDRY_INSTALL_BRANCH:-hackathon/integration}"
INSTALL_DIR="${FOUNDRY_INSTALL_DIR:-${HOME}/.local/share/foundry}"

echo "Installing Foundry from ${REPO} (${BRANCH}) into ${INSTALL_DIR}"

if [ ! -d "$INSTALL_DIR/.git" ]; then
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$INSTALL_DIR"
else
  git -C "$INSTALL_DIR" fetch origin "$BRANCH" --depth 1
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" || true
fi

cd "$INSTALL_DIR"

if [ -f .nvmrc ] && command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
  fnm install
  fnm use
fi

if command -v sfw >/dev/null 2>&1; then
  sfw npm ci
else
  npm ci
fi

npm rebuild sqlite3 2>/dev/null || true
npm run build

if command -v npm >/dev/null 2>&1; then
  npm link
fi

echo ""
echo "Foundry installed. Verify with:"
echo "  foundry --version"
echo "  foundry doctor --for plan"
echo ""
echo "Set CURSOR_API_KEY or configure Cursor in Pi (~/.pi/agent/auth.json)."
