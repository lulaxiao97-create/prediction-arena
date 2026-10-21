#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Basescan source verification via the Etherscan V2 API.
#
# Why this exists: hardhat-verify 2.1.3 still posts `chainid` in the request body, which the
# V2 API rejects ("Missing or unsupported chainid parameter") with an empty error message.
# This script talks V2 correctly (chainid in the query string) and is the reliable path.
#
#   bash scripts/verify-basescan.sh                    # verifies $ARENA_ADDRESS from .env
#   bash scripts/verify-basescan.sh 0xYourAddress
#   CHAIN_ID=84532 bash scripts/verify-basescan.sh 0xTestnetAddress
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

unset BASESCAN_API_KEY ARENA_ADDRESS USDC_ADDRESS FEE_RECEIVER PRIVATE_KEY CHAIN_ID 2>/dev/null || true
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

ADDRESS="${1:-${ARENA_ADDRESS:-}}"
CHAIN_ID="${CHAIN_ID:-8453}"
CONTRACT="contracts/PredictionArena.sol:PredictionArena"

if [[ -z "$ADDRESS" ]]; then
  echo "usage: bash scripts/verify-basescan.sh <contractAddress>" >&2
  exit 1
fi
if [[ -z "${BASESCAN_API_KEY:-}" ]]; then
  echo "BASESCAN_API_KEY missing in .env" >&2
  exit 1
fi

META="$(node scripts/lib/verify-payload.cjs "$ADDRESS" "$CONTRACT")"
echo "payload: $META"

COMPILER="$(printf '%s' "$META" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).compilerversion))')"
CTOR="$(cat /tmp/arena-ctor-args.txt)"

echo "submitting to Etherscan V2 (chainid $CHAIN_ID) …"
RESP="$(curl -s --max-time 120 -X POST "https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}" \
  --data-urlencode "module=contract" \
  --data-urlencode "action=verifysourcecode" \
  --data-urlencode "apikey=${BASESCAN_API_KEY}" \
  --data-urlencode "codeformat=solidity-standard-json-input" \
  --data-urlencode "sourceCode@/tmp/arena-solc-input.json" \
  --data-urlencode "contractaddress=${ADDRESS}" \
  --data-urlencode "contractname=${CONTRACT}" \
  --data-urlencode "compilerversion=${COMPILER}" \
  --data-urlencode "constructorArbitraryArgs=${CTOR}")"
echo "submit  : $RESP"

if [[ "${RESP,,}" == *"already verified"* ]]; then
  echo "✓ already verified — https://basescan.org/address/${ADDRESS}#code"
  exit 0
fi

GUID="$(printf '%s' "$RESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.result||"")}catch(e){}})')"
if [[ -z "$GUID" ]]; then
  echo "✗ submission rejected (see response above)" >&2
  exit 1
fi

echo "guid    : $GUID"
for i in $(seq 1 20); do
  sleep 6
  STATUS="$(curl -s --max-time 40 "https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}&module=contract&action=checkverifystatus&guid=${GUID}&apikey=${BASESCAN_API_KEY}")"
  RESULT="$(printf '%s' "$STATUS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).result||"")}catch(e){}})')"
  echo "[$i] $RESULT"
  if [[ "$RESULT" == *"Pass - Verified"* ]]; then
    echo "✓ verified — https://basescan.org/address/${ADDRESS}#code"
    exit 0
  fi
  if [[ "$RESULT" == *"Fail"* || "$RESULT" == *"Error"* ]]; then
    echo "✗ verification failed" >&2
    exit 1
  fi
done

echo "⚠ still pending after ~2 min — check https://basescan.org/address/${ADDRESS}#code" >&2
exit 1
