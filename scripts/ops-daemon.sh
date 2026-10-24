#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Autonomous ops loop — one cron tick does the whole cycle:
#
#   1. refresh   read on-chain state → rewrite public/pools.json (probability, 24h volume, TVL)
#                and report pools that ended without settlement
#   2. generate  ask the market generator for the next listing (kernel, or LLM when a key exists)
#   3. open      deploy that listing on-chain when the fee wallet can fund both seeds
#   4. refresh   fold the new pool back into the manifest so the site updates without a redeploy
#
# Every step is fail-soft: a rate-limited RPC or an empty wallet logs and exits 0 so the next
# tick still runs. Nothing here settles a market — settlement is a claim about the world.
#
#   bash scripts/ops-daemon.sh                 # full tick
#   SKIP_OPEN=1 bash scripts/ops-daemon.sh     # refresh only
#   bash scripts/ops-daemon.sh --dry-run       # generate + refresh, never touch the chain
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

mkdir -p logs
LOG="logs/ops-daemon.log"
STAMP="$(date -Is)"
say() { echo "[$STAMP] $*" | tee -a "$LOG"; }

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

HARDHAT="$ROOT/node_modules/.bin/hardhat"
[[ -x "$HARDHAT" ]] || HARDHAT="npx --no-install hardhat"
NODE="$HOME/.local/bin/node"
[[ -x "$NODE" ]] || NODE="node"

NETWORK="${NETWORK:-base}"
say "── tick start (network=$NETWORK dry_run=$DRY) ─────────────────────"

# ── 0. live data + board ─────────────────────────────────────────────────────
# Everything downstream reads numbers, so the snapshot comes first: prices → board → chain
# refresh (which preserves the generated rows). Fail-soft: a dead feed must not stop the tick,
# it just leaves yesterday's numbers in place and says so in the log.
if bash scripts/refresh-board.sh >> "$LOG" 2>&1; then
  say "board refreshed from live data"
else
  say "WARN board refresh failed — visible board keeps its previous numbers"
fi

# ── 1. refresh ───────────────────────────────────────────────────────────────
if "$HARDHAT" run scripts/ops-refresh.ts --network "$NETWORK" >> "$LOG" 2>&1; then
  say "refresh ok: $(grep -o '"id"' logs/ops-refresh.json 2>/dev/null | wc -l | tr -d ' ') pool rows"
else
  say "WARN refresh failed (RPC?) — continuing, manifest left as-is"
fi

# surface pending settlements loudly: these need a human decision, not a cron action
if command -v python3 >/dev/null 2>&1 && [[ -f logs/ops-refresh.json ]]; then
  python3 - <<'PY' 2>/dev/null | while read -r line; do say "⚠ $line"; done
import json
d = json.load(open("logs/ops-refresh.json"))
for s in d.get("needsSettlement", []):
    print(f"needs settlement: {s['id']} — {s['title']} (ended {s['endedHoursAgo']}h ago)")
PY
fi

# ── 2. generate ──────────────────────────────────────────────────────────────
if "$NODE" --experimental-strip-types scripts/gen-market.ts >> "$LOG" 2>&1; then
  TITLE=$(python3 -c "import json;print(json.load(open('logs/generated-market.json'))['title'])" 2>/dev/null || echo "?")
  say "generated: $TITLE"
else
  say "WARN generator failed — auto-create-pool will use its built-in fallback title"
fi

[[ $DRY -eq 1 ]] && { say "dry run — stopping before any chain write"; exit 0; }
[[ "${SKIP_OPEN:-0}" == "1" ]] && { say "SKIP_OPEN=1 — refresh/generate only"; exit 0; }

# ── 3. open ──────────────────────────────────────────────────────────────────
# open-pool-unattended.sh already owns the wallet-balance circuit breaker and the
# "one live pool at a time" rule; reuse it rather than duplicating those checks here.
#
# We watch the pool id before/after so a successful listing can be announced, and keep this tick's
# output so a circuit-breaker trip can be reported as a low-balance alert.
pool_id() { python3 -c "import json;print(json.load(open('logs/pool-state.json'))['poolId'])" 2>/dev/null || true; }

POOL_BEFORE="$(pool_id)"
OPEN_OUT="$(mktemp)"
SKIP_GENERATE=1 bash scripts/open-pool-unattended.sh >> "$OPEN_OUT" 2>&1
OPEN_STATUS=$?
cat "$OPEN_OUT" >> "$LOG"
POOL_AFTER="$(pool_id)"

if [[ $OPEN_STATUS -eq 0 && -n "$POOL_AFTER" && "$POOL_AFTER" != "$POOL_BEFORE" ]]; then
  TITLE="$(python3 -c "import json;print(json.load(open('logs/generated-market.json'))['title'])" 2>/dev/null || echo "new listing")"
  CATEGORY="$(python3 -c "import json;print(json.load(open('logs/generated-market.json'))['category'])" 2>/dev/null || echo "-")"
  TX="$(grep -oE 'tx=0x[0-9a-fA-F]{64}' "$OPEN_OUT" | head -1 | cut -d= -f2)"
  ARENA_ADDR="${ARENA_ADDRESS:-unknown}"
  say "listed pool $POOL_AFTER: $TITLE"
  bash scripts/notify.sh "New market live: <b>${TITLE}</b>
${CATEGORY} · pool ${POOL_AFTER} · 10,000 USDC cap
${ARENA_ADDR}
${TX:-tx pending}" info
elif grep -q "SKIP — fee wallet holds less" "$OPEN_OUT"; then
  BAL="$(grep -oE 'USDC balance [0-9.]+ < seeds [0-9.]+' "$OPEN_OUT" | head -1)"
  say "open skipped: low fee-wallet balance"
  # throttle: one low-balance alert per 6h, otherwise an hourly cron becomes a pager
  LAST_FILE="logs/.notify-low-balance"
  LAST_TS="$(cat "$LAST_FILE" 2>/dev/null || echo 0)"
  NOW_TS="$(date +%s)"
  if (( NOW_TS - LAST_TS > 21600 )); then
    echo "$NOW_TS" > "$LAST_FILE"
    bash scripts/notify.sh "Low fee-wallet balance — cron is skipping opens.
${BAL:-balance below 2x seed}
Top up USDC on Base to arm the next tick." warn
  else
    say "low-balance alert throttled (last sent $(( (NOW_TS - LAST_TS) / 60 ))m ago)"
  fi
elif [[ $OPEN_STATUS -ne 0 ]]; then
  say "WARN open step failed (exit $OPEN_STATUS) — will retry next tick"
  bash scripts/notify.sh "Open step failed (exit ${OPEN_STATUS}) — check logs/auto-pool-*.log." error
else
  say "open step ok (pool unchanged — one live pool at a time)"
fi
rm -f "$OPEN_OUT"

# ── 3.5 pre-generate debates ─────────────────────────────────────────────────
# The site is read-only for AI: this tick is the only place a model gets called. MAX_PER_RUN keeps
# a crowded board from turning one tick into a bill; each market is skipped while its cache is warm.
if "$NODE" --experimental-strip-types scripts/gen-debates.ts >> "$LOG" 2>&1; then
  say "debates: $(python3 -c "import json;print(len(json.load(open('frontend/public/debates.json'))['debates']))" 2>/dev/null || echo '?') cached"
else
  say "WARN debate pre-generation failed — site keeps serving the existing cache"
fi

# ── 4. refresh again so the new pool lands in the manifest immediately ───────
"$HARDHAT" run scripts/ops-refresh.ts --network "$NETWORK" >> "$LOG" 2>&1 && \
  say "post-open refresh ok" || say "WARN post-open refresh failed"

say "── tick end ──────────────────────────────────────────────────────"
exit 0
