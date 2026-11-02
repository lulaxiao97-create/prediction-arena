# Prediction Arena — Whitepaper v1.0

## 中文速读（TL;DR）

- **是什么**：24/7 由 AI Agent 运营、盘口与结算全部落在 Base 主网的预测市场。232 个盘口、19 个板块、3 条期限梯度，每 30 分钟从公开数据重建一次。
- **谁在运营**：不是人。建盘、定价、开池、结算、分润、写推文都是跑在链上状态上的 cron。
- **积分怎么来**：每 $1 净下注 10 分，冷门方向最高 ×2，48 小时内到期的盘 ×1.5，团长再拿团员积分的 20%。全部由 `BetPlaced` 事件重放算出，改不了。
- **代币怎么分**：总量 10 亿 $ARENA。42% 创世空投（积分 1:1，社区 100% 拥有，零团队预留）、25% Aerodrome 初始流动性（锁 24 个月）、33% 生态与积分蓄水池（4 年线性、社区多签）。
- **钱从哪来**：4% 手续费闭环——1.5% 回购销毁、团长最高 50%（质押锁仓解锁）、其余进金库。没有预售、没有私募、没有一分钱卖给内部人。
- **现在能验证什么**：`pools.json` 232 行、链上 232 个池、积分账本一条命令重算。白皮书里的每个数字都附了 `curl`。

**Version 1.0 · 2026-11-02 · Contract `0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5` (Base, chainId 8453)**

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

## 3. Arena Points System

Points are not a database row an operator can edit. They are a **pure function of chain history**:

```
points(wallet) = Σ bets  floor(netStake_usd × 10 × risk(odds) × horizon(time))
               + Σ 20% of every referee's points
```

### 3.1 The formula, exactly

`frontend/src/lib/points.ts` is the single source of truth; the API, the bot and the marketing cards import
its constants instead of re-typing a number.

| Factor | Value | Rationale |
|---|---|---|
| Base | **10 points per $1** of `netStake` (fee excluded) | a $20 bet is ~200 points: readable, not inflationary |
| Risk | `1 + 2·|p − 0.5|`, capped at **×2** | a 90/10 side is a real forecast; a 50/50 is a coin flip |
| Horizon | **×1.5** if expiry ≤48h, **×1.2** if ≤10d, else ×1 | short-dated markets settle sooner, so they earn sooner |
| Captain | **20%** of each referee's points, from `BetPlaced.referrer` | an on-chain field, not a spreadsheet |
| Social | watch-to-earn ledger (10/ad, 12/day) | counted separately, shown as `socialPoints` |

Worked example — a $50 bet on a 24h market trading at 30% YES:

```
50 × 10 × (1 + 2×0.20) × 1.5 = 50 × 10 × 1.4 × 1.5 = 1,050 points
captain of that bettor:            floor(1,050 × 0.20) = 210 points
```

Both multipliers are bounded on purpose: a whale cannot print an unbounded score by betting a 99/1 side, and
a farmer cannot farm freshness by only playing 24h markets — the ×1.5 pays for faster settlement, not for
volume on its own.

### 3.2 Why replay beats a table

- **Auditable**: `bun scripts/sync-points.ts` rebuilds the whole season from `BetPlaced` logs; anyone can diff it.
- **Unlosable**: no migration, no backup, no "we lost the snapshot". The chain is the backup.
- **Anti-sybil by cost**: the only way to score is to stake USDC on-chain. Follows and likes are worth zero,
  because they cost zero.
- **Grants are files, not favours**: work that never touches the chain (a called shot, a translation, a
  thread that brought ten wallets) is credited from `docs/points/grants.json` — committed before it
  counts, replayed into the same ledger. Likes and reposts earn nothing; they cost nothing.
- **Composable**: the same replay feeds `/api/points`, the daily captain leaderboard, and the projected
  genesis slice shown in the wallet card — one number, three surfaces.

The ledger is published at `/points.json`; `/api/points` returns rules, leaderboard, and a single wallet's
rank plus its projected genesis slice (`points / totalPoints × 420,000,000`).

---

## 4. $ARENA Tokenomics

**Total supply: 1,000,000,000 ARENA — fixed at genesis, with no mint path in the design.**

| Allocation | Share | Tokens | Unlock |
|---|---|---|---|
| **Genesis airdrop (points, 1:1)** | **42%** | 420,000,000 | claimable at genesis from a merkle snapshot; **100% community, zero insider allocation inside this bucket**; unclaimed returns to the ecosystem pool after 12 months |
| **Aerodrome initial liquidity** | **25%** | 250,000,000 | pool created at launch, **locked 24 months**, veAERO held by a community multisig |
| **Ecosystem & points reservoir** | **33%** | 330,000,000 | 4 years linear, community-multisig, milestone-gated: captain incentives, market-maker rebates, integrations, next-season point programmes |

There is no team allocation, no advisor allocation, no VC round and no foundation carve-out. That is not a
moral position, it is an accounting one: the operator is a cron box whose costs are RPC, a domain and audits,
and those are paid out of the fee loop below. A team that is paid by fees does not need a token bag to dump.

### 4.1 The 4% fee loop

The contract already takes `PLATFORM_FEE_BPS = 400` and splits it in escrow on every bet. The genesis-era
target split:

| Sink | Share of the 4% fee | Mechanism |
|---|---|---|
| **Captain rebate — base** | **1.2%** (30% of the rake = `REFERRAL_SHARE_BPS = 3000`) | credited to `BetPlaced.referrer` at bet time, already live; claimable per pool after settlement |
| **Captain rebate — staking bonus** | **+0.8%** (raises a staked captain to **50% of the fee**) | paid from the fee vault at settlement, only to captains who lock 50% of earned ARENA for 90 days |
| **Buyback & burn** | **1.5%** | weekly USDC → ARENA on Aerodrome, sent to `0x…dEaD`, every tx hash published |
| **Treasury / ops** | **1.3%** unstaked · **0.5%** when the captain is staked | community multisig: RPC, audits, domain, incident response |

Burn is **volume-linked, not promised**: no bets, no burn. That is the honest version of a "deflationary
model" — the mechanism is real, and the magnitude is whatever the venue actually earns that week.

### 4.2 Captain staking — commission up to 50%

A captain's economics are deliberately locked to the long term:

1. **Base**: 30% of the rake, escrowed on-chain the moment their referee bets. No invoice, no monthly payout,
   no trust.
2. **Stake 50% of earned ARENA for 90 days** → the commission rises to **50% of the fee (2.0% of stake)**.
   The extra 20 points of rake is paid from the fee vault at settlement, against the on-chain lock.
3. **Staked ARENA carries governance weight** over next season's sector list, the ecosystem spend, and which
   markets get market-maker rebates. Unlock any time; lose the bonus and the weight the day you do.

The points side mirrors it: the 20% referee share stays with the captain only while the lock holds. This is
the point of the mechanism — the distribution channel holds the same asset it is selling, so a captain's
best exit is to keep the venue alive rather than to dump the first claim.

### 4.3 Genesis claim

1. Season close: snapshot `points.json` → merkle root → published on-chain in one transaction.
2. A claim contract verifies inclusion; unclaimed balances recycle to the ecosystem pool after 12 months.
3. Sybil filter: only on-chain stake and *paid* referral stake count. Self-trading pairs are zeroed without
   appeal, and the zeroing is written to the same public ledger.

### 4.4 What exists today

**$ARENA does not exist yet.** There is no token contract, no presale, no private round, nothing purchasable.
This section is a design commitment with numbers attached, not a statement of holdings. The only thing that
exists today is the points ledger — and it exists whether or not the token ever does.

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
escrow, but they can go down. Points are a record of participation, not a security, a share or a promise of
return.

**Nothing is for sale.** No presale, no private round, no paid allocation, no team reserve. If $ARENA never
launches, points remain a scoreboard and this section remains the reason nobody lost money to it.

---

## 6. Roadmap 2026–2027

| Phase | Window | Deliverable | Status |
|---|---|---|---|
| **I. Points reservoir** | Q4 2026 | 232 markets / 19 sectors live, points replay every 30 min, captain bot + daily leaderboard | **live** |
| **II. Genesis Merkle snapshot** | Q1 2027 | season close, merkle root on-chain, claim contract, published sybil review | planned |
| **III. Zero-cost DEX listing** | Q1–Q2 2027 | ARENA/USDC pool on Aerodrome with 25% of supply, 24-month lock, gauge vote — no CEX fee, no IDO | planned |
| **IV. Community market opening** | Q2–Q3 2027 | staked captains propose and open their own sectors; resolution bonds slash bad questions | planned |
| **V. Sector autonomy** | 2027 | per-sector treasuries: the fees a sector earns fund that sector's question writers | planned |

Phase I is the only one that is a promise about the present, and it is checkable right now: 232 rows in
`pools.json`, 232 pool ids on Basescan, and a points ledger anyone can rebuild with one command.

---

## Appendix — verify everything in this document

```bash
curl -s https://predictionarena.online/pools.json | jq '.pools | length'                        # 232
curl -s https://predictionarena.online/api/board | jq '[.pools[].category] | unique | length'  # 19
curl -s https://predictionarena.online/api/points | jq '.rules'                                # scoring rules
bun scripts/sync-points.ts                                                                     # rebuild the ledger
bun scripts/push-desktop-marketing.ts --dry-run                                                # today's flagships

# does a market in the manifest really exist on Base? ask the contract, not us:
cast call 0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5 \
  "getPool(uint256)((string,string,uint64,uint8,uint8,uint256,uint256,uint256,bytes32))" \
  723245834 --rpc-url https://mainnet.base.org
# → ("Will Bitcoin trade above $78,800 before November 3 2026, 02:00 UTC?", "Crypto Core", …)
```

Contract: `0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5` · USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
· Source: `contracts/PredictionArena.sol` · Points rules: `frontend/src/lib/points.ts`
