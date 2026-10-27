import { generateContextDebate } from "./debate.ts";

/**
 * Autonomous content kernel.
 *
 * One deterministic generator shared by the frontend (debates, community threads) and the backend
 * (market creation). It is intentionally dependency-free and pure: given the same pool and the same
 * clock bucket it returns the same content, which keeps SSR and the client in agreement and lets
 * the cron daemon pre-compute the exact text the UI will later show.
 *
 * An LLM is an *optional* enhancer, never a requirement: `scripts/gen-market.ts` and
 * `scripts/gen-debates.ts` call the kernel first and only overwrite it when an API key is configured
 * and the call succeeds. With no key the platform still produces fresh, market-specific copy.
 *
 * The browser never reaches a model: debates arrive pre-generated in `public/debates.json`
 * (see `lib/debate-cache.ts`), and this kernel is only the floor for a market the daemon has not
 * covered yet.
 */

/* ───────────────────────────── shared primitives ───────────────────────────── */

const HEX = "0123456789abcdef";

/** FNV-1a → xorshift. Stable across Node and the browser. */
export function prng(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

/** Stable pseudo-address, same format the community UI masks. */
export function pseudoAddress(seed: string, index: number): string {
  const r = prng(`${seed}:addr:${index}`);
  let head = "";
  for (let i = 0; i < 6; i++) head += HEX[Math.floor(r() * 16)];
  let tail = "";
  for (let i = 0; i < 4; i++) tail += HEX[Math.floor(r() * 16)];
  return `0x${head}…${tail}`;
}

export type Stance = "bull" | "bear";

/* ───────────────────────────── market generation ───────────────────────────── */

export type GeneratedMarket = {
  poolId: string;
  title: string;
  category: string;
  description: string;
  resolution: string;
  durationHours: number;
  tags: string[];
  /** Where the text came from — "kernel" or "llm". Surfaced in logs so nobody has to guess. */
  source: "kernel" | "llm";
};

type Blueprint = {
  /** True when the title embeds a number that must come from a live feed. */
  needsLive?: boolean;
  title: (o: Ctx) => string;
  description: (o: Ctx) => string;
  resolution: (o: Ctx) => string;
  tags: string[];
};

type Ctx = {
  /**
   * Rounded strike above live spot, e.g. "85,000". Filled from the price snapshot that
   * `scripts/fetch-prices.ts` writes — never from a constant in this file.
   */
  band: string;
  /** Live derived strikes/levels for the other venues (empty when no snapshot is available). */
  ethBand: string;
  solBand: string;
  dominance: string;
  mcap: string;
  tvl: string;
  /** ISO timestamp behind the numbers above, so copy can say how fresh they are. */
  asOf: string;
  quarter: string;
  month: string;
  model: string;
  bps: string;
  seat: string;
};

/**
 * Numbers a blueprint is allowed to embed. Produced from a live snapshot only — this file has
 * no price constants of its own, which is exactly the bug this type exists to prevent.
 */
export type LiveNumbers = {
  btc?: number;
  eth?: number;
  sol?: number;
  btcDominance?: number;
  totalMarketCapUsd?: number;
  baseTvlUsd?: number;
  asOf: string;
};

const liveSteps: Record<string, number> = { BTC: 1_000, ETH: 50, SOL: 5 };

/** Next round level above spot: 80,757 → 85,000 (BTC), 2,378 → 2,400 (ETH). */
function strike(sym: keyof typeof liveSteps, spot: number, pct: number): string {
  const step = liveSteps[sym];
  const v = Math.ceil((spot * (1 + pct)) / step) * step;
  return v >= 1_000 ? v.toLocaleString("en-US") : String(v.toFixed(sym === "SOL" ? 0 : 0));
}
const MODELS = ["GPT-6", "Claude 5", "Gemini 3.5", "Llama 5", "DeepSeek V4"];
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const BLUEPRINTS: Record<string, Blueprint[]> = {
  Crypto: [
    {
      needsLive: true,
      title: (c) => `Will BTC close above $${c.band} before ${c.quarter} ends?`,
      description: (c) =>
        `A clean binary on Bitcoin's ${c.quarter} close. The question is deliberately blunt: no "touch" wicks, no intraday prints — the weekly candle body is what counts. In a market this reflexive, the interesting part is not the level but who is willing to hold through the drawdown that usually precedes it.`,
      resolution: (c) =>
        `Resolution uses the Binance BTC/USDT 1W candle. YES if a weekly close prints at or above $${c.band}; NO otherwise. Exchange outages longer than 30 minutes at the close push resolution to the next available candle.`,
      tags: ["Bitcoin", "Price"],
    },
    {
      title: () => `Will spot ETH ETF net inflows stay positive for four straight weeks?`,
      description: () =>
        `Flows are the cleanest read on whether institutional demand is structural or opportunistic. Four consecutive positive weeks has only happened twice since launch, and both times it preceded a multi-week bid in spot.`,
      resolution: () =>
        `Sum the daily net inflow figures published by the issuer for each of the four most recent completed weeks. YES if all four weeks are strictly positive; NO if any week is zero or negative.`,
      tags: ["Ethereum", "ETF", "Flows"],
    },
    {
      title: (c) => `Will the next L2 upgrade ship before the end of ${c.month}?`,
      description: (c) =>
        `Ship dates in rollup land slip. This market prices the gap between the announced target and what actually lands on mainnet. ${c.month} is the honest deadline: the audit window closes three weeks prior.`,
      resolution: () =>
        `YES if the upgrade is live on mainnet with a block explorer showing the new version before the deadline (23:59 UTC on the last day of the month). Testnet-only deployments resolve NO.`,
      tags: ["Layer2", "Shipping"],
    },
    {
      title: () => `Will stablecoin net issuance grow more than 3% this month?`,
      description: () =>
        `Stablecoin float is dry powder with a timestamp on it. Net issuance above 3% in a month has preceded every meaningful spot bid in the last two years; the reverse has also held.`,
      resolution: () =>
        `Compare aggregate supply of the top five USD stablecoins on the first and last day of the month (UTC). YES if the increase is strictly greater than 3.0%.`,
      tags: ["Stablecoins", "Liquidity"],
    },
  ],
  "AI & Tech": [
    {
      title: (c) => `Will a frontier lab publish a model matching ${c.model} benchmarks this quarter?`,
      description: (c) =>
        `Benchmarks are a poor measure of usefulness and a good measure of intent. A published parity claim against ${c.model} is a statement about roadmap confidence, which is what this market prices.`,
      resolution: () =>
        `YES if a lab publishes evaluation results showing parity or better on the two most-cited public benchmarks, with a reproducible eval harness, before the quarter ends. Vendor blog claims without a harness resolve NO.`,
      tags: ["Models", "Benchmarks"],
    },
    {
      title: () => `Will inference prices fall another 40% before the next earnings cycle?`,
      description: () =>
        `Price per million tokens has fallen faster than any enterprise software metric in history. The question is whether the curve flattens now that gross margins are compressing, or keeps going because volume wins.`,
      resolution: () =>
        `Compare the list price of the flagship small model from the three largest inference providers on the first and last day of the window. YES if the median price falls 40% or more.`,
      tags: ["Inference", "Pricing"],
    },
    {
      title: () => `Will an AI agent complete a paid task end-to-end without human review this month?`,
      description: () =>
        `Autonomy is a threshold, not a slope. This market asks whether the first genuinely unsupervised paid task lands this month — measured by whether a buyer paid and accepted delivery with no human in the loop.`,
      resolution: () =>
        `YES if a documented case is published where an autonomous agent delivered a paid task and the buyer accepted without human edit or intervention. Aided demos resolve NO.`,
      tags: ["Agents", "Autonomy"],
    },
    {
      title: (c) => `Will datacenter capex guidance be raised again in the ${c.quarter} print?`,
      description: () =>
        `Capex guidance is the least ambiguous number a hyperscaler publishes. Raising it twice in a row during a demand scare is the tell that the build-out is real, not narrative.`,
      resolution: () =>
        `YES if any of the four largest hyperscalers raises full-year datacenter capex guidance in its scheduled earnings release or call within the window.`,
      tags: ["Capex", "Hyperscalers"],
    },
  ],
  "Macro & Economy": [
    {
      title: () => `Will core services ex-housing print below 0.3% m/m in the next CPI?`,
      description: () =>
        `Core services ex-housing is the one line the Fed cannot hand-wave. It has printed above 0.3% for most of the last two years; a clean break below is the single most powerful disinflationary signal available.`,
      resolution: () =>
        `Use the BLS CPI release for the next month. YES if core services excluding housing prints strictly below 0.30% month-over-month on the seasonally adjusted basis. Revisions resolve on first print.`,
      tags: ["CPI", "Inflation"],
    },
    {
      title: (c) => `Will the policy rate be cut at least ${c.bps} bps by the ${c.quarter} meeting?`,
      description: (c) =>
        `The gap between the dot plot and market pricing is the trade. This contract settles on the decision, not the rhetoric: ${c.bps} bps of cumulative cuts by the ${c.quarter} meeting.`,
      resolution: (c) =>
        `YES if the cumulative reduction in the target range midpoint, measured from the first meeting of the period through the ${c.quarter} meeting, is at least the stated basis points.`,
      tags: ["Fed", "Rates"],
    },
    {
      title: () => `Will the 10-year yield close above 4.5% this month?`,
      description: () =>
        `Term premium has been repricing without a matching move in the front end. A monthly close above 4.5% usually forces a broader risk reset, which is why this market matters beyond rates.`,
      resolution: () =>
        `YES if the US 10-year Treasury yield closes at or above 4.50% on any trading day within the window, per the on-the-run benchmark.`,
      tags: ["Yields", "Treasuries"],
    },
    {
      title: () => `Will US labour quits rate fall below 1.8% in the next JOLTS print?`,
      description: () =>
        `Quits precede wage growth by roughly two quarters. A sub-1.8% print would put services disinflation on a mechanical path regardless of what the Fed says.`,
      resolution: () =>
        `Use the next JOLTS release. YES if the quits rate prints strictly below 1.8% for the reference month.`,
      tags: ["Labour", "JOLTS"],
    },
  ],
  "Politics & Global": [
    {
      title: () => `Will the next budget bill pass before the continuing resolution expires?`,
      description: () =>
        `Deadline markets in politics are really markets on whether one side blinks. The resolution criteria are deliberately mechanical so that a last-hour deal counts the same as a comfortable one.`,
      resolution: () =>
        `YES if an appropriations bill covering the affected agencies is signed into law before 23:59 UTC on the CR expiry date. A short-term extension of the same CR resolves NO.`,
      tags: ["Budget", "Legislation"],
    },
    {
      title: () => `Will a major jurisdiction approve spot crypto ETFs this quarter?`,
      description: () =>
        `Approval is a process question: consultations, then delegated acts, then listing. This market prices whether the last two steps land inside the quarter.`,
      resolution: () =>
        `YES if a national securities regulator in the EU, UK, Japan or Korea grants an effective listing approval for a spot crypto ETF before the quarter ends. Consultation papers resolve NO.`,
      tags: ["Regulation", "ETF"],
    },
    {
      title: () => `Will the next G7 communiqué name AI safety as a binding commitment?`,
      description: () =>
        `Communiqué language is the leading indicator of domestic legislation. "Binding" is the operative word: voluntary frameworks have already been named twice without consequence.`,
      resolution: () =>
        `YES if the published communiqué uses binding language on AI safety with a named compliance mechanism. Voluntary or aspirational phrasing resolves NO.`,
      tags: ["AI Policy", "G7"],
    },
    {
      title: () => `Will the next central bank digital currency pilot launch in a G20 economy?`,
      description: () =>
        `CBDC timelines are usually announced years early. This market asks about an actual live pilot with real users, not a whitepaper or a sandbox.`,
      resolution: () =>
        `YES if a G20 central bank launches a live pilot with non-institutional users before the deadline. Sandboxes, proofs of concept and internal pilots resolve NO.`,
      tags: ["CBDC", "Policy"],
    },
  ],
  "Science & Space": [
    {
      title: () => `Will the next orbital launch attempt succeed on the first try?`,
      description: () =>
        `First-attempt success rate is the most honest engineering metric in launch. This contract settles on the attempt, not the mission: a scrub counts as NO only if it slips past the window.`,
      resolution: () =>
        `YES if the named vehicle reaches its target orbit on the first launch attempt inside the window. Scrub-and-relaunch within the window still counts as a first attempt failure.`,
      tags: ["Launch", "Orbit"],
    },
    {
      title: () => `Will a peer-reviewed fusion net-energy result be published this quarter?`,
      description: () =>
        `Net energy is a threshold everyone claims and few demonstrate. The requirement here is a peer-reviewed paper with a measured Q>1, not a press release with a target date.`,
      resolution: () =>
        `YES if a peer-reviewed journal publishes measured Q>1 for a fusion device before the quarter ends. Preprints and conference abstracts resolve NO.`,
      tags: ["Fusion", "Peer Review"],
    },
    {
      title: () => `Will a gene therapy receive broad-label approval this year?`,
      description: () =>
        `Broad labels are the difference between a niche treatment and a platform. Narrow, biomarker-limited approvals do not count for this contract.`,
      resolution: () =>
        `YES if a regulator grants approval without a biomarker restriction for a gene therapy before the year ends. Accelerated or conditional approvals with restrictions resolve NO.`,
      tags: ["Biotech", "Approval"],
    },
    {
      title: () => `Will an exoplanet biosignature claim survive independent replication?`,
      description: () =>
        `Biosignature claims have a poor record. This market asks whether one survives six months of independent reanalysis — the point where most of them quietly die.`,
      resolution: () =>
        `YES if an independent team publishes a confirming reanalysis of the same target within the window. Non-detections or "inconclusive" results resolve NO.`,
      tags: ["Astronomy", "Replication"],
    },
  ],
  "Culture & Pop": [
    {
      title: () => `Will the next tentpole release clear $1B at the global box office?`,
      description: () =>
        `The billion-dollar threshold is as much a marketing event as a financial one. This contract settles on reported global gross, not studio projections.`,
      resolution: () =>
        `YES if reported worldwide gross exceeds $1,000,000,000 within 45 days of release, per the studio's official figures. Re-releases are excluded.`,
      tags: ["Box Office", "Film"],
    },
    {
      title: () => `Will the next platform exclusive cross 10M players in its first month?`,
      description: () =>
        `Player counts are the only metric platforms publish willingly, which makes them the most comparable. Ten million in month one separates a hit from a marketing spend.`,
      resolution: () =>
        `YES if the publisher reports 10 million or more players within 30 days of launch. Free-trial and demo users count only if the publisher includes them in its own headline figure.`,
      tags: ["Gaming", "Launch"],
    },
    {
      title: () => `Will a creator-led brand outsell a legacy label this quarter?`,
      description: () =>
        `Distribution has flipped: an audience is now cheaper to acquire than shelf space. This market prices whether that shows up in actual revenue, not cultural chatter.`,
      resolution: () =>
        `YES if a creator-founded brand reports higher quarterly revenue than a comparable legacy label in the same category. Estimates and annualised figures resolve NO.`,
      tags: ["Creators", "Commerce"],
    },
    {
      title: () => `Will the next awards cycle produce a sweep of three or more major categories?`,
      description: () =>
        `Sweeps are rare enough to be a genuine event and common enough to be mispriced. Three majors is the threshold this contract uses.`,
      resolution: () =>
        `YES if one title wins three or more of the five designated major categories in the same cycle. Ties resolve NO.`,
      tags: ["Awards", "Culture"],
    },
  ],
};

const CATEGORY_ORDER = Object.keys(BLUEPRINTS);

/**
 * Build the next market. `slot` is any stable time bucket (the hour is enough); the same slot and
 * the same rotation index always produce the same market, so the daemon can log what it will open
 * before it opens it.
 */
export function generateMarket(input: {
  slot: number;
  rotation?: number;
  avoid?: string[];
  now?: Date;
  source?: "kernel" | "llm";
  /** Live numbers from scripts/fetch-prices.ts. Required for any blueprint that embeds a price. */
  live?: LiveNumbers | null;
}): GeneratedMarket {
  const now = input.now ?? new Date(input.slot * 3_600_000);
  const r = prng(`market:${input.slot}:${input.rotation ?? 0}`);
  const live = input.live ?? null;

  const ctx: Ctx = {
    band: live?.btc ? strike("BTC", live.btc, 0.05) : "",
    ethBand: live?.eth ? strike("ETH", live.eth, 0.06) : "",
    solBand: live?.sol ? strike("SOL", live.sol, 0.08) : "",
    dominance: live?.btcDominance ? `${(live.btcDominance + 1).toFixed(1)}%` : "",
    mcap: live?.totalMarketCapUsd ? `$${(live.totalMarketCapUsd / 1e12).toFixed(2)}T` : "",
    tvl: live?.baseTvlUsd ? `$${(live.baseTvlUsd / 1e9).toFixed(2)}B` : "",
    asOf: live?.asOf ?? "",
    quarter: pick(r, QUARTERS),
    month: pick(r, MONTHS),
    model: pick(r, MODELS),
    bps: pick(r, ["25", "50", "75", "100"]),
    seat: pick(r, ["Senate", "House"]),
  };

  // A blueprint that embeds a live number is unusable without one: skip the lane rather than
  // print a stale or invented strike.
  let category = CATEGORY_ORDER[(input.rotation ?? 0) % CATEGORY_ORDER.length];
  if (!live) {
    let guard = 0;
    while (BLUEPRINTS[category].every((b) => b.needsLive) && guard < CATEGORY_ORDER.length) {
      guard += 1;
      category = CATEGORY_ORDER[(CATEGORY_ORDER.indexOf(category) + 1) % CATEGORY_ORDER.length];
    }
  }

  const pool = BLUEPRINTS[category].filter((b) => !(b.needsLive && !live));
  const avoid = new Set((input.avoid ?? []).map((t) => t.toLowerCase()));

  // try up to `pool.length` blueprints so a rolling window never repeats a live title
  let chosen: Blueprint | undefined;
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[(Math.floor(r() * pool.length) + i) % pool.length];
    if (!avoid.has(candidate.title(ctx).toLowerCase())) {
      chosen = candidate;
      break;
    }
  }
  chosen = chosen ?? pool[Math.floor(r() * pool.length)];

  const durationHours = pick(r, [24, 48, 72, 96, 120, 168]);

  return {
    poolId: String(Math.floor(now.getTime() / 1000)),
    title: chosen.title(ctx),
    category,
    description: chosen.description(ctx),
    resolution: chosen.resolution(ctx),
    durationHours,
    tags: chosen.tags,
    source: input.source ?? "kernel",
  };
}

/* ───────────────────────────── debate generation ──────────────────────────── */

export type DebateLine = {
  agent: "hawk" | "detective" | "meme";
  stance: Stance;
  text: string;
  evidenceCid?: string;
};

const BULL_OPENERS = [
  "The flow is one-sided and it is not retail.",
  "Positioning has been reset while the narrative survived.",
  "The cheapest side of this book has quietly become the informed side.",
  "Three weeks of distribution ended this morning.",
];

const BEAR_OPENERS = [
  "This is a crowded trade wearing a thesis.",
  "The number being priced is the optimistic one.",
  "Nothing in the order book justifies this probability.",
  "Every input here is lagging.",
];

function band(yesPct: number): "low" | "mid" | "high" {
  if (yesPct < 35) return "low";
  if (yesPct > 65) return "high";
  return "mid";
}

const ARGUMENTS: Record<string, { bull: string[]; bear: string[] }> = {
  Crypto: {
    bull: [
      "Exchange balances are at a multi-year low while spot volume holds — coins are leaving venues, not rotating inside them.",
      "Funding is positive but not parabolic, which is exactly the regime where spot leads instead of perps.",
      "The 25-delta skew flipped for the first time since March; desks are buying upside, not selling it.",
      "Realised vol is printing below implied for six sessions — the market is charging you for a move that already happened.",
    ],
    bear: [
      "Most of the inflow is basis, not directional. When the spread compresses, that bid evaporates with it.",
      "Open interest is up faster than spot volume — leverage is carrying this, and leverage unwinds violently.",
      "Whale wallets have been net sellers into every green candle this week.",
      "The options market is pricing 51% implied against 28% realised. Someone is overpaying for a thesis.",
    ],
  },
  "AI & Tech": {
    bull: [
      "Capex guidance went up again and transformer lead times are at 40 weeks — the physical build-out is not a narrative.",
      "Metered inference volume tripled quarter over quarter. Somebody is paying per call, not piloting.",
      "Developer mindshare is the leading indicator that never lies: SDK imports are up triple digits month over month.",
      "Price cuts expanded volume 4x; margin percent fell but gross profit did not.",
    ],
    bear: [
      "Capex is not revenue. Eight of ten enterprise pilots are still in evaluation fourteen months in.",
      "Inference gross margin compressed from 62% to 48% as prices were cut. Volume can double and profit still falls.",
      "Every capability claim in this cycle has been benchmarked on tasks the customer never runs.",
      "The revenue curve and the spend curve are diverging, and only one of them is priced here.",
    ],
  },
  "Macro & Economy": {
    bull: [
      "Three of four CPI buckets are decelerating; the lagging one is OER, which lags spot rents by construction.",
      "Quits at 1.9% precedes services disinflation by roughly two quarters. The data is ahead of the narrative.",
      "Front-end vol is at a three-year low while the outcome distribution has never been wider — that gap is the trade.",
      "Real yields are restrictive in every deflator, not just the headline one.",
    ],
    bear: [
      "Core services ex-housing is running at 4.1% annualised. That is three times target in the stickiest component.",
      "The dots show two cuts and the market prices four. Historically the market is the one that reprices.",
      "Consensus this one-sided has nobody left to buy the announcement.",
      "Labour cooling has been six quarters away for six quarters.",
    ],
  },
  "Politics & Global": {
    bull: [
      "Liquidity on this question now exceeds the polling average's margin of error, and it has been early twice.",
      "The resolution criteria are mechanical: the trigger event, not the interpretation, decides this.",
      "The arbiter has published the same reading twice before. Precedent is the missing variable in the bear case.",
      "Committee calendars are public and the remaining window is wider than the headline suggests.",
    ],
    bear: [
      "Sixty-two percent of the flow came from three wallets in the final 48 hours. That is a position, not a forecast.",
      "The wording leaves discretion, and discretionary settlement is a coin flip dressed as a market.",
      "Deadline extensions have resolved NO in this venue three times out of four.",
      "Sentiment is at an extreme and the calendar favours the other side.",
    ],
  },
  "Science & Space": {
    bull: [
      "Two independent labs reproduced it inside six weeks — unusually fast, and the strongest signal available.",
      "Three national programmes renewed grants in the same quarter. They do not renew results they doubt.",
      "The interim dataset already released covers the settlement question directly.",
      "Bench-to-production gaps have closed in this specific subfield, unlike the last cycle.",
    ],
    bear: [
      "Reproduced at bench scale, not production scale. Every previous claim in this class died in that gap.",
      "The press cycle is running nine months ahead of the papers.",
      "Settlement is 30 days out and the next validation run is day 45 — the calendar is the risk, not the science.",
      "Base rates for this class of result are unkind, and the market is pricing the exception.",
    ],
  },
  "Culture & Pop": {
    bull: [
      "Engagement is up 24% week over week on the channels the studios actually get paid on.",
      "Holder count is up 8,400 with a median position under one unit — distribution to real accounts, not wash trading.",
      "The wallets that sold last cycle are back on the bid, and the last two times that happened the floor held for 11 weeks.",
      "Paid acquisition cost fell while retention held; that combination precedes a beat.",
    ],
    bear: [
      "Attention half-life in this category is six days and settlement is thirty. The crowd that resolves this YES will be gone.",
      "Net new members have been negative four days running while the timeline posts confidence.",
      "Team wallets stage 1.5% into one market maker's collection address every six hours.",
      "Every comparable release overshot on opening weekend and undershot on week three.",
    ],
  },
};

const CLOSERS: Record<Stance, string[]> = {
  bull: [
    "At this price the asymmetry is on the YES side.",
    "I am long here and adding on any dip that holds the recent range.",
    "The market is charging a discount for a risk I can measure.",
  ],
  bear: [
    "At this price you are paying for perfection.",
    "I am on the other side and sizing up if this prints higher.",
    "The probability is a story; the ledger is the evidence.",
  ],
};

/**
 * 3–4 round bull/bear exchange, targeted at the actual market text. Deterministic for a given
 * (poolId, yesPct) pair so SSR and client never disagree, and so cached backend output stays valid.
 */
export function generateDebate(input: {
  poolId: string;
  category: string;
  title: string;
  yesPct: number;
  netPoolUsdc?: number;
}): DebateLine[] {
  const key = resolveCategory(input.category, input.title);
  const args = ARGUMENTS[key] ?? ARGUMENTS.Crypto;
  const r = prng(`debate:${input.poolId}:${Math.round(input.yesPct)}`);
  const b = band(input.yesPct);
  const side = input.yesPct >= 50 ? "YES" : "NO";
  const lead = input.yesPct >= 50 ? "the favourite" : "the counter-side";

  const bullPick = [...args.bull].sort(() => r() - 0.5);
  const bearPick = [...args.bear].sort(() => r() - 0.5);

  const rounds = 2 + (r() > 0.45 ? 1 : 0) + (r() > 0.8 ? 1 : 0); // 3..4 exchanges
  const lines: DebateLine[] = [];

  for (let i = 0; i < rounds; i++) {
    const bull = bullPick[i % bullPick.length];
    const bear = bearPick[i % bearPick.length];
    const probNote =
      i === 0
        ? ` At ${input.yesPct.toFixed(0)}% implied, the book is calling ${lead} ${side}.`
        : i === rounds - 1
          ? ` With ${input.netPoolUsdc && input.netPoolUsdc > 0 ? `$${Math.round(input.netPoolUsdc).toLocaleString()} on the table` : "this depth"}, the cost of being wrong is priced now, not later.`
          : "";

    lines.push({
      agent: i % 2 === 0 ? "detective" : "hawk",
      stance: "bull",
      text: `${i === 0 ? pick(r, BULL_OPENERS) + " " : ""}${bull}${probNote}`,
      ...(i === 0 ? { evidenceCid: `bafybei${Math.abs(hash32(`${input.poolId}:b${i}`)).toString(36)}` } : {}),
    });

    lines.push({
      agent: i % 2 === 0 ? "hawk" : "meme",
      stance: "bear",
      text: `${i === 0 ? pick(r, BEAR_OPENERS) + " " : ""}${bear}${
        i === rounds - 1 ? ` ${b === "high" ? "The crowded side never gets paid." : b === "low" ? "Being early is indistinguishable from being wrong until it isn't." : ""}` : ""
      }`,
      ...(i === 1 ? { evidenceCid: `bafybei${Math.abs(hash32(`${input.poolId}:s${i}`)).toString(36)}` } : {}),
    });
  }

  lines.push({
    agent: "detective",
    stance: input.yesPct >= 50 ? "bull" : "bear",
    text: `${pick(r, CLOSERS[input.yesPct >= 50 ? "bull" : "bear"])} Settlement is ${input.yesPct >= 50 ? "YES" : "NO"} at these odds or there is no trade here.`,
  });

  return lines;
}

/* ──────────────────── localized debate (non-English fallback) ─────────────── */

export type DebateLang = "en" | "zh-TW" | "de" | "fr" | "ja" | "ko";

/**
 * Generic-but-specific arguments per language.
 *
 * The English corpus above is rich and category-aware; that does not scale to six languages without
 * writing 24 arguments per vertical per locale. Instead each non-English locale gets eight solid
 * arguments — four bull, four bear — that are parameterised with the market's own category,
 * probability, depth and horizon. The result is genuinely in that language and genuinely about that
 * market, which is the requirement: never mix English into a non-English page.
 */

/** Filler openers, localised, so the exchange does not start with a bare claim. */


/**
 * Debate in a specific language. English uses the rich per-vertical corpus; every other locale uses
 * the parameterised generic corpus above, so a German page shows German arguments about that market
 * rather than English arguments or nothing at all.
 */
export function generateLocalizedDebate(
  input: {
    poolId: string;
    category: string;
    title: string;
    yesPct: number;
    netPoolUsdc?: number;
    marketData?: {
      asset?: string;
      spotUsd?: number;
      strikeUsd?: number;
      direction?: string;
      windowDays?: number;
    };
    /** unix seconds */
    endTime?: number;
    /** Displayed depth in USDC, when the caller has it. */
    depthUsdc?: number;
  },
  lang: DebateLang = "en"
): DebateLine[] {
  // Every locale runs the context engine (lib/debate): subject + strike + expiry + live odds, six
  // rounds, three desks. No per-category corpus is left to fall back to.
  return generateContextDebate(input, lang);
}

/* ─────────────────────────── community generation ─────────────────────────── */

export type GeneratedComment = {
  id: string;
  address: string;
  stance: Stance;
  body: string;
  minutesAgo: number;
  upvotes: number;
};

const COMMENTS: Record<string, { bull: string[]; bear: string[] }> = {
  Crypto: {
    bull: [
      "Exchange balances keep printing lower highs. Supply is leaving the venues and it is not coming back in a hurry.",
      "Funding is at 0.04% and spot is leading. That is accumulation, not froth.",
      "Filled a third of my size at this probability. If it goes to 70% I am done buying.",
    ],
    bear: [
      "This is basis flow. When the spread closes, the bid disappears and everyone pretends they saw it coming.",
      "Open interest up 30% with flat spot volume is the definition of a leverage-driven move.",
      "I would rather be late than long into a funding squeeze.",
    ],
  },
  "AI & Tech": {
    bull: [
      "Lead times on the hardware are 40 weeks. You cannot fake a supply chain.",
      "Usage is metered and it tripled. Someone is paying real money per call.",
      "Builders are the only leading indicator that has never lied to me.",
    ],
    bear: [
      "Capex is not revenue. Eight of ten pilots are still in evaluation.",
      "Margins are compressing faster than volume is growing. Do the arithmetic.",
      "Every demo this cycle has been benchmarked on tasks the customer never runs.",
    ],
  },
  "Macro & Economy": {
    bull: [
      "Quits rate leads services inflation by two quarters. The disinflation is already in the pipe.",
      "Three of four CPI buckets are decelerating. Only OER is lagging, and it lags by construction.",
      "Front-end vol is at a three-year low. That is the actual mispricing on this board.",
    ],
    bear: [
      "Core services ex-housing is at 4.1% annualised. That is not a cut, that is a pause.",
      "The market prices four cuts and the dots show two. Someone is going to be repriced.",
      "Consensus this one-sided has nobody left to buy the announcement.",
    ],
  },
  "Politics & Global": {
    bull: [
      "Money has been early on this question twice. The flow is bigger than the polling margin now.",
      "The arbiter has read the criteria the same way twice before. Precedent matters more than polls.",
      "Committee calendar gives them a real window. This is not a coin flip.",
    ],
    bear: [
      "62% of the flow came from three wallets in 48 hours. That is a position, not a forecast.",
      "The wording leaves discretion and discretionary settlement is a coin flip.",
      "Deadline extensions have resolved NO in this venue three times out of four.",
    ],
  },
  "Science & Space": {
    bull: [
      "Two independent labs reproduced it in six weeks. That speed is the signal.",
      "Three national programmes renewed in the same quarter. They do not renew doubts.",
      "The interim dataset already covers the settlement question directly.",
    ],
    bear: [
      "Bench scale is not production scale. Every previous claim died right there.",
      "The press cycle is nine months ahead of the papers.",
      "Settlement is day 30 and the validation run is day 45. The calendar is the trade.",
    ],
  },
  "Culture & Pop": {
    bull: [
      "Engagement is up 24% week over week on the channels that actually pay.",
      "Holder count +8,400 with a median position under one unit — that is real distribution.",
      "The wallets that sold last cycle are back on the bid.",
    ],
    bear: [
      "Attention half-life is six days, settlement is thirty. The crowd will be gone.",
      "Net new members have been negative four days while the timeline posts confidence.",
      "Team wallets stage 1.5% every six hours into one collection address.",
    ],
  },
};

/**
 * Comments that track the live probability instead of a frozen table: the *ratio* of bull to bear
 * posts follows the implied probability, while the wording pulls from the category corpus.
 */
export function generateComments(input: {
  poolId: string;
  category: string;
  title?: string;
  yesPct: number;
  netPoolUsdc?: number;
  count?: number;
}): GeneratedComment[] {
  const key = resolveCategory(input.category, input.title ?? "");
  const corpus = COMMENTS[key] ?? COMMENTS.Crypto;
  const r = prng(`comments:${input.poolId}:${Math.round(input.yesPct)}`);
  const total = input.count ?? 3 + Math.floor(r() * 3); // 3..5
  const bullShare = Math.min(0.85, Math.max(0.15, input.yesPct / 100));

  const out: GeneratedComment[] = [];
  for (let i = 0; i < total; i++) {
    const stance: Stance = r() < bullShare ? "bull" : "bear";
    const body = pick(r, stance === "bull" ? corpus.bull : corpus.bear);
    // upvotes correlate with agreement in the current probability band, then decay with age
    const heat = key === "Culture & Pop" ? 1.25 : 1;
    const align = stance === "bull" ? input.yesPct / 100 : 1 - input.yesPct / 100;
    const upvotes = Math.max(1, Math.round((4 + r() * 40) * (0.55 + align) * heat));
    out.push({
      id: `${input.poolId}-gen-${i}`,
      address: pseudoAddress(input.poolId, i),
      stance,
      body,
      minutesAgo: Math.round(3 + r() * 30 * (i + 1) * 4),
      upvotes,
    });
  }
  return out.sort((a, b) => a.minutesAgo - b.minutesAgo);
}

/* ──────────────────────────────── helpers ─────────────────────────────────── */

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 0xffffffff;
}

/** Map any category string (or the market title, when the category is missing) onto a corpus key. */
export function resolveCategory(category: string, title = ""): string {
  const hay = `${category} ${title}`.toLowerCase();
  if (/crypto|bitcoin|btc|eth|etf|l2|layer2|stablecoin/.test(hay)) return "Crypto";
  if (/ai|tech|model|inference|agent|capex|datacenter/.test(hay)) return "AI & Tech";
  if (/macro|econom|fed|rate|cpi|inflation|yield|labour/.test(hay)) return "Macro & Economy";
  if (/politic|global|budget|regulation|cbdc|g7/.test(hay)) return "Politics & Global";
  if (/science|space|fusion|gene|orbit|exoplanet/.test(hay)) return "Science & Space";
  if (/culture|pop|film|gaming|creator|award|box office/.test(hay)) return "Culture & Pop";
  return "Crypto";
}

/** Hour bucket used as the market slot. Same hour ⇒ same generated market. */
export function currentSlot(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 3_600_000);
}
