#!/usr/bin/env bash
# Post one tweet from the desktop pack, with the card pre-warmed.
#
# X's card crawler gives the OG image 2-3 seconds. The first render of a cold card takes ~3s, so the
# tweet used to go out and the card came back broken. This warms the exact card being linked, checks
# that it now answers fast, and only then drives the browser.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BUN="${BUN:-$HOME/.bun/bin/bun}"
TEXT="${1:-/mnt/c/Users/Administrator/Desktop/PredictionArena_Marketing/01-main-tweet.txt}"

MARKET=$(grep -oE '/market/[0-9]+' "$TEXT" | head -1 | tr -dc '0-9')
if [[ -n "$MARKET" ]]; then
  echo "warming card for market $MARKET"
  "$BUN" scripts/warm-og.ts --market="$MARKET" | tail -2
fi

powershell.exe -NoProfile -STA -ExecutionPolicy Bypass \
  -File "C:\\Users\\Administrator\\prediction-arena\\scripts\\x_post_gui.ps1" \
  -TextFile "$(wslpath -w "$TEXT")"
