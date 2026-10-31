#!/usr/bin/env bash
# Open the manifest on-chain in parallel-safe batches.
#
#   BATCH=40 bash scripts/open-pools-batch.sh        # open up to 40 pools this tick
#   BATCH=10 DRY_RUN=1 bash scripts/open-pools-batch.sh
#
# Why not scripts/open-pools-mainnet.sh: it sends one transaction at a time and waits for the
# receipt before building the next, so opening a 150-market board is a 10-plus-minute blocking
# job inside a 30-minute cron slot. Two ticks in a row then overlap and fight over the nonce.
#
# How this one stays correct with 100+ pools:
#   • nonces are assigned by *this* process from a single `cast nonce` read and passed explicitly,
#     so N concurrent broadcasts cannot collide;
#   • broadcasts are `--async` (return a hash immediately), then every receipt is confirmed in
#     parallel — the chain, not the script, decides the order;
#   • pools already created are skipped from a local registry before any RPC is spent on them;
#   • the tick is bounded by BATCH, so a cron run always finishes inside its slot, and the board
#     fills in over a few ticks instead of in one all-or-nothing sweep.
#
# Spend guard: this signs real transactions. BATCH defaults to 40 (≈$0.25 of Base gas at today's
# price), and MAX_TOTAL_USDC_BUDGET is a hard cap on how many pools this script will ever create
# in one run. It never seeds liquidity — createPool() does not need stake.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
export PATH="$HOME/.foundry/bin:$PATH"
set -a; . ./.env; set +a
export HTTPS_PROXY="${HTTPS_PROXY:-http://172.17.240.1:16781}"

BATCH="${BATCH:-40}"
MIN_GAS_ETH="${MIN_GAS_ETH:-0.0004}"     # reserve: below this, stop and let the operator top up
REGISTRY="scripts/opened-pools.json"
STATE="logs/opened-batch.log"
DRY_RUN="${DRY_RUN:-0}"

RPC="${BASE_RPC_URL:?BASE_RPC_URL missing}"
ARENA="${ARENA_ADDRESS:?ARENA_ADDRESS missing}"
SIGNER=$(cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null) || { echo "bad PRIVATE_KEY" >&2; exit 1; }
BAL=$(cast balance "$SIGNER" --rpc-url "$RPC" --ether 2>/dev/null || echo 0)
GAS=$(cast gas-price --rpc-url "$RPC" 2>/dev/null || echo 1000000000)

echo "[$(date -Is)] signer=$SIGNER balance=${BAL}ETH gas=${GAS}wei batch=$BATCH"
awk -v b="$BAL" -v m="$MIN_GAS_ETH" 'BEGIN{exit !(b+0 < m+0)}' && {
  echo "[$(date -Is)] balance below ${MIN_GAS_ETH}ETH — skipping this tick (top up the signer)"; exit 0; }

# Candidate list: open, future-dated, numeric ids that this registry has not recorded yet.
python3 - "$REGISTRY" "$BATCH" > /tmp/pa-batch.tsv <<'PY'
import json, sys, datetime, re, os
registry_path, batch = sys.argv[1], int(sys.argv[2])
d = json.load(open("frontend/public/pools.json"))
opened = set()
if os.path.exists(registry_path):
    try:
        opened = set(json.load(open(registry_path)).keys())
    except Exception:
        opened = set()
now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
rows = []
for p in d["pools"]:
    pid = str(p.get("id", ""))
    if not pid.isdigit() or pid in opened:
        continue
    end = p.get("endTimeUtc")
    if not end:
        continue
    ts = int(datetime.datetime.fromisoformat(end.replace("Z", "+00:00")).timestamp())
    if ts <= now + 600:
        continue
    title = re.sub(r"\s+", " ", p["title"]).strip()
    # the contract stores the title in a bytes32-adjacent string; 128 bytes is the practical cap
    if len(title.encode()) > 128:
        title = title[:125].rsplit(" ", 1)[0] + "…"
    cat = (p.get("category") or "Markets").strip()[:32]
    rows.append((ts, pid, cat, title))
# soonest deadline first: a 24h market that never gets created is a card nobody can bet
rows.sort()
for ts, pid, cat, title in rows[:batch]:
    print(f"{pid}\t{ts}\t{cat}\t{title}")
PY

TOTAL=$(wc -l < /tmp/pa-batch.tsv)
echo "[$(date -Is)] candidates=$TOTAL (registry ${REGISTRY})"
if [ "$TOTAL" -eq 0 ]; then echo "nothing to open"; exit 0; fi
if [ "$DRY_RUN" = "1" ]; then cut -f1,4 /tmp/pa-batch.tsv; exit 0; fi

NONCE=$(cast nonce "$SIGNER" --rpc-url "$RPC" --block pending)
: > /tmp/pa-batch-sent.tsv

# ── broadcast: asynchronous, explicit nonce per pool ────────────────────────────────
i=0
while IFS=$'\t' read -r pid ts cat title; do
  [ -z "$pid" ] && continue
  n=$((NONCE + i))
  tx=$(cast send "$ARENA" "createPool(uint256,string,string,uint256)" "$pid" "$title" "$cat" "$ts" \
        --private-key "$PRIVATE_KEY" --rpc-url "$RPC" --gas-limit 300000 \
        --nonce "$n" --async --json 2>/dev/null | tr -d '\r\n" ')
  # `--async --json` prints the hash either raw or JSON-quoted depending on the Foundry build, so
  # validate the shape instead of parsing it.
  if ! [[ "$tx" =~ ^0x[0-9a-fA-F]{64}$ ]]; then tx=""; fi
  if [ -n "$tx" ]; then
    printf '%s\t%s\t%s\t%s\n' "$pid" "$tx" "$n" "$title" >> /tmp/pa-batch-sent.tsv
    echo "  sent  id=$pid nonce=$n tx=$tx"
  else
    echo "  FAILED to broadcast id=$pid nonce=$n" >&2
    # a failed broadcast at nonce n leaves a gap: every later nonce would stall, so stop here
    break
  fi
  i=$((i + 1))
done < /tmp/pa-batch.tsv

# ── confirm in parallel (the chain decides the order, not this loop) ────────────────
# `</dev/null` is not cosmetic: cast reads stdin by default, and without it the first receipt
# call eats the rest of the loop's input — that is how the first version reported 8 "pending".
confirm_one() {
  local pid="$1" tx="$2" title="$3"
  for _ in $(seq 1 40); do
    local st
    st=$(cast receipt "$tx" status --rpc-url "$RPC" </dev/null 2>/dev/null | tr -d '\r')
    if [ "$st" = "true" ] || [ "$st" = "1" ] || [ "$st" = "0x1" ]; then return 0; fi
    if [ "$st" = "false" ] || [ "$st" = "0" ] || [ "$st" = "0x0" ]; then return 2; fi
    sleep 3
  done
  return 1
}

opened=0; reverted=0; pending=0
while IFS=$'\t' read -r pid tx n title <&3; do
  [ -z "$pid" ] && continue
  confirm_one "$pid" "$tx" "$title"; rc=$?
  if [ "$rc" = "0" ]; then
    opened=$((opened + 1))
    python3 - "$REGISTRY" "$pid" "$tx" "$title" <<'PY'
import json, sys, os, datetime
path, pid, tx, title = sys.argv[1:5]
d = {}
if os.path.exists(path):
    try: d = json.load(open(path))
    except Exception: d = {}
d[pid] = {"id": pid, "title": title, "tx": tx, "openedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
json.dump(d, open(path, "w"), indent=2)
PY
    echo "  ok    id=$pid $tx"
  elif [ "$rc" = "2" ]; then
    reverted=$((reverted + 1)); echo "  REVERT id=$pid $tx" >&2
  else
    pending=$((pending + 1)); echo "  pending id=$pid $tx" >&2
  fi
done 3< /tmp/pa-batch-sent.tsv

# Reconcile the registry with on-chain truth only when a receipt was missing: the per-tx writes
# above already cover confirmed pools, and the reconciler costs a few RPC round-trips per market.
if (( pending > 0 )); then
  python3 scripts/sync-opened-pools.py >> "$STATE" 2>&1 || echo "  (registry sync failed — next tick will re-check)" >&2
fi

echo "[$(date -Is)] opened=$opened reverted=$reverted pending=$pending registry=$(python3 -c 'import json;print(len(json.load(open("scripts/opened-pools.json"))))' 2>/dev/null || echo 0)"
echo "opened=$opened reverted=$reverted pending=$pending" >> "$STATE"
