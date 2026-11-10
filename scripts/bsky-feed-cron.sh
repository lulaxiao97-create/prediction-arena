#!/usr/bin/env bash
# Refresh the custom-feed candidate pool and publish it.
#
# Two halves, both needed: the search needs our session (only on this machine), the route reads a
# committed file (only the deploy has the route). So the cron refreshes the file and pushes; Render
# auto-deploys on push. A failed push is not fatal — the previous skeleton keeps serving.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

export HTTPS_PROXY=http://172.17.240.1:16781 HTTP_PROXY=http://172.17.240.1:16781
export PATH="$HOME/.bun/bin:$PATH"
LOG=logs/cron-bsky-feed.log
mkdir -p logs

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

if ! out=$(timeout 240 bun scripts/bsky-feed-refresh.ts 2>&1); then
  echo "$(stamp) refresh failed: $out" >> "$LOG"
  exit 1
fi
echo "$(stamp) $out" >> "$LOG"

if git diff --quiet -- frontend/public/feed-skeleton.json; then
  echo "$(stamp) skeleton unchanged" >> "$LOG"
  exit 0
fi

# Path-limited commit. A bare `git commit` ships the whole index, which on 2026-11-10 meant this
# job swept a session's staged deletions into a commit titled "refresh feed candidate pool" — every
# file landed, none of it under the message that described it. `-- <path>` keeps the job to its own file.
git add frontend/public/feed-skeleton.json
git -c user.name="A-Liu" -c user.email="aliu@local" commit -q -m "chore(bluesky): refresh feed candidate pool" -- frontend/public/feed-skeleton.json >> "$LOG" 2>&1

TOK=$(cat "$HOME/.hermes/.gh_token_predictionarena")
if git -c "url.https://x:${TOK}@github.com/.insteadOf=https://github.com/" \
       -c http.proxy=http://172.17.240.1:16781 \
       push "https://x:${TOK}@github.com/lulaxiao97-create/prediction-arena.git" main:main >> "$LOG" 2>&1; then
  echo "$(stamp) pushed skeleton" >> "$LOG"
else
  echo "$(stamp) push failed" >> "$LOG"
fi
