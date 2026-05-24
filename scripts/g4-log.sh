#!/usr/bin/env bash
# Shared helpers for G4 evidence log (source from other scripts).
G4_LOG="${G4_LOG:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/docs/superpowers/specs/2026-05-26-live-verification-log.md}"

g4_append_row() {
  local tier="$1" cmd="$2" exit_code="$3" notes="$4"
  printf '| %s | `%s` | %s | %s |\n' "$tier" "$cmd" "$exit_code" "$notes" >> "$G4_LOG"
}

g4_replace_section() {
  local marker="$1"
  local tmp
  tmp="$(mktemp)"
  while grep -q "^## ${marker}" "$G4_LOG" 2>/dev/null; do
    awk -v marker="## ${marker}" '
      index($0, marker) == 1 { skip=1; next }
      /^## / && skip { skip=0 }
      !skip { print }
    ' "$G4_LOG" > "$tmp"
    mv "$tmp" "$G4_LOG"
  done
  {
    echo ""
    echo "## ${marker} $(date -u +%Y-%m-%dT%H:%MZ)"
    echo ""
    echo "| Tier | Command | Exit | Artifacts / notes |"
    echo "|------|---------|------|-------------------|"
  } >> "$G4_LOG"
}
