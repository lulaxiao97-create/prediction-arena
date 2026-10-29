#!/usr/bin/env bash
# Keep exactly one captain bot alive.
#
# The bot is a long-polling process, not a webhook: it needs nothing but outbound HTTPS, which is
# the only kind of hosting this project pays for (none). Run from cron every ten minutes and at
# reboot; pgrep makes it idempotent, and a missing token exits 0 so cron does not mail a failure
# every ten minutes on a machine that has not been given the credential yet.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BUN="${BUN:-$HOME/.bun/bin/bun}"
TOKEN_FILE="${TELEGRAM_TOKEN_FILE:-$HOME/.hermes/.tg_bot_token}"
LOG="$ROOT/logs/telegram-bot.log"

mkdir -p logs

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" && ! -s "$TOKEN_FILE" ]]; then
  echo "[$(date -Is)] no bot token (set TELEGRAM_BOT_TOKEN or write $TOKEN_FILE) — not starting"
  exit 0
fi

if pgrep -f "bun scripts/telegram-bot.ts" > /dev/null 2>&1; then
  echo "[$(date -Is)] already running"
  exit 0
fi

nohup "$BUN" scripts/telegram-bot.ts >> "$LOG" 2>&1 &
echo "[$(date -Is)] started pid $! → $LOG"
