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

# Telegram is not reachable from this network without the egress proxy, and a long-poll process that
# cannot reach the API looks exactly like a dead bot. The proxy lives in a home-dir file so it is not
# baked into the public repo.
PROXY_FILE="${PROXY_FILE:-$HOME/.hermes/.proxy}"
if [[ -z "${HTTPS_PROXY:-}" && -s "$PROXY_FILE" ]]; then
  HTTPS_PROXY="$(cat "$PROXY_FILE")"
  export HTTPS_PROXY
  export HTTP_PROXY="$HTTPS_PROXY"
fi

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" && ! -s "$TOKEN_FILE" ]]; then
  echo "[$(date -Is)] no bot token (set TELEGRAM_BOT_TOKEN or write $TOKEN_FILE) — not starting"
  exit 0
fi

# `[b]` keeps pgrep from matching the shell that is running this check (its own command line
# contains the path, so a plain pattern always answers "already running" and the bot never starts).
if pgrep -f "bun scripts/telegram-[b]ot.ts" > /dev/null 2>&1; then
  echo "[$(date -Is)] already running"
  exit 0
fi

nohup "$BUN" scripts/telegram-bot.ts >> "$LOG" 2>&1 &
echo "[$(date -Is)] started pid $! → $LOG"
