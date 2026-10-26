#!/usr/bin/env bash
# Open every manifest market on-chain as a real, bettable USDC pool.
#
# Why: the contract's bet() only needs a pool that exists and is Open — it does NOT need seed
# liquidity (stakes are the liquidity). Until createPool(id) is called for an id, bet() reverts
# PoolNotFound, which is what the UI used to call "unfunded". This script removes that cause
# instead of hiding it.
#
#   LIMIT=1 scripts/open-pools-mainnet.sh     # dry-ish: open only the first one
#   LIMIT=100 scripts/open-pools-mainnet.sh   # open the whole board
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$PATH"
set -a; . ./.env; set +a
export HTTPS_PROXY="${HTTPS_PROXY:-http://172.17.240.1:16781}"

LIMIT="${LIMIT:-100}"
RPC="$BASE_RPC_URL"
ARENA="$ARENA_ADDRESS"
SIGNER=$(cast wallet address --private-key "$PRIVATE_KEY")

echo "arena=$ARENA signer=$SIGNER"
echo "eth=$(cast balance "$SIGNER" --rpc-url "$RPC" --ether)  gasprice=$(cast gas-price --rpc-url "$RPC")"

python3 - "$LIMIT" > /tmp/pa-open-list.tsv <<'PY'
import json, sys, datetime, re
limit = int(sys.argv[1])
d = json.load(open("frontend/public/pools.json"))
now = datetime.datetime.now(datetime.timezone.utc)
n = 0
for p in d["pools"]:
    pid = str(p.get("id", ""))
    if not pid.isdigit():
        continue
    end = p.get("endTimeUtc")
    if not end:
        continue
    ts = int(datetime.datetime.fromisoformat(end.replace("Z", "+00:00")).timestamp())
    if ts <= int(now.timestamp()) + 600:
        continue
    title = re.sub(r"\s+", " ", p["title"]).strip()
    if len(title.encode()) > 128:
        title = title[:125].rsplit(" ", 1)[0] + "…"
    cat = (p.get("category") or "Markets").strip()[:32]
    print(f"{pid}\t{ts}\t{cat}\t{title}")
    n += 1
    if n >= limit:
        break
PY

total=$(wc -l < /tmp/pa-open-list.tsv)
echo "candidates=$total"
opened=0; skipped=0; failed=0
: > /tmp/pa-opened.log

while IFS=$'\t' read -r pid ts cat title; do
  [ -z "$pid" ] && continue
  have=$(cast call "$ARENA" "getPool(uint256)((string,string,uint64,uint8,uint8,uint256,uint256,uint256,bytes32))" "$pid" --rpc-url "$RPC" 2>&1)
  if [ "${have#*Error}" != "$have" ]; then
    tx=$(cast send "$ARENA" "createPool(uint256,string,string,uint256)" "$pid" "$title" "$cat" "$ts" \
      --private-key "$PRIVATE_KEY" --rpc-url "$RPC" --gas-limit 260000 --json 2>/dev/null \
      | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print(d.get("transactionHash",""))
except Exception:
    print("")')
    if [ -n "$tx" ]; then
      opened=$((opened+1))
      echo -e "$pid\t$tx\t$title" >> /tmp/pa-opened.log
      echo "  created $pid  $tx  $title"
    else
      failed=$((failed+1))
      echo "  FAILED  $pid  $title" >&2
    fi
  else
    skipped=$((skipped+1))
    echo "  exists  $pid  $title"
  fi
done < /tmp/pa-open-list.tsv

echo "opened=$opened skipped=$skipped failed=$failed"
echo "--- verify ---"
while IFS=$'\t' read -r pid tx title; do
  s=$(cast call "$ARENA" "getPool(uint256)((string,string,uint64,uint8,uint8,uint256,uint256,uint256,bytes32))" "$pid" --rpc-url "$RPC" 2>&1 | head -1)
  echo "$pid -> $(echo "$s" | cut -c1-90)"
done < /tmp/pa-opened.log
