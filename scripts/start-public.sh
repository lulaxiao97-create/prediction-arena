#!/usr/bin/env bash
# Bring the production build up and expose it on a public HTTPS URL.
#
#   bash scripts/start-public.sh          # start service + tunnel, print the URL
#   bash scripts/start-public.sh --stop   # tear both down
#
# The tunnel is cloudflared's quick tunnel: free, no account, but the hostname is random and dies
# with the process. For a permanent address use a named Cloudflare tunnel or deploy to Vercel
# (see frontend/DEPLOY.md).
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3000}"
CLOUDFLARED="${CLOUDFLARED:-$HOME/bin/cloudflared}"
LOG_DIR="$REPO/logs"
mkdir -p "$LOG_DIR"

kill_port() {
  local pids
  pids=$(ss -ltnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p {print $0}' \
        | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)
  if [ -n "${pids:-}" ]; then
    echo "· stopping existing listener on :$PORT ($pids)"
    kill $pids 2>/dev/null || true
    sleep 2
  fi
}

if [ "${1:-}" = "--stop" ]; then
  pkill -f "cloudflared tunnel --url http://127.0.0.1:$PORT" 2>/dev/null && echo "· tunnel stopped"
  kill_port
  echo "stopped."
  exit 0
fi

# ── 1. service ─────────────────────────────────────────────────────────────
if [ ! -f "$REPO/frontend/.next/BUILD_ID" ]; then
  echo "!! no production build found — run: cd frontend && bun run build" >&2
  exit 1
fi

if curl -s -o /dev/null -m 3 "http://127.0.0.1:$PORT/"; then
  echo "· :$PORT already serving — reusing"
else
  kill_port
  echo "· starting next-server on :$PORT"
  ( cd "$REPO/frontend" && PATH="$HOME/.bun/bin:$PATH" \
      setsid nohup bun run start -- -p "$PORT" </dev/null > "$LOG_DIR/next-prod.log" 2>&1 & )
  for _ in $(seq 1 30); do
    sleep 1
    curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/" && break
  done
  curl -s -o /dev/null -m 3 "http://127.0.0.1:$PORT/" \
    || { echo "!! service did not come up; see $LOG_DIR/next-prod.log" >&2; exit 1; }
fi

# ── 2. tunnel ──────────────────────────────────────────────────────────────
if pgrep -f "cloudflared tunnel --url http://127.0.0.1:$PORT" > /dev/null; then
  echo "· tunnel already running"
  URL=$(grep -ohE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG_DIR"/tunnel*.log 2>/dev/null | sort -u | tail -1)
else
  [ -x "$CLOUDFLARED" ] || { echo "!! cloudflared not found at $CLOUDFLARED" >&2; exit 1; }
  echo "· opening cloudflared quick tunnel"
  : > "$LOG_DIR/tunnel.log"
  setsid nohup "$CLOUDFLARED" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate \
      --logfile "$LOG_DIR/tunnel.log" --loglevel info </dev/null > "$LOG_DIR/tunnel-stdout.log" 2>&1 &
  URL=""
  for _ in $(seq 1 30); do
    sleep 1
    URL=$(grep -ohE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG_DIR/tunnel.log" 2>/dev/null | head -1)
    [ -n "$URL" ] && break
  done
  [ -n "$URL" ] || { echo "!! no tunnel URL; see $LOG_DIR/tunnel.log" >&2; exit 1; }
fi

code=$(curl -s -o /dev/null -w '%{http_code}' -m 30 --noproxy '*' "$URL/" || echo "000")
if [ "$code" = "200" ]; then
  echo "$URL" > "$REPO/PUBLIC_URL.txt"
else
  echo "!! $URL answered $code — not saving it as PUBLIC_URL.txt" >&2
fi

# ── 3. verify from the outside ─────────────────────────────────────────────
echo
echo "════════════════════════════════════════════"
echo " $URL   (HTTP $code)"
echo "════════════════════════════════════════════"
echo "saved to PUBLIC_URL.txt · logs in logs/"
