# 首注 Maker 计划 v1 — 2026-11-11

写给愿意在一张没有对手盘的预测市场上先挂一边的人。规则全部可链上验证，没有一条靠信任。

## 现在的事实（不是估计）

| 项目 | 数字 | 怎么验证 |
|---|---|---|
| 可接盘的空白市场 | **210 张**（到期在 3 天后到 60 天内） | `frontend/public/pools.json` + 链上 `getPool()` |
| 所有盘当前净池 | **0 USDC** | 同上，`totalNetPool == 0` |
| 单注门槛 | **50 USDC** | 链上常量 `PredictionArena.MIN_BET = 50000000` |
| 平台手续费 | 4%（结算时才释放） | `PLATFORM_FEE_BPS = 400` |
| 运营方自有资金 | **0.605 USDC** | 部署钱包 `0x436b…5Ba1` 的 USDC 余额 |

最后一行是重点：运营方自己也不够 50 USDC，所以这个计划不是"我们先垫着"，而是"谁先来谁定这个盘的价格"。

## 规则（四条，全部写在合约里）

1. **你选盘、选边、下注 ≥ 50 USDC。** 手续费 4% 托管在合约里，不立刻归平台。
2. **72 小时内没有对手方 → 全额退款。** 运营方调用 `cancelPool()`，你调用 `claimRefund()` 取回 100%（本金 + 4% 手续费）。这条由 `contracts/PredictionArena.sol` 的取消/退款分支保证，且有一个每小时运行的看门狗脚本 `scripts/unmatched-watchdog.ts` 负责真的去调它 —— 不是口头承诺。
3. **有对手方 → 按份额结算。** 纯 pari-mutuel：赢家按 `stake / 该边总份额` 拿走全部净池。没有平台对赌，没有隐藏点差。
4. **你是这张盘的 founding maker。** 盘口页和 README 署名；对手方下注时默认把 referrer 设成你的地址，你可以 `claimReferralFees()` 领走对手方 stake 的 1.2%。

不收费、不托管私钥、不要 KYC。

## 为什么对你划算

等于拿"72 小时的资金占用"去换一个免费仓位：只在你本来就有判断的盘上挂一边（你确信 BTC 不会破 75,300），没人接盘钱原路退回，有人接盘你就已经站在自己的判断那边了。

反过来说清楚风险，别只听好话：

- 起投 50 USDC，低于门槛的交易会被合约 revert。
- 有人接盘后这就是正常赌局，判断错了本金全损（赢了拿回净池）。
- 无人接盘时资金被占用最长 72 小时（看门狗每小时扫一次，超期即取消）。

## 现在就能挑的盘（示例，均 0 流动性）

| 到期 | 盘口 | 链接 |
|---|---|---|
| 11-14 | BTC 是否收在 $76,200 上方 | `https://predictionarena.online/market/726156362` |
| 11-14 | ETH 是否收在 $2,155 上方 | `https://predictionarena.online/market/725472649` |
| 11-15 | BTC 是否收在 $72,500 下方 | `https://predictionarena.online/market/722327222` |

合约：`0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5`（Base 主网，8453）
全套 210 张：`https://predictionarena.online`

## 怎么加入

下注后把 tx hash 发到任一渠道，我们把你登记成该盘的 founding maker 并接上 referrer：

- Bluesky：`@predictionarena.bsky.social`
- Telegram：`https://t.me/predictionarena_hq`
- GitHub issue：`https://github.com/lulaxiao97-create/prediction-arena/issues`

## 运营方自己的承诺边界

- 不伪造成交量、不刷 TVL：任何数字都能在 Basescan 上对。
- 盘口到期后由运营方结算并公布 IPFS 证据哈希；运营方地址不得下注（合约 `OwnerCannotBet` 强制）。
- 若运营方失联，任何人在到期 30 天后可调用 `emergencyRefund()` 强制退款。
