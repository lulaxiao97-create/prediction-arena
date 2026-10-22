#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Webhook notifier for the ops daemon.
#
#   bash scripts/notify.sh "message" [info|warn|error]
#   OPS_WEBHOOK_URL=https://api.telegram.org/bot<token>/sendMessage \
#   OPS_TELEGRAM_CHAT_ID=123456 bash scripts/notify.sh "hello"
#
# Supports, by sniffing the URL:
#   · Telegram Bot API   (api.telegram.org)      → {"chat_id":…,"text":…,"parse_mode":"HTML"}
#   · Discord webhook    (discord.com/api/webhooks) → {"content":…}
#   · anything else      (Slack / generic)       → {"text":…}
#
# Exit status is always 0: a notification failure must never fail a cron tick.
# Unset OPS_WEBHOOK_URL makes this a no-op, so nothing changes for a local-only setup.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MSG="${1:-}"
LEVEL="${2:-info}"
[[ -z "$MSG" ]] && { echo "notify: empty message, skipping" >&2; exit 0; }

# .env is the source of truth for ops config, same as every other script here
if [[ -f "$ROOT/.env" ]]; then
  set -a; . "$ROOT/.env"; set +a
fi

URL="${OPS_WEBHOOK_URL:-}"
if [[ -z "$URL" ]]; then
  exit 0   # deliberately silent: no webhook configured is a valid setup
fi

ICON="·"
case "$LEVEL" in
  warn)  ICON="⚠";;
  error) ICON="✖";;
  info)  ICON="✓";;
esac
MSG="${MSG//%0A/$'\n'}"
TEXT="$ICON $MSG"

mkdir -p "$ROOT/logs"
LOG="$ROOT/logs/notify.log"
STAMP="$(date -Is)"

# ── build the payload for whichever service the URL points at ────────────────
if [[ "$URL" == *"api.telegram.org"* ]]; then
  CHAT="${OPS_TELEGRAM_CHAT_ID:-}"
  if [[ -z "$CHAT" ]]; then
    # allow ?chat_id=… to travel inside the URL itself
    CHAT="$(printf '%s' "$URL" | sed -n 's/.*[?&]chat_id=\([0-9-]*\).*/\1/p')"
  fi
  if [[ -z "$CHAT" ]]; then
    echo "[$STAMP] notify: telegram URL without OPS_TELEGRAM_CHAT_ID — skipped" >> "$LOG"
    exit 0
  fi
  BODY=$(python3 - "$CHAT" "$TEXT" <<'PY'
import json, sys
print(json.dumps({"chat_id": sys.argv[1], "text": sys.argv[2], "parse_mode": "HTML",
                  "disable_web_page_preview": True}))
PY
)
  TARGET="$URL"
elif [[ "$URL" == *"discord.com/api/webhooks"* || "$URL" == *"discordapp.com/api/webhooks"* ]]; then
  BODY=$(python3 - "$TEXT" <<'PY'
import json, sys
print(json.dumps({"content": sys.argv[1]}))
PY
)
  TARGET="$URL"
else
  BODY=$(python3 - "$TEXT" <<'PY'
import json, sys
print(json.dumps({"text": sys.argv[1]}))
PY
)
  TARGET="$URL"
fi

# ── send (proxy-aware, bounded, never fatal) ─────────────────────────────────
PROXY_ARGS=()
if [[ -n "${OPS_HTTP_PROXY:-}" ]]; then
  PROXY_ARGS=(--proxy "$OPS_HTTP_PROXY")
elif [[ -n "${HTTPS_PROXY:-}" ]]; then
  PROXY_ARGS=(--proxy "$HTTPS_PROXY")
fi

RESP=$(curl -sS -m 15 -X POST -H "content-type: application/json" \
  "${PROXY_ARGS[@]}" --data-binary "$BODY" "$TARGET" 2>&1)
STATUS=$?

if [[ $STATUS -eq 0 ]]; then
  echo "[$STAMP] notify ok ($LEVEL): ${MSG:0:120}" >> "$LOG"
else
  echo "[$STAMP] notify failed (curl $STATUS): ${RESP:0:200}" >> "$LOG"
fi

exit 0
