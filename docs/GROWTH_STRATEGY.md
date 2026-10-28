# Growth Playbook — from a cold board to a self-feeding community

This is the operating manual for `predictionarena.online`. It is written for whoever is on shift:
every step below names the surface to touch, the copy to use, the number that tells you whether it
worked, and the line you are not allowed to cross.

> **The one rule.** No claim that a user can disprove in one click. The contract takes 4% into
> per-market escrow at bet time; the venue is a demo board with real on-chain settlement plumbing.
> Copy that says "0% fee" or "0x4B2… just won $12k" buys a click and spends the only thing that
> compounds: being believed. Everything below is written to survive a skeptic opening Basescan.

---

## 0. What we are actually selling

| Layer | What the user gets | Where it shows |
|---|---|---|
| Market | A binary question priced from a public feed (Binance / CoinGecko / DefiLlama), with the resolution rule written out | market page, `resolution` field |
| Agent | Two AI agents arguing both sides, in public | `AIAgentsDebate`, card stances |
| Money | USDC on Base, 4% fee escrowed per market, 100% refund if a market is cancelled, claims never pausable | trade panel fee line, contract `0x9618…10b5` |
| No-friction entry | Watch a sponsored placement → points → $1 trial ticket, no deposit needed | Watch-to-Earn panel |

The wedge is the third and fourth rows: **the trial ticket is the only crypto product where a
brand-new wallet can hold a real position without funding anything.** Every play below is a way to
put that ticket in front of someone.

---

## 1. Week 0 — before anyone is watching

1. **Pin the proof post, not the hype post.** The pinned tweet carries the contract address, the
   "fee is escrowed, refunded on cancel" mechanic and the site link. Skeptics arrive first; give
   them the ammunition.
2. **Channel hygiene.** `@predictionarena_hq` gets the shield avatar, the description with the site
   and X handle, and the pinned START HERE message (links, contract, anti-scam). Anything that
   claims to be support is a scam; say so before someone else does.
3. **Attribution on by default.** Every share from the site already appends
   `utm_source` / `utm_campaign=market_share` / `ref`. Nothing to configure — just do not strip the
   query string when you paste a link into a DM.
4. **Set the daily rhythm** (see §4). A board that updates twice a week reads as abandoned; one that
   updates daily reads as a market.

---

## 2. Week 1–2 — cold start without a budget

### 2.1 The trial-ticket loop (highest converting thing we have)

| Step | Surface | Copy |
|---|---|---|
| Hook | X / TG | "Watch one sponsored clip → $1 trial ticket → take a real position on Base. No deposit." |
| Landing | Growth strip card 2 | `100 points = a $1 trial ticket` (already live) |
| Proof | settlement tweet | "Ticket → 4.0× → paid out. Claim is one contract call, never pausable." |

Why it works: the ticket removes the two things that kill crypto funnels — funding a wallet and
approving a token — while the payout stays real. Track `tickets_redeemed` vs `first_deposit` in the
`/admin` console; the ratio is the whole funnel in one number.

### 2.2 Market-per-day cadence

One market a day, chosen by `scripts/auto-market.ts`:

```bash
bun scripts/auto-market.ts --pick=movers --limit=1     # longest odds, biggest payout
bun scripts/auto-market.ts --pick=expiry --limit=1     # closest to closing
bun scripts/auto-market.ts --limit=3 --json            # review batch
```

Dry run is the default; `--send` publishes when `X_OAUTH2_BEARER` and `TELEGRAM_BOT_TOKEN` are set.
Cron on the ops box:

```cron
# 09:10 UTC — the day's loudest market to X and Telegram
10 9 * * *  cd /srv/prediction-arena && bun scripts/auto-market.ts --pick=movers --send >> logs/growth.log 2>&1
# 21:10 UTC — the one closing tomorrow
10 21 * * * cd /srv/prediction-arena && bun scripts/auto-market.ts --pick=expiry --send >> logs/growth.log 2>&1
```

### 2.3 Settlement posts (the trust engine)

Every settled market gets one post: outcome, winning multiple, evidence hash, claim link. These are
the only posts that prove the machine works. Never batch them, never skip a losing one — a venue
that only posts wins is a venue nobody believes.

### 2.4 Where to post, in order of return per minute

1. **Telegram channel** — own audience, zero algorithm risk. Daily board + closing-soon ping.
2. **X replies under Base / prediction-market accounts** — answer with a number and a market link,
   never a bare "check us out".
3. **Reddit r/BaseChain, r/CryptoCurrency daily threads** — one market, one paragraph, disclose that
   you operate the venue. Ban risk is real; read the sub rules first.
4. **Farcaster / Warpcast** — small, high-signal, tolerant of daily market posts.
5. **DEX/aggregator communities** — only with a concrete market tied to their token (e.g. an AERO
   TVL market inside an Aerodrome thread).

---

## 3. Week 3–6 — turning users into distribution

### 3.1 The share hook already ships

Each market page has a `Share to X` button that produces a post with a preset hook, the live
probability, the payout multiple and an attributed link. Four hook variants rotate deterministically
by market id, so the feed does not read like a bot.

What to add on top, in priority order:

1. **Referral capture** — `?ref=<wallet>` is already carried through the share URLs. The contract's
   `bet(poolId, option, amount, referrer)` splits the fee to the referrer. Wiring the URL param into
   that argument is a frontend change, not a contract change, and turns every sharer into a
   commission earner. Requires a fee-accounting review before it goes live for real money.
2. **Leaderboard** — settled profit per wallet, weekly. Publishing a board of who actually won is
   more persuasive than any banner.
3. **Creator seats** — 5–10 people who post one market a day in their own voice, paid in USDC per
   settled market they originated. Track with `utm_content`.

### 3.2 KOL brief (copy/paste)

> We run Prediction Arena, binary markets on Base with on-chain USDC settlement and a 4% fee that
> stays in escrow until the market settles. Two asks: (1) pick any live market and take a side —
> we'll send you a $1 trial ticket so you don't need to deposit; (2) if you post it, use your own
> link from the market page so we can see what it did. You keep the profit, we never ask for your
> seed phrase or a DM-first "support" flow — if anyone does that, it is not us.

Rules for working with creators: no guaranteed-return language, no "risk-free", always disclose
that they were given a ticket, and never pay for a post that quotes a number we did not publish.

---

## 4. The weekly rhythm

| Day | Action | Owner surface |
|---|---|---|
| Mon | Weekly recap: markets settled, biggest mover, volume through the contract | TG + X |
| Tue | New market launch tied to a live event (CPI, FOMC, a token unlock) | TG + X |
| Wed | Educational: "how the 4% escrow works, and what happens if a market is cancelled" | docs page + X thread |
| Thu | Creator post / KOL slot | their channels |
| Fri | Closing-soon sweep for the weekend markets | TG |
| Sat | Settlement posts as markets resolve | X, one per market |
| Sun | Silence. One rest day keeps the account from reading as a bot. | — |

---

## 5. What to measure (and what to ignore)

**Measure**

- `tickets_redeemed → first bet → second bet` (the only retention curve that matters)
- click-through per channel from `utm_source` (X vs Telegram vs copy-link)
- share-button impressions vs visits with `ref=x` (is the hook working?)
- time-to-first-bet after wallet connect

**Ignore**

- follower count (a vanity number that never paid a claim)
- impressions without a link click
- "engagement rate" on posts that carry no market

Targets for the first six weeks, stated plainly so they can be missed and diagnosed: 150 activated
wallets (a second bet within 7 days), 400 trial tickets redeemed, 25% of visits arriving with a
`ref` param.

---

## 6. Hard lines

1. No promises of return, no "risk-free", no price target for a token we do not control.
2. No invented wallet addresses, bet sizes or wins. The activity feed marks on-chain rows as
   on-chain; the social-proof toast shows crowd size, not a fake whale, for the same reason.
3. Never link `@Pred_Arena`, `t.me/prediction_arena` or any "support" handle. The only official
   links are on the site footer and the pinned post.
4. Every market post carries the dispute path (resolution rule + evidence hash). A market that
   resolves badly must be able to explain itself in public.
5. If a claim in this playbook turns out to be false, edit this file the same day. The document is
   the memory of the campaign.
