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
  {"command":"captain","description":"拿专属链接 · 平台手续费 30%"},
  {"command":"link","description":"补发我的分润链接"},
  {"command":"copy","description":"群发话术（复制即可发群）"},
  {"command":"markets","description":"今天的盘口"},
  {"command":"how","description":"30% 怎么结算"},
  {"command":"help","description":"能做什么"}
]}'

post setMyShortDescription '{"short_description":"拿平台 4% 手续费的 30%：绑定钱包 → 专属链接 → 群发文案，合约结算时直接付给你。"}'

post setMyDescription '{"description":"Prediction Arena 团长计划。\n\n发 /captain，把收款钱包发给我，立刻拿到：\n· 带你自己地址的专属链接（?ref=0x…）\n· 中英两版群发话术，直接复制到你的群\n\n分成口径：通过你的链接下的每一笔仓位，结算时合约把平台 4% 手续费的 30% 记给你。不是我们转账，是合约直接付，Basescan 可查。没有注册、没有 KYC、不托管资金、没有保底承诺。"}'

curl -sS -m 20 "$API/getMyCommands" | head -c 400; echo
