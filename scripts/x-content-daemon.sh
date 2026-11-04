#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# X content daemon — four scheduled posts a day, all of them typed by a human-signed-in browser.
#
#   09:00  the board        three markets, both prices, no link      (.data/content/<day>-09-board.txt)
#   12:00  the funnel       the airdrop/three-step post              (.data/daily-funnel.txt)
#   15:00  build in public  what broke today and what it cost        (.data/content/<day>-15-build.txt)
#   21:00  the question     one contrarian prompt, link in the post  (.data/content/<day>-21-question.txt)
#
# Why a schedule instead of "post when idle": the desk gate is a safety rail, not a cadence. With the
# gate alone the account posted once a day at a random hour; the research is unambiguous that cadence
# and the 21:00 slot matter more than any single post.
#
# The gate still applies: nothing is typed while the desk is busy, and a slot that misses its window
# by more than two hours is skipped rather than posted late.
#
#   bash scripts/x-content-daemon.sh
#   tail -f logs/x-content.log
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# cron 的 PATH 缺 WSL interop 目录 → powershell.exe 找不到（2026-11-04 修）
export PATH="$PATH:/mnt/c/Windows/System32/WindowsPowerShell/v1.0:/mnt/c/Windows/system32:/mnt/c/Windows"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

BUN="${BUN:-$HOME/.bun/bin/bun}"
LOG="logs/x-content.log"
STATE=".data/content-posted.json"
PLAN_DIR=".data/content"
POSTER_WIN='C:\Users\Administrator\prediction-arena\scripts\x-poster.ps1'
IDLE_REQUIRED="${IDLE_REQUIRED:-120}"
WINDOW_MIN="${WINDOW_MIN:-120}"   # how late a slot may still go out

mkdir -p logs "$PLAN_DIR"
say() { echo "[$(date -Is)] $*" >>"$LOG"; }

exec 6>".data/x-content.lock"
if ! flock -n 6; then
  HOLDER="$(fuser ".data/x-content.lock" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' | head -1)"
  if [[ -n "${HOLDER:-}" ]] && ps -o cmd= -p "$HOLDER" 2>/dev/null | grep -q '^sleep '; then
    say "reclaiming stale lock from orphaned sleep pid=$HOLDER"
    kill "$HOLDER" 2>/dev/null || true
    sleep 1
  fi
  if ! flock -n 6; then echo "x content daemon already running"; exit 0; fi
fi
trap 'pkill -P $$ 2>/dev/null; exit 0' TERM INT

say "content daemon start pid=$$ (idle≥${IDLE_REQUIRED}s, window ${WINDOW_MIN}m)"

desk_ready() {
  local v
  v="$(powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\Administrator\prediction-arena\scripts\desk-ready.ps1' -IdleRequired "$IDLE_REQUIRED" 2>/dev/null | tr -d '\r' | grep -E '^(ready|busy|locked|unknown)$' | tail -1)"
  [[ "$v" == "ready" ]]
}

posted() {  # posted <day> <slot>
  "$BUN" -e '
    const fs = require("node:fs");
    let s = {};
    try { s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
    console.log(s?.[process.argv[2]]?.[process.argv[3]] ? "1" : "0");
  ' "$STATE" "$1" "$2" 2>/dev/null
}

mark() {  # mark <day> <slot> <result>
  "$BUN" -e '
    const fs = require("node:fs");
    let s = {};
    try { s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
    s[process.argv[2]] ??= {};
    s[process.argv[2]][process.argv[3]] = { at: new Date().toISOString(), result: process.argv[4] };
    fs.writeFileSync(process.argv[1], JSON.stringify(s, null, 2) + "\n");
  ' "$STATE" "$1" "$2" "$3" 2>/dev/null
}

while true; do
  DAY="$(date +%F)"
  HOUR="$(date +%H)"
  MIN="$(date +%M)"
  NOW_MIN=$((10#$HOUR * 60 + 10#$MIN))

  # Regenerate today's plan once, if it is missing.
  if [[ ! -f "$PLAN_DIR/$DAY-plan.json" ]]; then
    if "$BUN" scripts/x-content-plan.ts >>"$LOG" 2>&1; then say "plan generated for $DAY"; else say "plan generation failed"; fi
  fi

  for SLOT in 09 12 15 21; do
    case "$SLOT" in
      09) LABEL=board;    FILE="$PLAN_DIR/$DAY-09-board.txt" ;;
      12) LABEL=funnel;   FILE=".data/daily-funnel.txt" ;;
      15) LABEL=build;    FILE="$PLAN_DIR/$DAY-15-build.txt" ;;
      21) LABEL=question; FILE="$PLAN_DIR/$DAY-21-question.txt" ;;
    esac
    SLOT_MIN=$((10#$SLOT * 60))
    (( NOW_MIN < SLOT_MIN )) && continue
    (( NOW_MIN - SLOT_MIN > WINDOW_MIN )) && continue
    [[ "$(posted "$DAY" "$SLOT")" == "1" ]] && continue
    [[ -s "$FILE" ]] || { say "slot $SLOT: no file at $FILE"; continue; }

    if ! desk_ready; then
      say "slot $SLOT ($LABEL): due, desk busy"
      continue
    fi

    say "slot $SLOT ($LABEL): posting $(basename "$FILE")"
    OUT="$(powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "$POSTER_WIN" -TextFile "$(wslpath -w "$FILE")" 2>&1 | tr -d '\r' | tail -2)"
    say "  poster: $(echo "$OUT" | tr '\n' ' ')"
    if echo "$OUT" | grep -q "posted_attempted"; then
      mark "$DAY" "$SLOT" ok
      say "  slot $SLOT marked posted"
      sleep 90   # let X settle before the next slot can fire
    else
      mark "$DAY" "$SLOT" "failed: $(echo "$OUT" | tail -1 | tr -d '\n' | cut -c1-60)"
      say "  slot $SLOT failed, will retry next minute"
      sleep 120
    fi
  done

  sleep 45
done
