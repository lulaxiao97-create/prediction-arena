# Zero-Budget Growth — the Farcaster-first playbook

No ad spend, no KOL budget, no airdrop. What we have is a working product on Base, a contract that
already pays referrers out of its own fee, and an attribution chain that survives a two-minute
browse. This document is how to spend those three assets instead of money.

> **The constraint that shapes everything below.** We cannot buy attention, so we have to earn it
> with a number nobody else has: a live probability, an on-chain fee split, and a settlement anyone
> can verify. Every tactic here is "show the number, link the market" — not "announce the product".

---

## 0. The machine we are feeding

| Piece | Where it lives | What it does for growth |
|---|---|---|
| Farcaster Frame | `<meta name="fc:frame:*">` on every market page + `/api/frame` | A market becomes a tappable card inside Warpcast, no click-out to a landing page |
| `?ref=` capture | `frontend/src/lib/referral.ts` (localStorage + 30-day cookie) | A visitor who arrives from a Frame still credits the referrer when they bet five minutes later |
| On-chain referral payout | `bet(poolId, option, amount, referrer)` splits the 4% fee | The referrer is paid **by the contract**, not by us — the loop costs $0 |
| Invite link | Portfolio drawer → *Invite & earn* | One tap turns a connected wallet into a distribution node |
| Watch-to-Earn | points → $1 trial ticket | A wallet with no USDC can still take a position, which is the only way a cold audience converts |

Everything else in this playbook is just pointing traffic at that machine.

---

## 1. Farcaster: the channel matrix

Farcaster rewards specificity and punishes broadcasting. Post a market, not an announcement; reply
inside a thread about the same asset, not into the void.

### 1.1 Channel map (post here, in this order)

| Channel | Audience | What to post | Cadence |
|---|---|---|---|
| `/base` | Base-native builders and traders | A Base-ecosystem market (AERO TVL, DEGEN, Base TVL) with the frame link | 3×/week |
| `/degen` | Meme traders, high risk appetite | The widest-odds market of the day ("YES pays 7.4×") — degen reads payout, not prose | daily |
| `/crypto` | General crypto | BTC/ETH strike markets at the moment spot is near the strike | 2×/week |
| `/predictions` (and any prediction-market channel) | Direct competitors' users | A settlement receipt: outcome + evidence hash + what the AI got wrong | per settlement |
| `/buildonbase`, `/onchain` | Builders | Engineering posts: fee escrow mechanics, why claims are never pausable | 1×/week |

### 1.2 The post shape that works

```
{one number the reader cannot get elsewhere}

{market title as a question}

{yes}% YES · pays {mult}× · {traders} traders · closes in {hours}h

{one clause of why it matters: the feed, the strike vs spot, the AI disagreement}
```

Rules that keep reach:

1. **Frame link, not a bare URL.** A frame renders the probability inside the feed; a bare URL
   renders a grey box. Every market page already emits the tags — paste the market link.
2. **One market per post.** Two markets in one cast halves the tap-through of both.
3. **Reply into the asset conversation.** An AERO market belongs under an Aerodrome thread, not in
   a fresh cast nobody is reading.
4. **Never post the same market twice in 24h.** Reposting kills the channel's tolerance for you.
5. **No "gm" farming.** Channels remember accounts that only farm engagement.

### 1.3 The AI Debate angle (our unfair copy advantage)

The two agents already disagree in public. Pull the sharpest line from a market's debate and lead
with it:

> The bear agent's whole case is that funding flipped negative two days before expiry. The bull
> agent does not care. 24% YES · pays 4.2× · 310 traders.
> {frame link}

That is a post only a product with a real model can write. Use it 2–3× a week, not daily, or it
reads as a gimmick.

### 1.4 Settlement receipts (the trust engine)

After every settlement: outcome, winning multiple, evidence hash, and **one line admitting what the
agents got wrong**. Receipts are what turn a lurker into a bettor — nobody believes a venue that
only posts wins.

---

## 2. X (`@Predict065`): guerrilla replies, not broadcast

We have ~0 followers, so the timeline is worthless. The reply section under a large account is the
only surface where a new handle gets seen by thousands.

### 2.1 Target accounts and what to say

| Target | Their post | Our reply shape |
|---|---|---|
| `@aerodrome_fi` / AERO announcements | TVL or emissions news | "AERO TVL market on Base is at {yes}% after this — pays {mult}×. {link}" |
| `@degen_token` / DEGEN ecosystem | price or builder news | "The board has DEGEN above {strike} at {yes}% YES. {link}" |
| `@zora` / creator-economy posts | drops, mints | Reply only when there is a genuinely related market; otherwise skip — off-topic replies get muted |
| `@base` / Base ecosystem | network milestones | "Base TVL market: {yes}% YES, {traders} traders, closes {date}. {link}" |
| `@coinbase` / `@base` product posts | anything about onchain fees | "Our fee sits in per-market escrow and refunds in full on cancel — the mechanic, not a promise. {link}" |

### 2.2 The five rules of reply-guerrilla

1. **Answer the post first, plug second.** A reply that only links gets reported; a reply that
   adds a number gets liked.
2. **Never more than one link.** Two links reads as spam to both humans and the algorithm.
3. **Quote their number back.** "You said $2.1B TVL — the market closes at $2.0B, so it's 38% YES."
4. **Reply within 20 minutes** of the target post; after that the thread is dead.
5. **Maximum 8 replies/day per account.** Beyond that, the account gets throttled into oblivion.

### 2.3 What not to do

- No @-mention spam in the main timeline ("@a @b @c check this") — it is the fastest route to a
  shadowban.
- No fake engagement pods. The accounts that do this are the same ones that get their links
  blacklisted.
- No "0% fee" / "guaranteed" language. A skeptic disproves it in one click and screenshots it.

---

## 3. Telegram: cross-community, compliant

We own one channel (`@predictionarena_hq`, small). The reach has to come from other people's groups,
and every one of them has rules about promotion.

### 3.1 Where

| Group type | Entry tactic | Guardrail |
|---|---|---|
| Base ecosystem groups | Answer a question about Base fees/TVL with the relevant market link | Ask an admin first if the group has a promo policy |
| Prediction-market groups | Post a settlement receipt, not a pitch | Never DM members |
| Meme-coin groups (DEGEN, TOSHI, BRETT) | A market about *their* token at the current strike | One post per token per week |
| Trading/alpha groups | The day's widest-odds market with the frame link | Disclose that you operate the venue |

### 3.2 The compliant DM template (only after they engage in public)

> Hey — saw your question about {token}. We run Prediction Arena (binary markets on Base, USDC
> settled). There's a live market on {topic} at {yes}% YES. Not asking you to deposit: the trial
> ticket path lets you take a position with zero funding. If it's not for you, no worries — I won't
> message again.

Rules: one message, no follow-up, no link if they did not ask, and disclose the operator
relationship in the first sentence.

---

## 4. The ref loop, concretely

1. A Farcaster cast carries `/market/700003?ref=fc` (the frame buttons already do this).
2. The visitor lands; `lib/referral.ts` stores `{kind:"wallet"|"handle", value}` in localStorage and
   a 30-day `pa_ref` cookie.
3. They browse, connect, and place a bet → `bet()` receives `referrer` = the wallet in `ref`.
4. The contract pays the referrer a share of the 4% fee, on-chain. No invoice, no manual payout.
5. The referrer sees their link in **Portfolio → Invite & earn** and can hand it out.

What we deliberately do **not** do: credit points to the referrer for someone else's watch-to-earn
session. Points are a signed cookie ledger with no database (see `lib/rewards-server.ts`), so a
cross-user credit cannot be verified — and an unverifiable incentive is a promise we would break.

---

## 5. Weekly operating rhythm (zero cash)

| Day | Action | Surface |
|---|---|---|
| Mon | Weekly recap cast + TG: markets settled, biggest mover, one admission of what the AI got wrong | Farcaster `/base`, `@predictionarena_hq` |
| Tue | New market cast tied to a live event (CPI, FOMC, unlock) | `/crypto` + X reply under the headline post |
| Wed | Engineering post: how the fee escrow works, with the contract link | `/buildonbase` |
| Thu | Degen market (widest odds) | `/degen` |
| Fri | Reply-guerrilla block: 6–8 replies under Base-ecosystem accounts | X |
| Sat | Settlement receipts as markets resolve | Farcaster + X |
| Sun | Silence. Accounts that never rest read as bots. | — |

---

## 6. Metrics that decide whether this works

| Metric | Where | 30-day target |
|---|---|---|
| Frame impressions → market clicks | Warpcast frame analytics + `utm_source=farcaster` | 8% CTR |
| Visits carrying `ref` | `utm_source=invite` / `ref=fc` | 20% of all sessions |
| Referral-bet rate | bets whose `referrer != 0x0` | 15% of bets |
| Trial tickets redeemed | `/admin` rewards ledger | 300 |
| Activated wallets (2nd bet ≤ 7 days) | `BetPlaced` per address | 100 |

If frame CTR is under 3% after two weeks, the problem is the card, not the channel: test a different
headline on the image before writing more casts.

---

## 7. Hard lines (non-negotiable)

1. No invented numbers, no fake wallets, no fabricated wins — the board already labels on-chain vs
   board rows, and one screenshot of a lie costs more than a week of reach.
2. No guaranteed-return or risk-free language, ever.
3. Disclose operator status when posting in someone else's community.
4. Never link `@Pred_Arena`, `t.me/prediction_arena`, or any "support" handle; the only official
   links are the site footer and the pinned channel post.
5. If a channel says no promo, that is the answer. Getting banned from `/base` to save one cast is
   the worst trade in this document.
