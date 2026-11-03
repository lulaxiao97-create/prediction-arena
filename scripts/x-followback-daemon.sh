#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Follow-back engine — the only follower mechanic that works at three followers.
#
# At this size X gives our posts no distribution and our replies are read by almost nobody. What does
# work is reciprocity: follow the people who already live in our niche, and 10-30% of them follow back
# within a day. That is the documented behaviour of crypto accounts, and it is the one lever that does
# not need money or an API.
#
# The Follow buttons on a user's *followers/following list* ARE exposed to UI Automation (unlike the
# ones on a status page, which are drawn on hover and never enter the tree). One run just followed six
# accounts in a row from @Polymarket's followers, no misses.
#
# Pace: 6 follows per run, one run every 20 minutes ≈ 18/hour ≈ 150/day. X's hard ceiling is around
# 400 follows a day; staying under half of it is what keeps the account out of a spam action.
#
#   bash scripts/x-followback-daemon.sh
#   tail -f logs/followback.log
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOG="logs/followback.log"
STATE=".data/followback.json"
PS1_WIN='C:\Users\Administrator\prediction-arena\scripts\x-grow-followback.ps1'
INTERVAL="${INTERVAL:-1200}"      # 20 minutes between runs
PER_RUN="${PER_RUN:-6}"
DAILY_CAP="${DAILY_CAP:-150}"

mkdir -p logs .data
say() { echo "[$(date -Is)] $*" >>"$LOG"; }

# Seeds = accounts whose followers are our audience. Rotated so we do not hammer one list (and because
# X pages the same followers in the same order, so a single seed runs dry after a few runs).
SEEDS=(
  "Polymarket"
  "base"
  "jessepollak"
  "Kalshi"
  "AerodromeFi"
  "Uniswap"
)

exec 5>".data/followback.lock"
if ! flock -n 5; then echo "followback daemon already running"; exit 0; fi
trap 'pkill -P $$ 2>/dev/null; exit 0' TERM INT

say "followback daemon start pid=$$ (${PER_RUN}/run, every ${INTERVAL}s, cap ${DAILY_CAP}/day)"

while true; do
  DAY="$(date +%F)"
  DONE_TODAY="$("$HOME/.bun/bin/bun" -e '
    const fs=require("node:fs");
    let s={}; try{s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{}
    console.log(s?.[process.argv[2]]?.count ?? 0);
  ' "$STATE" "$DAY" 2>/dev/null || echo 0)"

  if (( DONE_TODAY >= DAILY_CAP )); then
    say "daily cap reached (${DONE_TODAY}/${DAILY_CAP}) — sleeping 1h"
    sleep 3600
    continue
  fi

  SEED="${SEEDS[$(( ( $(date +%s) / INTERVAL ) % ${#SEEDS[@]} ))]}"
  OUT="$(powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "$PS1_WIN" \
      -TweetUrl "https://x.com/${SEED}/followers" -Max "$PER_RUN" -Scrolls 3 2>&1 | tr -d '\r')"
  ADDED="$(echo "$OUT" | grep -o 'followed=@' | wc -l | tr -d ' ')"
  say "seed @${SEED}: followed ${ADDED} — $(echo "$OUT" | tail -1)"

  if [[ "$ADDED" -gt 0 ]]; then
    "$HOME/.bun/bin/bun" -e '
      const fs=require("node:fs");
      let s={}; try{s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{}
      const d=process.argv[2]; s[d] ??= {count:0, seeds:{}};
      s[d].count += Number(process.argv[3]);
      s[d].seeds[process.argv[4]] = (s[d].seeds[process.argv[4]] ?? 0) + Number(process.argv[3]);
      fs.writeFileSync(process.argv[1], JSON.stringify(s,null,2)+"\n");
    ' "$STATE" "$DAY" "$ADDED" "$SEED" 2>/dev/null
  fi

  sleep "$INTERVAL"
done
