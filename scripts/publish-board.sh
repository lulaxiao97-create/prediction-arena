#!/usr/bin/env bash
# Publish the refreshed board to production.
#
#   bash scripts/publish-board.sh          # throttled: at most once per PUBLISH_EVERY seconds
#   FORCE=1 bash scripts/publish-board.sh  # publish even if the throttle has not expired
#
# Why this exists: Render serves `frontend/public/*` from the built image, so a board rewritten on
# this box is invisible to visitors until the app is rebuilt. Refresh → commit the two data files →
# push → CI → deploy hook is the whole loop, and it only runs when the numbers actually changed,
# so an unchanged snapshot costs nothing.
#
# The push uses the same credential the deploy flow uses; nothing is stored in the repo.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LOG="logs/publish-board.log"
STAMP_FILE="logs/.last-board-publish"
PUBLISH_EVERY="${PUBLISH_EVERY:-2700}" # 45 min
TOKEN_FILE="$HOME/.hermes/.gh_token_predictionarena"
REMOTE="https://github.com/lulaxiao97-create/prediction-arena.git"
PROXY_VAL="$(sed -n 's/^\(HTTPS_PROXY\|https_proxy\)=//p' "$ROOT/.env" 2>/dev/null | head -1)"

mkdir -p logs
say() { echo "[$(date -Is)] $*" | tee -a "$LOG"; }

bash scripts/refresh-board.sh >> "$LOG" 2>&1 || say "WARN refresh failed (keeping the shipped board)"

# Anything to publish?
if git diff --quiet -- frontend/public/pools.json frontend/public/prices.json; then
  say "board unchanged — nothing to publish"
  exit 0
fi

NOW=$(date +%s)
LAST=$(cat "$STAMP_FILE" 2>/dev/null || echo 0)
if [[ "${FORCE:-0}" != "1" ]] && (( NOW - LAST < PUBLISH_EVERY )); then
  say "changed, but last publish was $(( (NOW - LAST) / 60 ))min ago — deferring (throttle ${PUBLISH_EVERY}s)"
  exit 0
fi

if [[ ! -f "$TOKEN_FILE" ]]; then
  say "ERROR no push credential at $TOKEN_FILE — board stays local"
  exit 1
fi
TOK="$(cat "$TOKEN_FILE")"

git add frontend/public/pools.json frontend/public/prices.json
TITLES=$(python3 - <<'PY' 2>/dev/null || echo "board refresh"
import json
d = json.load(open("frontend/public/pools.json"))
p = json.load(open("frontend/public/prices.json"))
a = p["assets"]
print(f"{len(d['pools'])} markets · BTC ${a['BTC']['usd']:,.0f} · ETH ${a['ETH']['usd']:,.2f} · SOL ${a['SOL']['usd']:,.2f}")
PY
)

git -c user.name="$(git log -1 --format=%an)" -c user.email="$(git log -1 --format=%ae)" \
  commit -q -m "chore(data): board refresh — ${TITLES}" -- frontend/public/pools.json frontend/public/prices.json || {
  say "commit produced no change"; exit 0; }

# PUSH_REMOTE_URL exists so the retry/rebase path can be exercised against a scratch bare repo;
# production never sets it.
PUSH_URL="${PUSH_REMOTE_URL:-https://x:${TOK}@github.com/lulaxiao97-create/prediction-arena.git}"
GITCFG=(-c "url.https://x:${TOK}@github.com/.insteadOf=https://github.com/" -c "http.proxy=$PROXY_VAL")

# The cloud content factory (auto-marketing.yml) also commits to main, so a push here is routinely
# rejected as non-fast-forward — that is exactly what killed this job on 2026-10-28 20:05 and left
# the cron dead for two ticks. Rebase onto whatever landed, then push; retry a few times because the
# other writer may commit again while we are rebasing.
pushed=0
for attempt in 1 2 3; do
  if HTTPS_PROXY="$PROXY_VAL" git "${GITCFG[@]}" push "$PUSH_URL" main:main >> "$LOG" 2>&1; then
    pushed=1
    break
  fi
  say "push attempt ${attempt} rejected — syncing with the other writer"
  if HTTPS_PROXY="$PROXY_VAL" git "${GITCFG[@]}" fetch "$PUSH_URL" main:refs/remotes/board-push/main >> "$LOG" 2>&1; then
    if ! HTTPS_PROXY="$PROXY_VAL" git -c user.name="$(git log -1 --format=%an)" \
         -c user.email="$(git log -1 --format=%ae)" rebase refs/remotes/board-push/main >> "$LOG" 2>&1; then
      git rebase --abort >> "$LOG" 2>&1 || true
      say "ERROR rebase conflict against the other writer — board stays local"
      exit 1
    fi
  fi
  sleep 5
done

if [[ "$pushed" == "1" ]]; then
  echo "$NOW" > "$STAMP_FILE"
  say "published: ${TITLES} (CI will rebuild and the deploy hook ships it)"
else
  say "ERROR push failed after 3 attempts — see $LOG"
  exit 1
fi
