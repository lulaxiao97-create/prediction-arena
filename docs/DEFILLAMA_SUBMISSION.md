# DefiLlama submission — Prediction Arena (Base)

Everything in this file is meant to be copy-pasted into a PR against
[`DefiLlama/DefiLlama-Adapters`](https://github.com/DefiLlama/DefiLlama-Adapters). The adapter source of
truth in this repo is `scripts/defillama-adapter.ts`; the JS below is the same logic in the shape that
repo's test harness loads.

## 0. What gets indexed, in one sentence

> USDC held by the Prediction Arena contract on Base — the escrow every stake sits in until its pool
> settles (pari-mutuel payout) or is cancelled (100% refund).

Two corrections to the usual "factory + per-market contracts" story, because the PR has to describe the
chain truthfully:

- **There is no factory.** All 232 markets are `poolId`s inside **one** immutable contract,
  `0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5` (chainId 8453). `createPool(poolId, …)` per market,
  `bet(poolId, …)`, `settle(poolId, …)`.
- **TVL is a balance, not a sum.** Because payouts, refunds and unclaimed platform fees all rest in the
  same address, `usdc.balanceOf(arena)` is the only number that cannot be argued with. Open interest is
  reported separately by our own CLI (sum of `totalNetPool` over open pools) and is *not* submitted as
  TVL.

## 1. Adapter to add

`projects/prediction-arena/index.js`:

```js
const ADDRESSES = require('../helper/coreAssets.json')

// One immutable arena contract on Base. Markets are poolIds inside it, not separate contracts.
const ARENA = '0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5'

module.exports = {
  timetravel: true,
  misrepresentedTokens: false,
  methodology:
    'USDC escrowed by the Prediction Arena contract. Every stake is held there until its pool settles (pari-mutuel) or is cancelled (100% refund); unclaimed payouts and platform fees sit in the same balance.',
  base: {
    tvl: async (api) => {
      const balance = await api.call({
        abi: 'erc20:balanceOf',
        target: ADDRESSES.base.USDC,
        params: [ARENA],
      })
      api.add(ADDRESSES.base.USDC, balance)
    },
  },
}
```

`projects/prediction-arena/package.json` (optional, only if the repo asks for one):

```json
{
  "name": "prediction-arena",
  "version": "1.0.0",
  "private": true
}
```

## 2. Verify before opening the PR

Locally, from this repo (needs an RPC; the public Base endpoint is enough):

```bash
export BASE_RPC_URL=https://mainnet.base.org
bun scripts/defillama-adapter.ts          # TVL + open interest, in USD
bun scripts/defillama-adapter.ts --json   # machine-readable, for the PR description
```

Cross-check the same number without our code — the balance must match to the cent:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cast call 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  "balanceOf(address)(uint256)" 0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5 \
  --rpc-url https://mainnet.base.org
```

Then the DefiLlama-side test, inside a clone of their repo:

```bash
git clone https://github.com/DefiLlama/DefiLlama-Adapters.git
cd DefiLlama-Adapters
# copy the two files from step 1 into projects/prediction-arena/
node test.js projects/prediction-arena/index.js
```

`node test.js` prints the chain's TVL and fails if the adapter throws or returns nothing. A `$0` result
is a **pass** while the venue has no open positions — it is not an error, and the PR description should
say so explicitly so a reviewer does not read it as a broken adapter.

## 3. PR checklist

1. Fork `DefiLlama/DefiLlama-Adapters`, branch `add-prediction-arena`.
2. Add `projects/prediction-arena/index.js` (and `package.json` if their linter asks).
3. `node test.js projects/prediction-arena/index.js` → passes; paste the output in the PR body.
4. PR title: `Add Prediction Arena (Base)`. Body:
   - one-line description + site (`https://predictionarena.online`) + docs (`/whitepaper`);
   - contract address + Basescan link, and a note that all 232 markets live inside it;
   - the `node test.js` output;
   - the `cast call balanceOf` output as an independent cross-check;
   - confirmation there is no proxy, no upgrade admin over user funds, and no token yet.
5. Wait for a reviewer; if they ask for `volume` (daily betting volume), point them at
   `docs/DUNE_DASHBOARD.sql` — DefiLlama's volume adapters are for DEX-style swaps; a pari-mutuel book
   reports volume through the `BetPlaced` event, which Dune indexes and we publish.

## 4. What we do NOT claim

- No token exists. There is no `$ARENA` contract address to add to the token list yet — do not submit one.
- TVL does not include "open interest": a settled-but-unclaimed payout is still inside the balance, and a
  cancelled pool is refunded in full, so the balance is always the honest number.
- Volume is not fabricated from the manifest. If the reviewer wants volume, it comes from `BetPlaced`
  logs (query 1 in `docs/DUNE_DASHBOARD.sql`), not from an API we control.

## 5. DappRadar (same facts, different form)

DappRadar takes a dapp listing rather than an adapter. Submit at <https://dappradar.com/dashboard>:

- Chain: Base · Category: Prediction Markets
- Contract: `0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5`
- Metrics they can verify themselves: `BetPlaced` count and `usdc.balanceOf(arena)`; both are in the
  commands above. Do not hand them a dashboard number we computed off-chain.
