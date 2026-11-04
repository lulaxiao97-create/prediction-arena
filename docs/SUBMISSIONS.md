# 收录提交包（复制粘贴用）

目标站不需要"关系"，只需要**一份填得对的资料**。下面每块都是可直接粘的成品；改数字时以链上为准。
提交前先确认 `/sitemap.xml` 能打开（部署后才有）。

## 一、通用资料卡（所有站共用）

| 字段 | 值 |
|---|---|
| Name | Prediction Arena |
| Tagline (≤60) | Binary prediction markets, settled in USDC on Base |
| One-liner (≤120) | Live-data-priced binary markets where two AI agents argue both sides and every settlement is written on-chain. |
| Category | Prediction Market / DeFi / Base Ecosystem |
| Chain | Base (8453) |
| Contract | `0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5` |
| Website | https://predictionarena.online |
| X | https://x.com/Predict065 |
| Telegram | https://t.me/predictionarena_hq (群) · https://t.me/predictaing_bot (bot) |
| GitHub | https://github.com/lulaxiao97-create/prediction-arena |
| Audit | `audit/` 目录有自审报告；合约无代理、无 mint、无 owner 提款 |
| Logo | https://predictionarena.online/icon-512.png |
| OG | https://predictionarena.online/og.png |
| 启动时间 | 2026-10（Base 主网，部署块 53150166） |

**100 词描述（英文）**

> Prediction Arena is a binary prediction market on Base. Every market is a yes/no question priced from live data — spot prices, funding, exchange balances — and each one carries the rule that settles it, written before anyone can bet. Two AI agents argue the bull and bear case on every market page, so a first-time visitor sees both sides instead of a bare order book. Positions are taken in native USDC, and settlement is recorded on-chain with an evidence hash anyone can re-derive. 232 markets are live across crypto, macro, sports and tech. There is no token sale: 42% of the $ARENA supply is reserved for points holders, distributed 1:1 at launch.

**一句话 hook（中文）**

> 问题先写清楚，赔率由实时数据定，结算上链留证据 —— 这不是又一个赌大小的站。

## 二、逐个站点的提交路径

### 1. DefiLlama（已提 PR，跟进即可）
- PR: https://github.com/DefiLlama/DefiLlama-Adapters/pull/21991
- 现状：CI 已跑通，adapter 输出 `base 0.00`。**TVL=0 是这个 PR 最大的风险**（他们的列表以 TVL 排序，0 会被排到最后）。
- 跟进动作：只要第一个盘有真实 USDC 入金，PR 里的数字就会变；届时在 PR 下回一条带区块浏览器的链接。

### 2. DappRadar — https://dappradar.com/dashboard/submit-dapp
- 需要：登录（邮箱/钱包）、dapp 名称、分类（Prediction Market）、链（Base）、合约、截图 3 张、描述。
- 截图来源：`<repo>/tmp/shots/`（用 `scripts/capture.ps1` 生成，不要放桌面）。

### 3. CoinGecko — https://www.coingecko.com/en/coins/new
- 只有在发行 $ARENA 代币后才适用。**现在不要提交**（无代币会被拒，且留下一次失败记录）。

### 4. GeckoTerminal / DEXScreener
- 需要已存在的 DEX 池子。等 $ARENA 在 Aerodrome/Uniswap 建池后自动出现，无需申请。

### 5. Airdrops.io — https://airdrops.io/submit/
- 分类：Airdrop（Points program）；填"Prediction Arena Points → 42% supply"。
- 必填：官网、X、TG、合约（可选）、简介 100 词。

### 6. Cryptorank — https://cryptorank.io/submit-project
- 需要：项目名、赛道（Prediction Market）、融资（无）、代币（未发）。可以按"Upcoming / Points"提交。

### 7. DropsTab / Alphadrops / AirdropAlert
- 同 5/6 的资料卡，逐个提交。**每个收录都是永久反链**。

### 8. Base 生态目录 — https://www.base.org/ecosystem（Submit app）
- 需要：Base 上的合约、app 链接、分类、一句话简介。Base 官方目录是免费流量入口。

### 9. Bountycaster（Farcaster 悬赏）
- 有 signer 后：发一条 "500 points to the first bot that posts our odds" —— 用积分换外部集成，不花钱。

## 三、提交后的验收（每项都要有 URL）

- [ ] `https://predictionarena.online/sitemap.xml` 200 + 236 条 `<loc>`
- [ ] `https://predictionarena.online/robots.txt` 200 且含 `Sitemap:`
- [ ] Bing Webmaster 里 `site:predictionarena.online` ≥ 1
- [ ] DappRadar profile URL
- [ ] Airdrops.io listing URL
- [ ] Base 生态页 URL

## 四、红线

- 不要写 `airdrop is LIVE`（代币不存在）、不要写 `USDC seed grants`（没这计划）、不要 @PredictionArena（别人的号）。
- 不要买粉、不要刷量：DappRadar/DefiLlama 都会看链上真实交互，刷出来的数据在下一轮审核里会反噬。
