#!/usr/bin/env bash
# Bluesky daily cadence.
#
# Three posts a day, not more. On X the schedule was hourly-adjacent because volume bought reach
# through the algorithm; Bluesky has no such lever, so posting more only spends the one thing that
# matters there — the patience of the 20 people who follow you.
#
#   09:10  mismatch  — a market whose odds contradict today's move (a claim you can argue with)
#   15:10  question  — two markets from different sectors, "which one is wrong" (replies = reach)
#   21:10  mismatch  — second data point, different market (the generator varies by day)
#
# A settled-market post is only sent when a settlement actually exists, because inventing one would
# be the exact thing this product claims nobody does.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export HTTPS_PROXY="${HTTPS_PROXY:-http://172.17.240.1:16781}"

LOG="logs/cron-bluesky.log"
mkdir -p logs
say() { echo "[$(date -Is)] $*" >> "$LOG"; }

HOUR="$(date +%-H)"
case "$HOUR" in
  9)  KIND=mismatch ;;
  15) KIND=question ;;
  21) KIND=mismatch ;;
  *)  KIND="${BLUESKY_KIND:-mismatch}" ;;
esac

TEXT="$(bun scripts/bluesky-content.ts --kind="$KIND" 2>>"$LOG")"
if [ -z "${TEXT:-}" ]; then
  say "no copy for kind=$KIND — skipped"
  exit 0
fi

# Keep a rolling copy of what was said, so a repeated line is visible in the log rather than silent.
echo "$TEXT" | head -c 400 >> logs/bluesky-posted.log
echo "---" >> logs/bluesky-posted.log

if bun scripts/bluesky.ts --text "$TEXT" >> "$LOG" 2>&1; then
  say "posted kind=$KIND :: $(echo "$TEXT" | head -1 | cut -c1-90)"
else
  say "POST FAILED kind=$KIND"
  exit 1
fi
