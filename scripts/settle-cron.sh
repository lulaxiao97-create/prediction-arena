#!/usr/bin/env bash
# Nightly stale-pool sweep.
#
# On 2026-11-09 the board was carrying 66 pools that ended 47–92 hours earlier and still showed
# as Open. Nothing in cron ever closed them: ops-daemon reports them loudly but deliberately does
# not settle ("settlement is a claim about the world"), and the manual settle script was only run
# by hand. This runs it on a schedule.
#
# What it will and will not do is enforced by settle-expired.ts, not here:
#   · pool with no stake on either side  → cancelPool (void, 100% refundable, no result invented)
#   · pool with stake, no verified result → refuse, no transaction, logged for a human
#   · pool with stake + --result supplied → settle (never passed from cron)
# So the common case is safe to automate; a real market still needs a real outcome.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export HTTPS_PROXY="${HTTPS_PROXY:-http://172.17.240.1:16781}"

mkdir -p logs .data
set -a
# shellcheck disable=SC1091
. ./.env
set +a

exec 9>".data/settle.lock"
if ! flock -n 9; then
  echo "[$(date -Is)] settle sweep already running — skipping" >> logs/cron-settle.log
  exit 0
fi

echo "[$(date -Is)] settle sweep start" >> logs/cron-settle.log
timeout 1800 "$HOME/.bun/bin/bun" scripts/settle-expired.ts --execute >> logs/cron-settle.log 2>&1
rc=$?
echo "[$(date -Is)] settle sweep end rc=$rc" >> logs/cron-settle.log

# Fold the new statuses back into the public manifest so visitors stop seeing expired markets.
SKIP_OPEN=1 timeout 900 bash scripts/ops-daemon.sh >/dev/null 2>&1 || true
exit 0
