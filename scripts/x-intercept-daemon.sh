#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Cold-start interceptor daemon — read the timeline, queue a reply, type it when the desk is idle.
#
# Division of labour, because each half fails differently:
#   x-intercept-monitor.ts  decides WHAT is worth replying to (reads Nitter RSS, no desktop involved)
#   this script            decides WHEN             (desk idle >= 5 min, rate limits, retries)
#   x-reply.ps1            does the typing          (UIA on the signed-in Chrome window)
#
# Every reply is verified by re-reading the tweet's reply count before/after. A "posted_attempted"
# from the poster is not proof — the composer can close without the reply landing.
#
#   bash scripts/x-intercept-daemon.sh          # foreground
#   tail -f logs/intercept.log
#
# Limits (env-overridable): MIN_GAP=240s between replies, MAX_HOUR=6, MAX_DAY=20, FRESH window 45m
# inside the monitor. A cold-start account that replies faster than that gets rate-limited or
# flagged by X, which would end the channel entirely.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# The mirror and fxtwitter both need the proxy on this box.
PROXY_VAL="$(sed -n 's/^\(HTTPS_PROXY\|https_proxy\)=//p' "$ROOT/.env" 2>/dev/null | head -1)"
export HTTPS_PROXY="${HTTPS_PROXY:-$PROXY_VAL}"
export HTTP_PROXY="${HTTP_PROXY:-$PROXY_VAL}"

BUN="${BUN:-$HOME/.bun/bin/bun}"
LOG="logs/intercept.log"
STATE_DIR=".data/intercept"
QUEUE="$STATE_DIR/reply-queue"
TMP="tmp/reply"
STATUS="$STATE_DIR/status.json"
SWEEP_INTERVAL="${SWEEP_INTERVAL:-180}"
MIN_GAP="${MIN_GAP:-240}"
MAX_HOUR="${MAX_HOUR:-6}"
MAX_DAY="${MAX_DAY:-20}"
IDLE_REQUIRED="${IDLE_REQUIRED:-300}"
REPLY_PS1='C:\Users\Administrator\prediction-arena\scripts\x-reply.ps1'

mkdir -p logs "$QUEUE" "$TMP" "$STATE_DIR"
say() { echo "[$(date -Is)] $*" >>"$LOG"; }

exec 8>"$STATE_DIR/intercept-daemon.lock"
if ! flock -n 8; then
  HOLDER="$(fuser "$STATE_DIR/intercept-daemon.lock" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' | head -1)"
  if [[ -n "${HOLDER:-}" ]] && ps -o cmd= -p "$HOLDER" 2>/dev/null | grep -q '^sleep '; then
    say "reclaiming stale lock from orphaned sleep pid=$HOLDER"
    kill "$HOLDER" 2>/dev/null || true
    sleep 1
  fi
  if ! flock -n 8; then echo "intercept daemon already running"; exit 0; fi
fi
trap 'pkill -P $$ 2>/dev/null; exit 0' TERM INT

say "intercept daemon start pid=$$ (sweep ${SWEEP_INTERVAL}s · gap ${MIN_GAP}s · caps ${MAX_HOUR}/h ${MAX_DAY}/d)"

desk_ready() {
  local v
  v="$(powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\Administrator\prediction-arena\scripts\desk-ready.ps1' -IdleRequired "$IDLE_REQUIRED" 2>/dev/null | tr -d '\r' | grep -E '^(ready|busy|locked|unknown)$' | tail -1)"
  [[ "$v" == "ready" ]]
}

# Reply count straight from fxtwitter: independent of our own UI automation.
tweet_replies() {
  local id="$1" out
  out="$(curl -s -m 25 -A 'Mozilla/5.0' "https://api.fxtwitter.com/i/status/${id}" 2>/dev/null)"
  echo "$out" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); print((d.get("tweet") or {}).get("replies") or 0)
except Exception:
    print(-1)' 2>/dev/null
}

recent_count() {  # recent_count <seconds>  → how many replies were logged in that window
  local window="$1" cutoff
  cutoff=$(( $(date +%s) - window ))
  [[ -f "$STATE_DIR/reply-log.tsv" ]] || { echo 0; return; }
  awk -v c="$cutoff" -F'\t' '$1 >= c && $4 == "ok"' "$STATE_DIR/reply-log.tsv" 2>/dev/null | wc -l | tr -d ' '
}

log_reply() {  # log_reply <epoch> <handle> <id> <ok|fail> <note>
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" >>"$STATE_DIR/reply-log.tsv"
}

write_status() {
  local queued="$1" last="$2"
  cat >"$STATUS" <<EOF
{
  "pid": $$,
  "updatedAt": "$(date -Is)",
  "queuedJobs": ${queued:-0},
  "lastReplyAt": "${last:-}",
  "repliesLastHour": $(recent_count 3600),
  "repliesToday": $(recent_count 86400),
  "note": "reads nitter.kareem.one rss · posts via UIA on the signed-in Chrome · verified by fxtwitter reply count"
}
EOF
}

LAST_REPLY=0

while true; do
  OUT="$("$BUN" scripts/x-intercept-monitor.ts 2>&1)"
  echo "$OUT" >>"$LOG"

  JOBS=$(ls -1 "$QUEUE"/*.json 2>/dev/null | wc -l | tr -d ' ')
  write_status "$JOBS" ""

  if [[ "$JOBS" -gt 0 ]]; then
    if (( $(date +%s) - LAST_REPLY < MIN_GAP )); then
      say "hold: last reply $(( $(date +%s) - LAST_REPLY ))s ago (< ${MIN_GAP}s)"
    elif (( $(recent_count 3600) >= MAX_HOUR )); then
      say "hold: hourly cap ${MAX_HOUR} reached"
    elif (( $(recent_count 86400) >= MAX_DAY )); then
      say "hold: daily cap ${MAX_DAY} reached"
    elif ! desk_ready; then
      say "hold: desk not idle (needs ${IDLE_REQUIRED}s of no input)"
    else
      JOB="$(ls -1t "$QUEUE"/*.json 2>/dev/null | tail -1)"
      if [[ -n "${JOB:-}" ]]; then
        HANDLE="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["handle"])' "$JOB" 2>/dev/null)"
        ID="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["tweetId"])' "$JOB" 2>/dev/null)"
        URL="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["url"])' "$JOB" 2>/dev/null)"

        if [[ -z "${ID:-}" ]]; then
          say "bad job file: $JOB"
          rm -f "$JOB"
        else
          TXT="$TMP/$ID.txt"
          python3 -c 'import json,sys;open(sys.argv[2],"w",encoding="utf-8").write(json.load(open(sys.argv[1]))["text"]+"\n")' "$JOB" "$TXT"
          WIN_TXT="$(wslpath -w "$TXT")"
          BEFORE="$(tweet_replies "$ID")"
          say "reply → @$HANDLE $ID (replies before=$BEFORE)"

          # The reply carries today's card: a reply with a picture gets read, a bare link does not.
          CARD="marketing/PredictionArena_Marketing/01-market-card.png"
          CARD_ARG=()
          if [[ -f "$CARD" ]]; then CARD_ARG=(-ImagePath "$(wslpath -w "$CARD")"); fi

          RESULT="$(powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "$REPLY_PS1" -TweetUrl "$URL" -TextFile "$WIN_TXT" "${CARD_ARG[@]}" 2>&1 | tr -d '\r' | tail -3)"
          say "poster: $(echo "$RESULT" | tr '\n' ' ')"

          if echo "$RESULT" | grep -q "posted_attempted"; then
            sleep 30
            AFTER="$(tweet_replies "$ID")"
            if [[ "$BEFORE" != "-1" && "$AFTER" != "-1" && "$AFTER" -gt "$BEFORE" ]]; then
              say "verified: replies $BEFORE → $AFTER"
              log_reply "$(date +%s)" "$HANDLE" "$ID" ok "$BEFORE->$AFTER"
              LAST_REPLY=$(date +%s)
              python3 - "$STATE_DIR/reply-state.json" "$HANDLE" "$ID" <<'PY'
import json, sys
path, handle, tid = sys.argv[1], sys.argv[2], sys.argv[3]
try: state = json.load(open(path))
except Exception: state = {}
row = state.setdefault(handle, {"lastId": tid, "seenAt": ""})
row.setdefault("replied", []).append(tid)
json.dump(state, open(path, "w"), indent=2)
PY
              rm -f "$JOB"
            else
              say "NOT verified: replies $BEFORE → $AFTER — keeping the job for one more attempt"
              log_reply "$(date +%s)" "$HANDLE" "$ID" fail "unverified $BEFORE->$AFTER"
              python3 - "$JOB" <<'PY'
import json, sys
p = sys.argv[1]
job = json.load(open(p))
job["attempts"] = int(job.get("attempts", 0)) + 1
json.dump(job, open(p, "w"), indent=2)
if job["attempts"] >= 2:
    import os; os.remove(p)
PY
              LAST_REPLY=$(date +%s)
            fi
          else
            say "poster stopped before submit — job kept"
            log_reply "$(date +%s)" "$HANDLE" "$ID" fail "$(echo "$RESULT" | tail -1)"
            LAST_REPLY=$(date +%s)
          fi
          rm -f "$TXT"
        fi
      fi
    fi
  fi

  write_status "$(ls -1 "$QUEUE"/*.json 2>/dev/null | wc -l | tr -d ' ')" "$LAST_REPLY"
  sleep "$SWEEP_INTERVAL"
done
