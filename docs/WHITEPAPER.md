# Prediction Arena — Whitepaper v1.1

## 中文速读（TL;DR）

- **是什么**：24/7 由 AI Agent 运营、盘口与结算全部落在 Base 主网的预测市场。232 个盘口、19 个板块、3 条期限梯度，每 30 分钟从公开数据重建一次。
- **谁在运营**：不是人。建盘、定价、开池、结算、分润、写推文都是跑在链上状态上的 cron。
- **怎么玩**：选一个盘口 → 读它的结算规则（数据源 + 读数时间写在盘口里）→ 押 YES/NO，或按「不用钱包」直接表态 → 到期后合约结算，赢家领取，输家的本金付给赢家。
- **钱从哪来**：只有 4% 手续费。其中 30%（= 流水的 1.2%）在结算时直接付给带量的推荐人，其余 2.8% 进运营金库。没有预售、没有私募、没有一分钱卖给内部人。
- **活动是什么**：事件盘（FOMC / CPI / ETF 类）按日历开，普通盘 24/7 滚动；每笔结算都带证据哈希和 tx，任何人都能逐笔核对。
- **现在能验证什么**：`pools.json` 的每一行、Base 上每个池、每笔结算的 tx。白皮书里的每个数字都附了 `curl`。

**Version 1.1 · 2026-11-10 · Contract `0xdFaF86Cf3B53c14f7Ef60d032E6C501161682a3a` (Base, chainId 8453)**

> **v1.1 撤回说明（2026-11-10）**
>
> v1.0 描述了两件当时并不存在的东西：一套积分账本（1:1 兑换未来代币）和一个 $ARENA 代币分配表。
> 广告变现是这套积分的唯一兑付来源，而广告方 HypeLab 在审核后答复「predictionarena.online 的曝光量尚未
> 达到成为发布商的门槛」。没有外部收入，就没有能兑现的积分，也就没有能兑现的空投。
>
> 因此本版撤回第 3 章（积分制度）与第 4 章（代币分配），并从产品里撤下 `points.json`、`/api/points` 与
> 看广告得积分的入口。没有保留「先记着、以后再兑现」的账本 —— 那正是一份无法验证的承诺。
>
> 保留下来的只有合约真正在做的事：4% 手续费、其中 30% 给推荐人、到期结算、赢家领取。第 4 章现在只写
> 这部分，每一行都能在 Basescan 上对上。

---

## 1. Abstract & Vision

Every prediction market on the internet ships the same three failures:

| Failure | What it looks like | What it costs |
|---|---|---|
| **Thin shelves** | a dozen markets, all about BTC, half of them stale | the other 95% of the world's attention is unpriced |
| **Heavy operations** | a human decides when a market opens, what it resolves to, whether the tweet matches the book | every listing is a payroll line; every settlement is a judgement call |
| **Extractive distribution** | referrers are paid in promises, or in a spreadsheet that never settles | the people who actually bring liquidity own none of the upside |

Prediction Arena is the opposite on all three axes, and the opposition is mechanical, not rhetorical:

- **232 live markets across 19 sectors** — BTC intraday touches, NFT floors, Fed prints, Champions League
  matchdays, box-office weekends, MiCA deadlines — rebuilt every 30 minutes from public feeds.
- **A machine runs the venue.** Market generation, strike selection, pool creation, settlement accounting,
  copywriting and referral attribution are cron jobs over on-chain state. No human picks a number between ticks.
- **The distributor is paid by the contract.** 30% of the 4% fee is escrowed to the wallet that brought the
  bet at the moment the bet lands; a staked captain takes 50%. It is paid out of settlement, not out of a
  marketing budget that can be cut next quarter.

The thesis is narrow and testable: **a prediction market is only as good as its resolution.** So the product
is built backwards from settlement — every market names its data source and the timestamp it was read at,
every payout is a transaction, and every claim in this document can be checked against `pools.json`, Basescan,
or a FRED CSV you can download yourself.

**Vision.** A venue where the question surface is as wide as the internet's attention, where the operator is
a cron file you can read, and where the people who bring liquidity own the upside. That is the whole
roadmap; everything below is implementation detail.

---

## 2. Architecture & Multi-Sector Engine

### 2.1 The loop

```
live feeds (Binance · CoinGecko · DefiLlama · Yahoo · FRED)
        │  every 30 min
        ▼
scripts/gen-board.ts ──► 232 markets · 19 lanes · 3 horizons · sticky strikes
        │                          │
        │ pools.json / prices.json │ open-pools-batch.sh (nonce-safe, 30 pools/tick)
        ▼                          ▼
Next.js app   ◄────────  PredictionArena V3 on Base (USDC escrow, 4% fee)
        ▲                          │  BetPlaced / PoolSettled
        │                          ▼
   Farcaster Frame · OG cards   attribution (scripts/sync-attribution.ts)
        ▲                          │
        └──── Telegram captains ◄──┘  30% of the fee, escrowed by the contract
```

Three properties fall out of that diagram, and they are the reason it is drawn as a loop rather than a stack:

1. **The board is a build artifact, not a content calendar.** `gen-board.ts` reads live feeds, writes
   `pools.json` (what the app renders) and hands the same rows to the pool opener (what the chain holds).
   One source of truth, two consumers.
2. **The chain is the ledger.** The app never invents a balance; it reads `pools.json` for the question text
   and the contract for the money. A hostile frontend can lie about copy — it cannot lie about escrow.
3. **Attribution is derived, not typed.** `sync-attribution.ts` rebuilds referrer totals from `BetPlaced`
   logs, so a captain's dashboard and the contract's `poolReferral` mapping are the same number.

### 2.2 The 19 sectors

| # | Sector | What is priced | Primary source |
|---|---|---|---|
| 1 | Crypto Core | BTC/ETH/SOL/BNB/XRP/DOGE touch and close levels, dominance, total cap | Binance, CoinGecko |
| 2 | DeFi & Yield | chain TVL, DEX volume, lending TVL, AERO/UNI/AAVE | DefiLlama |
| 3 | Layer 2 & Base | Base TVL, throughput, sequencer revenue, L2 fees | DefiLlama, L2Beat |
| 4 | Memes & Social | DEGEN/BRETT/TOSHI/MOG/ZORA relative moves | CoinGecko |
| 5 | AI Agents & Tech | model releases, agent payments, inference prices, ZKML | vendor docs, on-chain |
| 6 | Macro Economy | Fed range, CPI, 10y, 2s10s, unemployment, mortgage | FRED (keyless CSV) |
| 7 | US Politics & Policy | bills, SEC/CFTC actions, stablecoin law | congress.gov, dockets |
| 8 | Global Stocks | NVDA/AAPL/MSFT/GOOGL/TSLA/META/AMD, S&P, Nasdaq | Yahoo Finance |
| 9 | Commodities & Metals | gold, silver, WTI, copper, gold/silver ratio | COMEX/NYMEX |
| 10 | Sports & Gaming | UCL, NBA, NFL, F1, esports, tennis, MLB | official results |
| 11 | Entertainment & Pop | box office, streaming prices, awards, KOL drama | Box Office Mojo, charts |
| 12 | Prediction Markets | Polymarket volume, category TVL, licences | Dune, DefiLlama |
| 13 | NFTs & Digital Art | blue-chip floors, Blur volume, NFT lending | Blur, OpenSea, DefiLlama |
| 14 | Web3 Infrastructure | outages, upgrades, staking share, blob fees, RPC | status pages, Dune |
| 15 | Real World Events | SpaceX, SMR permits, quantum, fusion, robotaxi | mission logs, regulators |
| 16 | VC & Startup Deals | AI valuations, crypto VC funding, IPO filings | S-1s, funding data |
| 17 | Asia & Regional | BOJ, PBOC LPR, Japan CPI, India GDP, HK licences | central banks |
| 18 | Degen Dials | 24h touch markets on the high-beta tail | Binance, CoinGecko |
| 19 | Global Policy | MiCA, FATF, CARF, AI Act, Basel | official registers |

The current split is 31 crypto-core markets, 26 global stocks, 18 memes, 16 sports, 15 DeFi, 14 L2/Base,
13 macro, 13 commodities, 13 degen dials — and a long tail down to 6 markets in each of prediction-market
venues, NFTs and VC deals. `curl /pools.json | jq` reproduces that line exactly.

### 2.3 Three horizons, one ladder

A board with a single deadline is a cliff: full on the 1st, a countdown on the 28th. So every sector is
opened on three rungs at once, and each rung rolls forward before it expires:

| Rung | Window | Resolution semantics |
|---|---|---|
| 24h | next 24 hours | **touch** — any print counts, barrier probability |
| mid | 3–9 days | close on any daily candle |
| long | month / quarter end | close on any daily candle; rungs roll if <12 / <30 days remain |

### 2.4 Sticky strikes (why the pool and the card never disagree)

A market's strike and deadline are fixed the first time it is built (`board-sticky.json`) and reused until
it is close to expiry. Without this, a 1% move in spot would re-strike every card, which changes the title,
which changes the id (ids are a hash of the title), which would strand the existing pool with a different
question than the one people bet on. Odds still reprice every tick: **the term is frozen, the price is not.**

### 2.5 From feed to escrow: the on-chain path

Every market makes the same four calls, and nothing else touches user money:

| Step | Call | Who can call it | What it does |
|---|---|---|---|
| Opening | `createPool(poolId, title, category, endTime)` | owner (cron) | pins the question, category and deadline; id is derived from the title so two runs cannot double-open |
| Betting | `bet(poolId, option, amount, referrer)` | anyone | pulls USDC, takes `FEE_BPS = 400`, splits the rake to `referrer`, escrows the net stake |
| Settling | `settle(poolId, winningOption, ipfsDataHash)` | owner | records the winner and a content hash of the evidence; **cannot move stakes** |
| Claiming | `claimRewards(poolId)` / `claimRefund(poolId)` | the bettor | pari-mutuel payout, or a 100% refund if the pool was cancelled |

Pools are opened in nonce-safe batches of 30 per tick so a reorg or a stuck nonce cannot strand half a board.
A cancelled pool refunds `stake + feePaid` in full — the fee is not kept on a void market, which is the
cheapest way to prove the house is not trading against its own users.

### 2.6 Settlement and evidence

`PoolSettled(poolId, winningOption, ipfsDataHash)` records the outcome and a content hash of the resolution
evidence (the print, the filing, the final whistle). Payouts are pari-mutuel from escrow; the rake is split at
that moment. There is no admin switch that can move a settled pool's money, and no function that can rewrite
a settled outcome.

---

## 3. The participation record — withdrawn 2026-11-10

Version 1.0 described a points ledger: 10 points per $1 staked, multipliers for contrarian sides and short
horizons, 20% of a referee's points to their captain, plus a separate watch-to-earn tally. It is gone, and
the reason is in the notice at the top of this document.

**Why it was withdrawn.** The points were not a game score. They were a promise priced in a token that does
not exist — the whitepaper said 1:1 at genesis, across 42% of supply. That promise had exactly one funding
source, the ad venue, and the venue declined us in writing because the site's impression volume is below its
publisher floor. Keeping the ledger would have meant telling every registered wallet that their score still
counted, with nothing behind it.

**What was removed from the product**, not just from this document:

- `frontend/public/points.json`, `/api/points`, `/api/rewards`, `/api/metrics/ad`
- the watch-to-earn modal, the free-ticket rail inside the trade panel, the points card in the portfolio
  drawer, and the "Arena Points" strip on the landing dashboard
- `scripts/sync-points.ts` and the two cron entries that rebuilt and mailed the ledger
- the bot's bind bonus, its 5× "hashpower" multiplier and its channel grant — it now reports the crew count
  it can read from its own register, and nothing else

**What replaced it.** A free, wallet-less pick: the "I say yes / I say no" row under the featured market. It
is counted server-side (`/api/guess`, one tap per IP per market) and the number under the buttons is the
taps that actually arrived. It pays nothing, because there is nothing to pay — the payoff is the answer when
the market settles, which is the same thing that pays a real bettor.

---

## 4. The 4% fee — what the contract pays

### 4.1 Where every basis point goes

The contract takes `PLATFORM_FEE_BPS = 400` and splits it in escrow on every bet. Two sinks, both live:

| Sink | Share of the 4% fee | Mechanism |
|---|---|---|
| **Referral rebate** | **1.2%** (30% of the rake, `REFERRAL_SHARE_BPS = 3000`) | credited to `BetPlaced.referrer` at bet time; claimable per pool with `claimRewards` after settlement |
| **Treasury / ops** | **2.8%** | the remainder, withdrawn by the admin through `withdrawAdminFees` |

1.2% of every stake is the whole referral programme. There is no "staked captain" tier, no buyback, no burn
and no governance weight, because each of those was denominated in a token that does not exist. What is left
is the part anyone can check on Basescan today.

### 4.2 What a bettor and a referrer actually receive

- **Bettor**: wins when their side carries the majority of the net pool at settlement; the payout is
  `netStake / winningSide × netPool`, pulled with `claimRewards`.
- **Referrer**: 30% of that pool's fee, credited at bet time against the `referrer` field the contract stores,
  claimable after settlement whether or not they ever opened the site again.
- **Both**: nothing is held by us. The escrow is the contract; the payout is a transaction.

### 4.3 Token status

**There is no $ARENA token, no claim contract and no snapshot.** The v1.0 allocation table (42% airdrop, 25%
Aerodrome liquidity, 33% ecosystem) is withdrawn along with the points system it was denominated in. If a
token is ever designed, it will be described in a document dated after the thing exists, not before.

---

## 5. Security & Trustless Execution

| Property | How it is enforced |
|---|---|
| Custody | none — USDC sits in the pool contract until `claimRewards` |
| Resolution | `PoolSettled` + IPFS content hash per pool; the evidence is addressable forever |
| Upgrades | no proxy; the arena is an immutable deployment, referenced by address in every manifest |
| Admin power | `onlyOwner` can create and settle pools; it **cannot** touch stakes, rewrite history, or move a settled pool's money |
| Refunds | a cancelled pool returns `stake + feePaid`; the house keeps nothing on a void market |
| Frontend trust | the app reads `pools.json` and the chain; a hostile frontend can lie about copy, never about balances |
| Data provenance | every market row carries `dataSource` + `dataAsOf`; the generator refuses to build from a snapshot older than 3h |
| Board floor | `gen-board` refuses to write a board under 100 markets; publish refuses to ship one |
| Fee isolation | referral money is per-pool and only released after settlement; player funds and platform profit are separate counters |

**What this does not claim.** The contract is small and reviewed, not formally verified. No audit makes a
contract risk-free. The frontend, the bot and the cron box are trusted infrastructure — they cannot steal
escrow, but they can go down.

**Nothing is for sale.** No presale, no private round, no paid allocation, no team reserve, and no token of
any kind. The only money this venue moves is a bettor's stake and the fee it splits.

---

## 6. Roadmap 2026–2027

| Phase | Window | Deliverable | Status |
|---|---|---|---|
| **I. The board** | Q4 2026 | 232 markets / 19 sectors live, rebuilt every 30 min, captain bot + on-chain referral payouts | **live** |
| **II. Free picks** | Q4 2026 | wallet-less "I say yes / I say no", counted server-side, shareable as a PNG | **live** |
| **III. Event calendar** | Q1 2027 | FOMC / CPI / ETF markets opened 48h before the print, data source named on the card | planned |
| **IV. Community market opening** | Q2–Q3 2027 | referral captains propose sectors; resolution bonds slash bad questions | planned |
| **V. Sector autonomy** | 2027 | per-sector treasuries: the fees a sector earns fund that sector's question writers | planned |

Phases I and II are promises about the present, and both are checkable right now: 232 rows in `pools.json`,
232 pool ids on Basescan, and a tap counter that only moves when a real tap arrives.

---

## Appendix — verify everything in this document

```bash
curl -s https://predictionarena.online/pools.json | jq '.pools | length'                        # 232
curl -s https://predictionarena.online/api/board | jq '[.pools[].category] | unique | length'  # 19
curl -s "https://predictionarena.online/api/guess?id=723245834" | jq                         # free-pick count
bun scripts/push-desktop-marketing.ts --dry-run                                                # today's flagships

# does a market in the manifest really exist on Base? ask the contract, not us:
cast call 0xdFaF86Cf3B53c14f7Ef60d032E6C501161682a3a \
  "getPool(uint256)((string,string,uint64,uint8,uint8,uint256,uint256,uint256,bytes32))" \
  723245834 --rpc-url https://mainnet.base.org
# → ("Will Bitcoin trade above $78,800 before November 3 2026, 02:00 UTC?", "Crypto Core", …)
```

Contract: `0xdFaF86Cf3B53c14f7Ef60d032E6C501161682a3a` · USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
· Source: `contracts/PredictionArena.sol` · Free picks: `frontend/src/app/api/guess/route.ts`
