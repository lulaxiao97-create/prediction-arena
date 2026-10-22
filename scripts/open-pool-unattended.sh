#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Unattended pool opening: one command, safe to cron.
#
#   scripts/open-pool-unattended.sh                 # uses .env defaults
#   NETWORK=baseSepolia DURATION_HOURS=72 ./scripts/open-pool-unattended.sh
#
# Guarantees:
#   • flock prevents two openings racing on the same nonce / pool id
#   • POOL_ID defaults to the current unix timestamp (unique per run)
#   • seeds both sides 22.5 USDC (inside the 20–25 USDC window)
#   • fails loudly unless the script prints "Liquidity ok" (both sides > 0, cap ≥ 5)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# cron/systemd start with a minimal PATH: make node/bun/hardhat reachable explicitly.
# `node` lives in ~/.local/bin on this box (nvm-free install); without it the hardhat shim
# dies with `env: 'node': No such file or directory` (exit 127) — that is what killed the
# 2026-10-21 20:05 tick.
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$HOME/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

if ! command -v node >/dev/null 2>&1 && ! command -v bun >/dev/null 2>&1; then
  echo "[$(date -Is)] no node/bun on PATH (looked in ~/.bun/bin, ~/.local/bin, ~/.hermes/node/bin) — cannot run hardhat" >&2
  exit 127
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# Not configured yet (pre-mainnet): log one line and exit 0 so cron does not spam failures.
if [[ -z "${PRIVATE_KEY:-}" || -z "${ARENA_ADDRESS:-}" ]]; then
  echo "[$(date -Is)] not configured (PRIVATE_KEY / ARENA_ADDRESS empty) — skipping this tick" >&2
  exit 0
fi

export NETWORK="${NETWORK:-base}"
export POOL_ID="${POOL_ID:-$(date +%s)}"
export TITLE="${TITLE:-Will BTC close above \$120k this week?}"
export CATEGORY="${CATEGORY:-Macro}"
export DURATION_HOURS="${DURATION_HOURS:-24}"
export SEED_PER_SIDE="${SEED_PER_SIDE:-22.5}"
# 1 = skip when the tracked pool is still open (prevents an hourly cron from locking 45 USDC/h)
export SKIP_IF_OPEN="${SKIP_IF_OPEN:-1}"
export POOL_STATE_FILE="${POOL_STATE_FILE:-logs/pool-state.json}"
export USDC_ADDRESS="${USDC_ADDRESS:-0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913}"

mkdir -p logs
LOCK="logs/pool-auto.lock"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[$(date -Is)] another pool:auto run is in progress — exiting" >&2
  exit 1
fi

LOG="logs/pool-auto-$(date +%Y%m%dT%H%M%S).log"
echo "[$(date -Is)] opening pool ${POOL_ID} on ${NETWORK} (seed ${SEED_PER_SIDE}/side, ${DURATION_HOURS}h)"

if [[ -x "$ROOT/node_modules/.bin/hardhat" ]]; then
  HARDHAT=( "$ROOT/node_modules/.bin/hardhat" )
elif command -v bunx >/dev/null 2>&1; then
  HARDHAT=( bunx --bun hardhat )
elif command -v npx >/dev/null 2>&1; then
  HARDHAT=( npx --no-install hardhat )
else
  echo "[$(date -Is)] no hardhat runner found (node_modules/.bin, bunx, npx)" >&2
  exit 127
fi

set +e
"${HARDHAT[@]}" run scripts/auto-create-pool.ts --network "$NETWORK" 2>&1 | tee "$LOG"
STATUS=${PIPESTATUS[0]}
set -e

# Operational skips are healthy outcomes for a cron tick → exit 0 (and before the error check).
if grep -q "USDC balance .* < seeds" "$LOG"; then
  echo "[$(date -Is)] SKIP — fee wallet holds less USDC than the 2×22.5 seed; top up to arm the cron"
  exit 0
fi
if grep -q "^SKIP:" "$LOG"; then
  echo "[$(date -Is)] SKIP — tracked pool is still open, nothing to open this tick"
  exit 0
fi

if [[ $STATUS -ne 0 ]]; then
  echo "[$(date -Is)] FAILED (exit $STATUS) — see $LOG" >&2
  exit "$STATUS"
fi
if ! grep -q "Liquidity ok" "$LOG"; then
  echo "[$(date -Is)] FAILED — no liquidity confirmation in $LOG" >&2
  exit 1
fi

# Keep the frontend's static pool manifest in sync. Best effort: a 429 on the log scan must never
# fail an otherwise successful tick.
if command -v bun >/dev/null 2>&1; then
  if RPC_URL="${MANIFEST_RPC_URL:-https://base-rpc.publicnode.com}" POOL_LIST_OUT="${POOL_LIST_OUT:-frontend/public/pools.json}" \
      bun run scripts/sync-pool-list.ts >>"$LOG" 2>&1; then
    echo "[$(date -Is)] pool manifest synced → ${POOL_LIST_OUT:-frontend/public/pools.json}"
  else
    echo "[$(date -Is)] warn: pool manifest sync failed — frontend will fall back to log scanning" >&2
  fi
fi

echo "[$(date -Is)] OK — pool ${POOL_ID} live, log: $LOG"
