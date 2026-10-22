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
if bash scripts/open-pool-unattended.sh >> "$LOG" 2>&1; then
  say "open step ok (see logs/auto-pool-*.log for the deployment detail)"
else
  say "WARN open step failed — will retry next tick"
fi

# ── 4. refresh again so the new pool lands in the manifest immediately ───────
"$HARDHAT" run scripts/ops-refresh.ts --network "$NETWORK" >> "$LOG" 2>&1 && \
  say "post-open refresh ok" || say "WARN post-open refresh failed"

say "── tick end ──────────────────────────────────────────────────────"
exit 0
