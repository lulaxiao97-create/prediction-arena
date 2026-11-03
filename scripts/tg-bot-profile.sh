#!/usr/bin/env bash
# Set the bot's public profile: command menu, short description, long description.
#
# The bot's own profile is the first thing a group owner reads when the deep link opens, and it is
# the only place the 30% terms can be stated before anyone types anything. Doing it through the API
# instead of BotFather means it is reproducible after a bot is recreated, and it lives in the repo
# with the rest of the copy.
#
#   bash scripts/tg-bot-profile.sh
#
# Needs the token in TELEGRAM_BOT_TOKEN or ~/.hermes/.tg_bot_token; the proxy (if any) comes from
# ~/.hermes/.proxy, same as scripts/start-telegram-bot.sh.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN="${TELEGRAM_BOT_TOKEN:-}"
if [[ -z "$TOKEN" && -s "$HOME/.hermes/.tg_bot_token" ]]; then
  TOKEN="$(cat "$HOME/.hermes/.tg_bot_token")"
fi
if [[ -z "$TOKEN" ]]; then
  echo "no bot token (TELEGRAM_BOT_TOKEN or ~/.hermes/.tg_bot_token)"; exit 2
fi

PROXY_FILE="${PROXY_FILE:-$HOME/.hermes/.proxy}"
if [[ -z "${HTTPS_PROXY:-}" && -s "$PROXY_FILE" ]]; then
  HTTPS_PROXY="$(cat "$PROXY_FILE")"; export HTTPS_PROXY HTTP_PROXY="$HTTPS_PROXY"
fi

API="https://api.telegram.org/bot${TOKEN}"

post() { curl -sS -m 20 -X POST "$API/$1" -H 'content-type: application/json' -d "$2"; echo; }

post setMyCommands '{"commands":[
  {"command":"captain","description":"Your ref link · 30% of the 4% fee"},
  {"command":"boost","description":"Check your points multiplier"},
  {"command":"link","description":"Resend my payout link"},
  {"command":"copy","description":"Paste-ready group post"},
  {"command":"markets","description":"Today markets"},
  {"command":"how","description":"How the 30% is paid"},
  {"command":"help","description":"What this bot does"}
]}'

post setMyShortDescription '{"short_description":"Take 30% of the platform 4% fee: bind your Base wallet, get your own link, the contract pays you at settlement."}'

post setMyDescription '{"description":"Prediction Arena captains.\n\nSend /captain, give me the Base wallet you want to be paid at, and you get:\n- your own link with that address as the on-chain payee (?ref=0x...)\n- a paste-ready group post in plain English\n\nHow the cut works: every position that comes through your link pays 30% of the platform 4% fee to your address at settlement. It is paid by the contract, not by us - check it on Basescan. No sign-up, no KYC, no custody, no promises of revenue."}' 

curl -sS -m 20 "$API/getMyCommands" | head -c 400; echo
