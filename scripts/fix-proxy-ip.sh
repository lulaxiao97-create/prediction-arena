#!/usr/bin/env bash
# WSL gives the VM a new default gateway on every boot (172.17.240.1 → 172.21.64.1 → …), and the
# Windows proxy is reachable only at <gateway>:16781. Anything that pins the old IP — .env or a
# crontab line — fails silently with DNS timeouts, which is exactly how a whole morning of cron
# jobs disappears without an error. Re-point both at the live gateway; idempotent, safe to run often.
set -euo pipefail

PORT="${PROXY_PORT:-16781}"
GW="$(ip route show default | awk '{print $3; exit}')"
[ -n "${GW:-}" ] || { echo "no default gateway; nothing to do"; exit 0; }
NEW="http://${GW}:${PORT}"

REPO="/mnt/c/Users/Administrator/prediction-arena"

# 1) .env — the file is authoritative for every bun/hardhat script (dotenv override:true).
if [ -f "$REPO/.env" ]; then
  if grep -qE '^HTTPS_PROXY=' "$REPO/.env"; then
    sed -i -E "s|^HTTPS_PROXY=.*|HTTPS_PROXY=${NEW}|" "$REPO/.env"
  else
    printf '\nHTTPS_PROXY=%s\n' "$NEW" >>"$REPO/.env"
  fi
fi

# 2) crontab — the lines that prefix a proxy by hand.
TMP="$(mktemp)"
crontab -l >"$TMP" 2>/dev/null || true
if grep -qE 'http://[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:'"${PORT}" "$TMP"; then
  sed -i -E "s|http://[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:${PORT}|${NEW}|g" "$TMP"
  crontab "$TMP"
  echo "crontab re-pointed at ${NEW}"
fi
rm -f "$TMP"

echo "$(date -Is) proxy -> ${NEW}"
