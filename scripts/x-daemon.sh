#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# X funnel daemon — one post a day, only when the desk is idle.
#
# The desktop is the boss's machine, so the rule is: never touch it while he is using it. Every five
# minutes this loop asks Windows two questions — is the session locked, and has there been input in
# the last five minutes — and only when both answers are "safe" does it post the day's funnel tweet
# through the UIA poster (no pixel guessing, no window stealing while typing).
#
# One post per day, tracked in .data/x-daemon-state.json. The copy comes from
# .data/daily-funnel.txt, which the marketing engine refreshes every six hours.
#
#   bash scripts/x-daemon.sh            # foreground (cron/@reboot keeps it alive)
#   tail -f logs/x-daemon.log
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
LOG="logs/x-daemon.log"
STATE=".data/x-daemon-state.json"
COPY=".data/daily-funnel.txt"
POSTER="C:\\Users\\Administrator\\prediction-arena\\scripts\\x-poster.ps1"
COPY_WIN="C:\\Users\\Administrator\\prediction-arena\\.data\\daily-funnel.txt"
IDLE_REQUIRED="${IDLE_REQUIRED:-120}"   # seconds of no input before we are allowed to type
mkdir -p logs .data
say() { echo "[$(date -Is)] $*" >>"$LOG"; }

# Single instance (flock: the pgrep variant matches the wrapper that launched it).
exec 9>".data/x-daemon.lock"
if ! flock -n 9; then
  # Same trap as the marketing engine: a killed daemon leaves a child `sleep` holding the inherited
  # lock fd, and then every cron tick says "already running" while nothing posts. Reclaim only when
  # the holder is that orphaned sleep, never when it is a live daemon.
  HOLDER="$(fuser ".data/x-daemon.lock" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' | head -1)"
  if [[ -n "${HOLDER:-}" ]] && ps -o cmd= -p "$HOLDER" 2>/dev/null | grep -q '^sleep '; then
    say "reclaiming stale lock from orphaned sleep pid=$HOLDER"
    kill "$HOLDER" 2>/dev/null || true
    sleep 1
  fi
  if ! flock -n 9; then echo "x daemon already running"; exit 0; fi
fi
trap 'pkill -P $$ 2>/dev/null; exit 0' TERM INT

say "x daemon start pid=$$ (idle≥${IDLE_REQUIRED}s)"

while true; do
  TODAY="$(date +%F)"
  POSTED="$(bun -e 'try{console.log(require("./.data/x-daemon-state.json").lastPosted ?? "")}catch{console.log("")}' 2>/dev/null || echo "")"
  if [[ "$POSTED" == "$TODAY" ]]; then
    sleep 900
    continue
  fi
  if [[ ! -s "$COPY" ]]; then
    say "no copy at $COPY — waiting"
    sleep 900
    continue
  fi

  READY="$(powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\Users\\Administrator\\prediction-arena\\scripts\\desk-ready.ps1" -IdleRequired "$IDLE_REQUIRED" 2>/dev/null | tr -d '\r' | grep -E '^(ready|busy|locked|unknown)$' | tail -1)"

  if [[ -z "$READY" ]]; then
    say "skip: desk-ready.ps1 returned nothing (powershell failure) — not touching the desk"
    sleep 120
    continue
  fi

  if [[ "$READY" != "ready" ]]; then
    say "skip: $READY"
    sleep 120
    continue
  fi

  say "posting daily funnel (desk idle)"
  OUT="$(powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "$POSTER" -TextFile "$COPY_WIN" 2>&1 | tr -d '\r' | tail -3)"
  say "poster: $OUT"
  if echo "$OUT" | grep -q "posted_attempted"; then
    bun -e "require('node:fs').writeFileSync('.data/x-daemon-state.json', JSON.stringify({lastPosted: '$TODAY', at: new Date().toISOString()}, null, 2) + '\n')"
    say "marked posted for $TODAY"
    # verify the composer is gone (the poster returns 'done' only when the InvokePattern fired)
    sleep 60
  fi
  sleep 1800
done
