/**
 * Community discussion seed data.
 *
 * Every market gets 3–5 pre-written posts so a fresh pool never shows an empty thread. Content is
 * picked deterministically from the pool id, so the same market always shows the same thread —
 * a reload does not reshuffle the "community". Numbers in the copy are derived from the pool's
 * live YES share where the sentence needs one, so the thread does not contradict the chart.
 */
export type Stance = "bull" | "bear";

export type CommunityPost = {
  id: string;
  address: string;
  stance: Stance;
  body: string;
  minutesAgo: number;
  upvotes: number;
  mine?: boolean;
};

/** xorshift-ish deterministic PRNG seeded by a string. */
function rng(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13;
    h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 4294967296;
  };
}

function fakeAddress(seed: string, index: number): string {
  const r = rng(`${seed}:addr:${index}`);
  const hex = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < 6; i++) s += hex[Math.floor(r() * 16)];
  let tail = "";
  for (let i = 0; i < 4; i++) tail += hex[Math.floor(r() * 16)];
  return `${s}…${tail}`;
}

type Template = { stance: Stance; body: (ctx: { yes: string; no: string; pool: string }) => string };

const POOLS: Record<string, Template[]> = {
  crypto: [
    {
      stance: "bull",
      body: ({ yes }) =>
        `ETF net inflows ran 19 straight sessions and exchange balances hit a 2021 low. Spot is being taken off venues, not rotated. I'm on YES at ${yes} and adding on any dip under the 20d.`,
    },
    {
      stance: "bear",
      body: ({ yes }) =>
        `Careful — most of that inflow is basis trade, not directional. CME open interest is up 31% over the same window. When the spread closes that bid evaporates. ${yes} is paying you for crowded positioning.`,
    },
    {
      stance: "bull",
      body: ({ no }) =>
        `Basis desks buy OTC and hedge elsewhere; they don't show up as exchange withdrawals. 18.4k BTC net left hot wallets last week. That is physical. NO at ${no} is the wrong side of the ledger.`,
    },
    {
      stance: "bear",
      body: () =>
        `Funding at 0.075% per 8h means longs are paying to stay long. Last three times we sat here price gave back 9% inside a week. Size accordingly.`,
    },
    {
      stance: "bull",
      body: ({ yes }) =>
        `25-delta skew flipped positive for the first time since March. Desk flow is buying calls while retail chases spot. ${yes} still has room.`,
    },
  ],
  ai: [
    {
      stance: "bull",
      body: ({ yes }) =>
        `Hyperscaler capex guidance raised again, +$14B this quarter, and transformer lead times are 40 weeks. The physical build-out is not slowing for a press cycle. YES at ${yes}.`,
    },
    {
      stance: "bear",
      body: ({ no }) =>
        `Capex is not revenue. Eight of ten enterprise pilots I can see are still in "evaluation" 14 months in. You are pricing deployment that hasn't happened. NO at ${no} looks cheap.`,
    },
    {
      stance: "bull",
      body: () =>
        `Tokens processed tripled QoQ at the two largest inference providers. That is metered usage, not press releases. Someone is paying per call.`,
    },
    {
      stance: "bear",
      body: ({ yes }) =>
        `Unit economics: inference gross margin compressed 62% → 48% as prices were cut. Volume can double and profit still falls. ${yes} prices capability; the market forgot the P&L.`,
    },
    {
      stance: "bull",
      body: () =>
        `Developer mindshare is the leading indicator that never lies: new repos importing these SDKs are +210% MoM. Builders don't chase narratives.`,
    },
  ],
  macro: [
    {
      stance: "bear",
      body: ({ no }) =>
        `Core services ex-housing printed 0.31% m/m — 4.1% annualised. That is three times target in the stickiest component. A cut here is a fantasy. NO at ${no}.`,
    },
    {
      stance: "bull",
      body: ({ yes }) =>
        `Three of four CPI buckets are decelerating. The one that isn't is OER, which lags spot rents by 12–18 months by construction. The lag is the whole argument. YES at ${yes}.`,
    },
    {
      stance: "bear",
      body: () =>
        `"OER will roll over" has been the call for six straight quarters and it has rolled 0.2pp. Meanwhile the dots show two cuts and the market prices four. Someone is wrong.`,
    },
    {
      stance: "bull",
      body: () =>
        `Quits at 1.9%, hiring at 3.4% — labour is already at pre-pandemic normal. Services inflation follows quits with a two-quarter lag. The data is ahead of the narrative.`,
    },
    {
      stance: "bear",
      body: ({ yes }) =>
        `87% of CT expects a cut. Consensus that one-sided has no one left to buy the announcement. ${yes} is priced for perfection.`,
    },
  ],
  politics: [
    {
      stance: "bull",
      body: ({ yes }) =>
        `Liquidity on this question is now 4x the polling average's sample size, and the money has been early on both of the last two cycles here. YES at ${yes}.`,
    },
    {
      stance: "bear",
      body: ({ no }) =>
        `62% of the flow came from three wallets in the final 48 hours. That is a position, not a forecast. NO at ${no} is the side with room.`,
    },
    {
      stance: "bear",
      body: () =>
        `The resolution wording leaves the arbiter discretion. Discretionary settlement is a coin flip wearing a market's clothes — that is the actual risk here, not the polls.`,
    },
    {
      stance: "bull",
      body: () =>
        `Those three wallets have a 71% hit rate across 40 resolved markets. Track record beats suspicion of size.`,
    },
  ],
  science: [
    {
      stance: "bull",
      body: ({ yes }) =>
        `Peer review is done and two independent labs reproduced it inside six weeks. That speed is the signal. YES at ${yes} is the least contested side on this board.`,
    },
    {
      stance: "bear",
      body: ({ no }) =>
        `Reproduced at bench scale, not production scale. Every previous claim in this class died between the two. NO at ${no} has the base rate behind it.`,
    },
    {
      stance: "bull",
      body: () =>
        `Three national programmes renewed grants in the same quarter. They do not renew for results they doubt.`,
    },
    {
      stance: "bear",
      body: () =>
        `Timeline risk is the whole trade: settlement is 30 days out, the next validation run is day 45. You're betting on the calendar, not the science.`,
    },
  ],
  culture: [
    {
      stance: "bull",
      body: ({ yes }) =>
        `Engagement is +24% WoW on the creator's own channels — the number the studios actually get paid on, not the press cycle. YES at ${yes}.`,
    },
    {
      stance: "bear",
      body: ({ no }) =>
        `Net new members have been negative four days running while the timeline posts diamond hands. That divergence is the tell. NO at ${no}.`,
    },
    {
      stance: "bear",
      body: () =>
        `Team wallets push 1.5% out every six hours, all into one market maker's collection address. Supply is being staged, not held.`,
    },
    {
      stance: "bull",
      body: () =>
        `Holder count +8,400 with a median position of 0.9 — that is distribution to real accounts, not wash trading.`,
    },
    {
      stance: "bear",
      body: () =>
        `Attention half-life in this category is 6 days; settlement is 30. The crowd that makes this resolve YES will be looking elsewhere by then.`,
    },
  ],
  default: [
    {
      stance: "bull",
      body: ({ yes }) =>
        `Three fresh wallets pulled 4.2M USDC off Coinbase in 72 hours and pushed it into YES, paying 3.4x median gas to get filled. That is urgency, not idle flow. ${yes} is the informed side.`,
    },
    {
      stance: "bear",
      body: ({ no }) =>
        `Those wallets are 40 hours old and funded from one source. Age and funding lineage separate conviction from a manufactured print. I'm on NO at ${no}.`,
    },
    {
      stance: "bull",
      body: () =>
        `The book absorbed it without slippage past 1.5%, which means real depth sat behind the bid. Thin markets don't behave like that.`,
    },
    {
      stance: "bear",
      body: () =>
        `87% of CT is shouting one direction. As a contrarian input that is about as loud as it gets.`,
    },
    {
      stance: "bull",
      body: () =>
        `Risk-reward at these odds is asymmetric on the other side: the favourite pays 1.02x while the counter pays 7x. Variance is where the edge is.`,
    },
  ],
};

const HEALTH = ["2m ago", "18m ago", "1h ago", "3h ago", "7h ago", "11h ago", "1d ago", "2d ago"];

/**
 * Deterministic thread for a pool. `yesPct` is the live YES probability (0–100) used inside the
 * copy so the posters quote the same number the chart shows.
 */
export function seedPostsFor(poolId: string, category: string, yesPct: number): CommunityPost[] {
  const key = (category || "default").toLowerCase();
  const table =
    POOLS[key] ??
    POOLS[
      key.includes("crypto") ? "crypto"
        : key.includes("ai") || key.includes("tech") ? "ai"
        : key.includes("macro") || key.includes("econom") ? "macro"
        : key.includes("politic") || key.includes("global") ? "politics"
        : key.includes("science") || key.includes("space") ? "science"
        : key.includes("culture") || key.includes("pop") ? "culture"
        : "default"
    ] ??
    POOLS.default;

  const r = rng(poolId);
  const yes = `${Math.max(1, Math.round(yesPct))}%`;
  const no = `${Math.max(1, Math.round(100 - yesPct))}%`;
  const count = 3 + Math.floor(r() * (Math.min(5, table.length) - 2)); // 3..5

  const picked = [...table];
  const out: CommunityPost[] = [];
  for (let i = 0; i < count && picked.length; i++) {
    const idx = Math.floor(r() * picked.length);
    const tpl = picked.splice(idx, 1)[0];
    out.push({
      id: `${poolId}-seed-${i}`,
      address: fakeAddress(poolId, i),
      stance: tpl.stance,
      body: tpl.body({ yes, no, pool: poolId }),
      minutesAgo: 2 + Math.floor(r() * 3 * 1440),
      upvotes: 3 + Math.floor(r() * 46),
    });
  }
  return out.sort((a, b) => a.minutesAgo - b.minutesAgo);
}

export function relativeTime(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

export const HEALTH_LABELS = HEALTH;
