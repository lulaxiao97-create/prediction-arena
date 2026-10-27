# Prediction Arena — Social & Brand Copy Kit

Operational copy for the two official channels. Everything here is ready to paste; placeholders are
written as `{...}`.

> **Source of truth for the links:** `frontend/src/lib/social.ts`. The footer, header, docs page,
> `/admin` console, share intents and page metadata all read from that file. Change a handle there
> and nowhere else.

---

## 1. Official accounts

| Channel | Handle | URL | Notes |
|---|---|---|---|
| X / Twitter | `@Pred_Arena` | https://x.com/Pred_Arena | Verified as ours: the Telegram channel description points at it. |
| Telegram | `@prediction_arena` | https://t.me/prediction_arena | Channel/group for announcements + desk chat. |
| GitHub | `lulaxiao97-create/prediction-arena` | https://github.com/lulaxiao97-create/prediction-arena | Only source of truth for the deployed code. |
| Contract (Base) | `0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5` | https://basescan.org/address/0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5 | v3: pausable betting, batch reads. |

**Landmines — never link these:**

- `x.com/PredictionArena` — an unrelated Arabic sports-news account. Same letters, different owner.
- `x.com/PredictionArena`, `x.com/prediction_arena`, `t.me/predictionarena` — do **not** exist (X
  returns a login shell, Telegram returns a "contact" fallback). A friendlier-looking handle is not
  the official one.
- Any "support", "helpdesk", "airdrop claim" or "migration" account. There are none.

---

## 2. X / Twitter

### 2.1 Bio (pick one, ≤160 chars)

**A — product-first (default)**

```
Binary markets on Base, priced by live Binance / CoinGecko / DefiLlama data. Two AI agents argue both sides. USDC settles on-chain. 4% fee, escrowed.
```

**B — trader voice**

```
Predict crypto, Base TVL, macro and meme chaos. Live odds, AI bull vs bear, USDC payout on Base. No sign-up, no custody, no house edge games. $PA soon.
```

**C — short (for cross-promo)**

```
Two AI agents. One market. Real USDC on Base. Predict it before it trends.
```

**Display name:** `Prediction Arena` · **Location:** `Base` · **Link:** `https://predictionarena.online`

### 2.2 Pinned tweet — launch (default pin)

```
Two AI agents argue every market. You bet against them. USDC settles on Base. ⚔️

38 live markets: BTC, ETH, Base TVL, AERO, DEGEN, macro, politics, sports.

No sign-up. No custody. 4% fee, escrowed per market and released only on settlement.
→ https://predictionarena.online

@Pred_Arena · #Base #PredictionMarkets
```

### 2.3 Pinned tweet — proof-first (for audits / skeptics)

```
Before you deposit a dollar, read the code path it takes:

· 0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5 (Base, verified)
· Fees escrowed per market, released only by settle()
· Cancelled market → 100% refund, including the 4%
· Claims are never pausable; pausing only stops new bets
· 35 contract tests, public in the repo

Markets: https://predictionarena.online
Source: github.com/lulaxiao97-create/prediction-arena
```

### 2.4 Market-launch template

```
NEW MARKET · {TICKER}

{TITLE}

Now: {YES}% YES (pays {YES_MULT}×) vs {NO}% NO ({NO_MULT}×)
Liquidity: ${LIQUIDITY} · closes {DEADLINE}

AI verdict: {ONE_LINE_FROM_DEBATE}

→ https://predictionarena.online/market/{ID}
```

### 2.5 Settlement template

```
SETTLED · {TICKER}

{TITLE}
Result: {OUTCOME}

Winners: {YES}% → {PAYOUT_MULT}× · evidence hash {HASH_SHORT}
Claim now → https://predictionarena.online/market/{ID}

https://basescan.org/tx/{TX_HASH}
```

### 2.6 Milestone / daily recap template

```
{24H} on the board:

· {MARKETS} markets priced live
· ${VOLUME} settled through the contract
· Biggest mover: {TICKER} — {FROM}% → {TO}%

One AI said it first. The other is still arguing.
https://predictionarena.online
```

### 2.7 Reply etiquette

- Numbers, then opinion. Never a bare "bullish".
- Always quote the market link when replying about a market.
- Never promise returns, never price a token, never discuss an unannounced listing beyond "soon".
- Disclose: `Disclosure: platform operated by Prediction Arena. Not investment advice.`

---

## 3. Telegram

### 3.1 Channel description (≤255 chars)

```
Predict it. Stake crypto. Win instantly. Sports, esports, politics, crypto & celebrity chaos — welcome to Prediction Arena ✨

Official site: predictionarena.online
Follow on X: https://x.com/Pred_Arena
```

### 3.2 Pinned announcement

```
📌 PREDICTION ARENA — START HERE

What it is
Binary markets on Base. Live prices from Binance / CoinGecko / DefiLlama. Two AI agents argue both sides. USDC settles on-chain.

Official links (only these)
· Site — https://predictionarena.online
· X — https://x.com/Pred_Arena
· This channel — https://t.me/prediction_arena
· GitHub — https://github.com/lulaxiao97-create/prediction-arena
· Contract — 0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5 (verify it against the site footer, never trust a DM)

How to start
1. Open the site, connect a Base wallet.
2. Pick a market, hit YES or NO, approve USDC once.
3. Settlement is on-chain with an evidence hash — check the market page.

Fees: 4%, escrowed per market, released only when a market settles. Cancelled market → 100% back.

⚠️ We never DM first. No airdrop claim links. No "support agent". Nobody needs your seed phrase — ever.
```

### 3.3 Welcome message (bot auto-reply / new member)

```
Welcome to Prediction Arena 👋

Read 📌 pinned first — it has the only official links.
Play: https://predictionarena.online
Ask anything in this channel; the desk answers in public, never in DMs.

⚠️ Admins will never DM you first, never ask for a seed phrase, and never send a claim link.
```

### 3.4 Anti-scam notice (post weekly, pin on raid days)

```
🚨 SECURITY NOTICE

· We will never DM you first.
· No airdrop, whitelist, migration or "rescue funds" link is ever sent in a DM.
· The only official handles are @Pred_Arena (X) and @prediction_arena (Telegram).
· The only contract is 0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5 on Base — copy it from the site footer.
· Anyone offering to "recover" your bet, "unlock" a payout, or sell you a bot is stealing from you.
· If someone impersonates us: screenshot, do not click, report to Telegram, and post it here.

Stay sharp. The house edge is the only edge we run.
```

### 3.5 Raid / launch ping (short, for cross-posting)

```
🔥 {TICKER} is live — {TITLE}

{YES}% YES at {YES_MULT}× · closes {DEADLINE}
AI split: {BULL_ONE_LINE} vs {BEAR_ONE_LINE}

→ https://predictionarena.online/market/{ID}
```

---

## 4. Hashtags & mentions

- Primary: `#PredictionMarkets` `#Base` — both, always.
- Contextual: `#DeFi` `#USDC` `#OnchainData` `#AIAgents`.
- Mention `@base` only when the post is genuinely about Base infrastructure; do not spray it.
- Max 3 hashtags per post.

---

## 5. When a handle changes

1. Edit `frontend/src/lib/social.ts` (single source: handle + URL).
2. Update this file's table in §1.
3. Update the Telegram channel description (§3.1) so the cross-links agree.
4. Grep for stragglers before shipping: `grep -rn "Pred_Arena\|prediction_arena" --include=*.ts* --include=*.md .`
5. Rebuild and confirm the footer, header, docs and `/admin` all show the new link.

The site's `Organization` JSON-LD (`sameAs`) and `twitter:site` metadata follow `social.ts`
automatically, so search engines and link previews pick the change up with the next deploy.
