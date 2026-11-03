#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Marketing engine — the resident loop behind the acquisition pack.
#
# Every 15 minutes it recomputes the hot board (rank 232 markets by controversy / volatility /
# urgency, one pick per sector) and rewrites .data/hot-5.txt. Every 6 hours it refreshes the whole
# desktop pack — three cyberpunk market cards, the pinned airdrop post, the reply deck, the agent
# pitch — so whatever the operator opens is never older than a quarter of a day.
#
# What it deliberately does NOT do: post to X. Reading X from this host is blocked (403 from a
# datacenter IP, nitter mirrors dead, no API credits) and writing needs a signed-in desktop session.
# A "24/7 monitor" that claims to see X from here would be logging successes it never had. This loop
# keeps the ammunition current and honest; delivery is the desktop script + the Telegram bot, both of
# which run for real and both of which report what they actually sent.
#
#   bash scripts/marketing-daemon.sh          # start (idempotent)
#   tail -f logs/marketing-engine.log         # watch it
#   .data/engine-status.json                  # pid + last hot/pack timestamps
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
BUN="${BUN:-$HOME/.bun/bin/bun}"
LOG="logs/marketing-engine.log"
STATUS=".data/engine-status.json"
HOT_INTERVAL="${HOT_INTERVAL:-900}"
PACK_INTERVAL="${PACK_INTERVAL:-21600}"

mkdir -p logs .data

# One instance only — a lock file, not pgrep. `pgrep -f marketing-daemon.sh` matches every wrapper
# whose command line mentions the script (cron's sh -c, the terminal session, a debug `bash -x`), so
# a pgrep guard either refuses to start or starts twice depending on who launched it. flock is about
# the process, not about the string.
exec 9>"$STATUS.lock"
if ! flock -n 9; then
  # A killed daemon can leave an orphaned `sleep` holding the inherited lock fd, and then every
  # cron tick prints "already running" forever while nothing runs. Only a *sleep* holding the fd
  # means the owner is gone — a real daemon holding it looks nothing like that.
  HOLDER="$(fuser "$STATUS.lock" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' | head -1)"
  if [[ -n "${HOLDER:-}" ]] && ps -o cmd= -p "$HOLDER" 2>/dev/null | grep -q '^sleep '; then
    echo "[$(date -Is)] reclaiming stale lock from orphaned sleep pid=$HOLDER" >>"$LOG"
    kill "$HOLDER" 2>/dev/null || true
    sleep 1
  fi
  if ! flock -n 9; then
    echo "marketing engine already running (lock held)"
    exit 0
  fi
fi

# Never leave a child `sleep` behind on shutdown — it is what causes the stale lock above.
trap 'pkill -P $$ 2>/dev/null; exit 0' TERM INT

say() { echo "[$(date -Is)] $*" >>"$LOG"; }

STARTED="$(date -Is)"
LAST_PACK=0
say "engine start pid=$$ (hot ${HOT_INTERVAL}s · pack ${PACK_INTERVAL}s)"

while true; do
  NOW="$(date +%s)"

  if "$BUN" scripts/hot-board.ts >>"$LOG" 2>&1; then
    HOT_AT="$(date -Is)"
    TOP="$("$BUN" -e 'const j=require("./.data/hot.json");console.log(j.hot?.[0]?.title ?? "")' 2>/dev/null || true)"
  else
    HOT_AT="${HOT_AT:-}"
    say "hot-board failed (see log above)"
  fi

  if (( NOW - LAST_PACK >= PACK_INTERVAL )); then
    if "$BUN" scripts/push-desktop-marketing.ts >>"$LOG" 2>&1; then
      LAST_PACK="$NOW"
      PACK_AT="$(date -Is)"
      say "pack refreshed"
    else
      say "pack refresh failed (text pack untouched, cards may be stale)"
    fi
  fi

  # The X daemon posts .data/daily-funnel.txt once a day; regenerate it off the board that was just
  # ranked, otherwise the funnel copy freezes on whatever market was hot the day it was written.
  if "$BUN" scripts/funnel-copy.ts >>"$LOG" 2>&1; then
    FUNNEL_AT="$(date -Is)"
  else
    say "funnel copy failed — the X daemon keeps the previous text"
  fi

  "$BUN" -e '
    const { writeFileSync } = require("node:fs");
    const status = {
      pid: Number(process.argv[1]),
      startedAt: process.argv[2],
      updatedAt: new Date().toISOString(),
      lastHotAt: process.argv[3] || null,
      lastPackAt: process.argv[4] || null,
      lastFunnelAt: process.argv[6] || null,
      hotTop: process.argv[5] || null,
      note: "hots every 15m, pack every 6h; X delivery is desktop-only (see x_post_gui.ps1)",
    };
    writeFileSync(".data/engine-status.json", JSON.stringify(status, null, 2) + "\n");
  ' "$$" "$STARTED" "${HOT_AT:-}" "${PACK_AT:-}" "${TOP:-}" "${FUNNEL_AT:-}" >>"$LOG" 2>&1

  sleep "$HOT_INTERVAL"
done
