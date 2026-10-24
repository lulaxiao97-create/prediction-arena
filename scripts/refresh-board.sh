#!/usr/bin/env bash
# Refresh the public data snapshot and rebuild the generated board.
#
#   bash scripts/refresh-board.sh
#
# Two steps, both fail-soft:
#   1. scripts/fetch-prices.ts → frontend/public/prices.json (Binance + CoinGecko + DefiLlama)
#   2. scripts/gen-board.ts    → frontend/public/pools.json  (rewrites the generated markets from
#                                 that snapshot, dropping anything whose deadline has passed)
#
# Called from scripts/ops-daemon.sh every tick and from the board cron every 30 minutes, so a
# hung on-chain step can never freeze the visible board on stale numbers.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

mkdir -p logs
LOG="logs/board.log"
NODE="$HOME/.local/bin/node"
[[ -x "$NODE" ]] || NODE="node"

# The public data APIs are only reachable through the egress proxy on this box. Taken from .env
# so the host is not baked into a committed file.
if [[ -z "${HTTPS_PROXY:-}" && -f "$ROOT/.env" ]]; then
  PROXY_VAL="$(sed -n 's/^\(HTTPS_PROXY\|https_proxy\)=//p' "$ROOT/.env" | head -1)"
  [[ -n "$PROXY_VAL" ]] && export HTTPS_PROXY="$PROXY_VAL"
fi

STAMP="$(date -Is)"
say() { echo "[$STAMP] $*" | tee -a "$LOG"; }

if "$NODE" --experimental-strip-types scripts/fetch-prices.ts >> "$LOG" 2>&1; then
  say "prices ok $(python3 - <<'PY' 2>/dev/null || true
import json
d = json.load(open("frontend/public/prices.json"))
rows = list(d["assets"].items())[:4]
print(" ".join(f"{k}=${v['usd']:.6g}" for k, v in rows))
PY
)"
else
  say "WARN price fetch failed — board keeps the previous snapshot"
fi

if "$NODE" --experimental-strip-types scripts/gen-board.ts >> "$LOG" 2>&1; then
  say "board ok $(python3 - <<'PY' 2>/dev/null || true
import json
d = json.load(open("logs/board.json"))
cats = ", ".join(f"{k.split(' ')[0]}={v}" for k, v in d["byCategory"].items())
print(f"{d['count']} markets ({cats}) snapshot {d['snapshotAgeMin']}min old")
PY
)"
else
  say "WARN board rebuild skipped — snapshot missing or older than 3h"
  exit 1
fi
