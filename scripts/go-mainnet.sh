#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One-shot mainnet pipeline: preflight → deploy → frontend env sync → Basescan verify
#                          → clean production build.
#
#   bash scripts/go-mainnet.sh              # full run
#   SKIP_VERIFY=1 bash scripts/go-mainnet.sh
#   SKIP_BUILD=1  bash scripts/go-mainnet.sh
#
# Aborts on the first failure (no partial deploys with a bad .env).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# .env is the single source of truth: drop any inherited/expo rted copies of these vars first,
# otherwise a leftover `export PRIVATE_KEY=<test key>` in the shell silently wins.
unset PRIVATE_KEY FEE_RECEIVER SAFE_ADDRESS BASESCAN_API_KEY USDC_ADDRESS BASE_RPC_URL BASE_SEPOLIA_RPC_URL

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

mkdir -p logs
STAMP="$(date +%Y%m%dT%H%M%S)"
DEPLOY_LOG="logs/mainnet-deploy-${STAMP}.log"
HARDHAT=( "$ROOT/node_modules/.bin/hardhat" )

echo "══ 1/4 preflight ══════════════════════════════════════════════"
"${HARDHAT[@]}" run scripts/preflight-env.ts --network base

echo "══ 2/4 deploy ═════════════════════════════════════════════════"
set +e
"${HARDHAT[@]}" run scripts/deploy.ts --network base 2>&1 | tee "$DEPLOY_LOG"
STATUS=${PIPESTATUS[0]}
set -e
if [[ $STATUS -ne 0 ]]; then
  echo "deploy FAILED (exit $STATUS) — see $DEPLOY_LOG" >&2
  exit "$STATUS"
fi

ARENA=$(grep -oE '^ARENA_ADDRESS=0x[0-9a-fA-F]{40}' "$DEPLOY_LOG" | tail -1 | cut -d= -f2)
USDC=$(grep -oE '^USDC_ADDRESS=0x[0-9a-fA-F]{40}' "$DEPLOY_LOG" | tail -1 | cut -d= -f2)
DEPLOYER=$(grep -oE 'Deployer +: 0x[0-9a-fA-F]{40}' "$DEPLOY_LOG" | head -1 | grep -oE '0x[0-9a-fA-F]{40}')
if [[ -z "${ARENA:-}" || -z "${USDC:-}" || -z "${DEPLOYER:-}" ]]; then
  echo "could not parse deployment output — check $DEPLOY_LOG" >&2
  exit 1
fi
echo "Arena  : $ARENA"
echo "USDC   : $USDC"
echo "Deployer: $DEPLOYER"

echo "══ 3/4 Basescan verify ════════════════════════════════════════"
if [[ "${SKIP_VERIFY:-0}" == "1" ]]; then
  echo "skipped (SKIP_VERIFY=1)"
elif [[ -n "${BASESCAN_API_KEY:-}" ]]; then
  sleep 20 # let the explorer index the contract bytecode
  "${HARDHAT[@]}" verify --network base "$ARENA" "$USDC" "${FEE_RECEIVER}" "$DEPLOYER" || \
    echo "verify failed — retry later: bunx hardhat verify --network base $ARENA $USDC ${FEE_RECEIVER} $DEPLOYER"
else
  echo "BASESCAN_API_KEY not set — run manually once you have a key:"
  echo "  bunx hardhat verify --network base $ARENA $USDC ${FEE_RECEIVER} $DEPLOYER"
fi

if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  echo "══ 4/4 build skipped (SKIP_BUILD=1) ═══════════════════════════"
  exit 0
fi

echo "══ 4/4 frontend build ═════════════════════════════════════════"
cd frontend
rm -rf .next
set +e
bun run build > "../logs/frontend-build-${STAMP}.log" 2>&1
BUILD_STATUS=$?
set -e
tail -14 "../logs/frontend-build-${STAMP}.log"
if [[ $BUILD_STATUS -ne 0 || ! -f .next/BUILD_ID ]]; then
  echo "frontend build FAILED (exit $BUILD_STATUS)" >&2
  exit 1
fi
echo "BUILD EXIT=0, BUILD_ID=$(cat .next/BUILD_ID)"
echo "──────────────────────────────────────────────────────────────"
echo "DONE — arena: $ARENA"
