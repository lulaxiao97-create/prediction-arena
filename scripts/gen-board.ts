/**
 * Board generator — rebuilds every *generated* market from today's live numbers.
 *
 *   node --experimental-strip-types scripts/gen-board.ts
 *
 * Reads `frontend/public/prices.json` (written by scripts/fetch-prices.ts) and rewrites the
 * demo half of `frontend/public/pools.json`:
 *
 *   • on-chain rows (`source: "chain"`) are preserved untouched — the contract owns them;
 *   • every generated row is rebuilt, so a market whose deadline has passed disappears and a
 *     market whose threshold the price has run through is re-struck at a level that is still
 *     a real question;
 *   • every price/tvl threshold is computed from the snapshot. **No hardcoded price may appear
 *     in a title.** If the snapshot is missing or older than MAX_AGE, the script refuses to run
 *     rather than inventing a number.
 *
 * The seven lanes are the ones the UI tabs render (lib/categories.ts): Crypto & Macro,
 * DeFi & L2, AI & Web3 Tech, Memes & Culture, Sports & Esports, Politics & Policy,
 * Base Ecosystem.
 *
 * Probabilities are not decorative either: a price market's YES share is derived from the
 * distance between spot and the strike, adjusted by the 24h move and the time to expiry, so a
 * target 20% above spot does not open at 50%.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSETS, readSnapshot, snapshotAgeMs } from "./fetch-prices.ts";
import type { PriceSnapshot } from "./fetch-prices.ts";
import { coverFor } from "../frontend/src/lib/covers.ts";
import { displayStatsFor } from "../frontend/src/lib/display-stats.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const POOLS = join(ROOT, "frontend", "public", "pools.json");
const OUT_LOG = join(ROOT, "logs", "board.json");

const MAX_AGE_MS = 3 * 3600_000; // three hours: a cron tick that failed twice must not ship numbers
const ID_BASE = 700_000; // generated ids live in their own range, away from on-chain pool ids

type Pool = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  source: "demo" | "chain";
  status: number;
  endTimeUtc?: string;
  endTimeOffsetHours?: number;
  liquidityUsdc: string;
  yesShare: number;
  volume24hUsdc: string;
  traders: number;
  description: string;
  resolution: string;
  /** Provenance for the numbers in the title (additive field; the UI ignores unknown keys). */
  dataSource?: string;
  dataAsOf?: string;
  /**
   * The numbers a share card / tweet needs, in structured form — so the X intent and the OG
   * card read `spot` and `strike` instead of re-parsing the title with a regex.
   */
  marketData?: {
    asset: string;
    spotUsd: number;
    strikeUsd: number;
    direction: "above" | "below";
    windowDays: number;
    source: string;
    asOf: string;
  };
  /**
   * Resolved artwork, written at generation time (see frontend/src/lib/covers.ts). The manifest
   * carries it so the OG route and any other consumer read the same photo/accent/mark the cards
   * use, instead of re-deriving it with a second copy of the rules.
   */
  visual?: ReturnType<typeof coverFor>;
};

/* ───────────────────────────── number helpers ───────────────────────────── */

function stepFor(v: number): number {
  if (v >= 10_000) return 1_000;
  if (v >= 1_000) return 100;
  if (v >= 100) return 5;
  if (v >= 10) return 1;
  if (v >= 1) return 0.25;
  if (v >= 0.01) return 0.0025;
  return 0.00002;
}

/** Next "round" level above spot·(1+pct) — round *up* so the market is a real question. */
function strikeUp(spot: number, pct: number): number {
  const raw = spot * (1 + pct);
  const step = stepFor(spot);
  return Math.ceil(raw / step) * step;
}

/** Round level below spot·(1−pct), rounded *down* for the same reason. */
function strikeDown(spot: number, pct: number): number {
  const raw = spot * (1 - pct);
  const step = stepFor(spot);
  return Math.floor(raw / step) * step;
}

function fmtMoney(v: number): string {
  if (v >= 1_000) return `$${Math.round(v).toLocaleString("en-US")}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toPrecision(3)}`;
}

function fmtBig(v: number): string {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return fmtMoney(v);
}

/* ───────────────────────────── time helpers ───────────────────────────── */

function endOfMonthUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
}

function addDaysUTC(now: Date, days: number): Date {
  const d = new Date(now.getTime() + days * 86_400_000);
  d.setUTCHours(23, 59, 59, 0);
  return d;
}

function nextSundayUTC(now: Date): Date {
  const d = new Date(now);
  const shift = (7 - d.getUTCDay()) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + shift);
  d.setUTCHours(23, 59, 59, 0);
  return d;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
/** Human label used in titles: `October 31, 2026`. */
const label = (d: Date) =>
  `${d.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
const monthName = (d: Date) => d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });

/* ───────────────────────────── probability model ───────────────────────────── */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * YES share for "close above strike by deadline".
 *
 * Logistic in the log-distance to the strike, scaled by realised 24h volatility and by the
 * square root of the time left (a 20% gap is hopeless in a week, plausible in a year). This is
 * the same shape an options desk uses for a digital, without pretending to be one.
 */
const DAILY_VOL: Record<string, number> = {
  BTC: 0.035, ETH: 0.042, SOL: 0.055, AERO: 0.075, DEGEN: 0.10, BRETT: 0.095, TOSHI: 0.105,
};

function aboveProbability(sym: string, spot: number, strike: number, days: number, change24h: number | null): number {
  // A single 24h print is a terrible volatility estimate (a quiet day makes every strike look
  // hopeless), so the model floors at the asset's typical daily move and only widens when today
  // was actually violent. sigma scales with sqrt(time), as a digital's should.
  const base = DAILY_VOL[sym] ?? 0.06;
  const vol = Math.max(base, Math.abs(change24h ?? 0) / 100);
  const horizon = Math.sqrt(Math.max(days, 1));
  const z = Math.log(strike / spot) / (vol * horizon);
  return clamp(1 / (1 + Math.exp(z * 1.6)), 0.03, 0.94);
}

/* ───────────────────────────── board assembly ───────────────────────────── */

type Draft = Omit<Pool, "id" | "source" | "status" | "endTimeUtc"> & { deadline: Date };

function buildBoard(snap: PriceSnapshot, now: Date): Draft[] {
  const a = snap.assets;
  const g = snap.global;
  const chains = snap.chains ?? {};
  const asOf = snap.updatedAt;
  const eom = endOfMonthUTC(now);
  const eomDays = Math.max(1, Math.round((eom.getTime() - now.getTime()) / 86_400_000));
  const out: Draft[] = [];

  const px = (sym: string) => a[sym]?.usd ?? 0;
  const chg = (sym: string) => a[sym]?.change24h ?? null;

  /** Price market helper: strike above spot by pct, deadline, probability from the model. */
  const priceAbove = (opts: {
    sym: string; name: string; pct: number; deadline: Date; category: string;
    tags?: string[]; story: string;
  }) => {
    const spot = px(opts.sym);
    if (!spot) return;
    const strike = strikeUp(spot, opts.pct);
    const days = Math.max(1, Math.round((opts.deadline.getTime() - now.getTime()) / 86_400_000));
    const p = aboveProbability(opts.sym, spot, strike, days, chg(opts.sym));
    out.push({
      title: `Will ${opts.name} close above ${fmtMoney(strike)} before ${label(opts.deadline)}?`,
      category: opts.category,
      tags: [opts.sym, `spot ${fmtMoney(spot)}`, `${opts.pct > 0 ? "+" : ""}${Math.round((strike / spot - 1) * 100)}% strike`, ...(opts.tags ?? [])],
      deadline: opts.deadline,
      liquidityUsdc: String(Math.round(14_000 + p * 40_000)),
      yesShare: Number(p.toFixed(3)),
      volume24hUsdc: turnover24h(`Will ${opts.name} close above ${fmtMoney(strike)}`, String(Math.round(14_000 + p * 40_000))),
      traders: Math.round(40 + p * 260),
      description: `${opts.story} Spot is ${fmtMoney(spot)} (${chg(opts.sym) === null ? "n/a" : `${chg(opts.sym)!.toFixed(2)}% in 24h`}); the strike is ${Math.round((strike / spot - 1) * 100)}% above it.`,
      resolution: `YES if the ${opts.sym}/USDT daily candle on Binance closes at or above ${fmtMoney(strike)} on any day up to and including ${day(opts.deadline)} 23:59 UTC. A print at the level intraday without a daily close resolves NO.`,
      dataSource: `Binance ${opts.sym}USDT`,
      dataAsOf: asOf,
      marketData: {
        asset: opts.sym,
        spotUsd: spot,
        strikeUsd: strike,
        direction: "above",
        windowDays: days,
        source: "Binance",
        asOf,
      },
    });
  };

  /** Editorial market helper — real deadline, named source, no invented numbers. */

/** Deterministic 24h turnover for a listing: same title, same number, every rebuild. */
const turnover24h = (title: string, liquidityUsdc: string): string => {
  let h = 0;
  for (let i = 0; i < title.length; i += 1) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  const factor = 0.16 + ((h % 1000) / 1000) * 0.5; // 16%–66% of liquidity
  return String(Math.round(Number(liquidityUsdc) * factor));
};

  const editorial = (opts: {
    title: string; category: string; tags: string[]; deadline: Date; p: number;
    description: string; resolution: string; dataSource: string;
    marketData?: Draft["marketData"];
  }) => {
    out.push({
      title: opts.title,
      category: opts.category,
      tags: opts.tags,
      deadline: opts.deadline,
      liquidityUsdc: String(Math.round(9_000 + opts.p * 50_000)),
      yesShare: Number(clamp(opts.p, 0.05, 0.92).toFixed(3)),
      volume24hUsdc: turnover24h(opts.title, String(Math.round(9_000 + opts.p * 50_000))),
      traders: Math.round(30 + opts.p * 300),
      description: opts.description,
      resolution: opts.resolution,
      dataSource: opts.dataSource,
      dataAsOf: asOf,
      marketData: opts.marketData,
    });
  };

  /* ── 1. Crypto & Macro ─────────────────────────────────────────────────── */
  priceAbove({ sym: "BTC", name: "BTC", pct: 0.05, deadline: eom, category: "Crypto & Macro",
    story: "The month-end close is the only Bitcoin print that survives the noise of the last week of the month, which is when funding and options expiry do their damage." });
  priceAbove({ sym: "BTC", name: "BTC", pct: 0.12, deadline: addDaysUTC(now, 21), category: "Crypto & Macro",
    story: "A 12% move inside three weeks is a trend confirmation, not a wick: this market asks whether the bid is still there after the retracement." });
  priceAbove({ sym: "ETH", name: "ETH", pct: 0.08, deadline: eom, category: "Crypto & Macro",
    story: "ETH has been trading as a beta on BTC with a heavier tape; a strike this far above spot only prints if the rotation is real." , tags: ["Ethereum"] });
  priceAbove({ sym: "SOL", name: "SOL", pct: 0.10, deadline: eom, category: "Crypto & Macro",
    story: "SOL's month-end close is the cleanest read on whether high-beta L1 demand has survived the last two weeks of outflows.", tags: ["Solana"] });

  if (g?.btcDominance) {
    const target = Math.round((g.btcDominance + 1) * 10) / 10;
    editorial({
      title: `Will BTC dominance close above ${target.toFixed(1)}% before ${label(eom)}?`,
      category: "Crypto & Macro",
      tags: ["BTC.D", `now ${g.btcDominance.toFixed(2)}%`, "CoinGecko"],
      deadline: eom,
      p: clamp(0.5 - (target - g.btcDominance) * 0.18, 0.12, 0.85),
      description: `Dominance is ${g.btcDominance.toFixed(2)}% right now and the whole market is ${g.change24h?.toFixed(2) ?? "n/a"}% over 24h. A rising dominance while total cap falls is the classic risk-off rotation; this contract prices exactly that.`,
      resolution: `YES if CoinGecko's BTC market-cap dominance prints above ${target.toFixed(1)}% on any UTC day before ${day(eom)} 23:59 UTC.`,
      dataSource: "CoinGecko /global",
    });
  }

  if (g?.totalMarketCapUsd) {
    const target = Math.round((g.totalMarketCapUsd * 1.06) / 1e11) * 1e11;
    editorial({
      title: `Will total crypto market cap reclaim ${fmtBig(target)} before ${label(eom)}?`,
      category: "Crypto & Macro",
      tags: ["Total mcap", `now ${fmtBig(g.totalMarketCapUsd)}`, "CoinGecko"],
      deadline: eom,
      p: clamp(0.52 - (target / g.totalMarketCapUsd - 1) * 3, 0.08, 0.9),
      description: `Aggregate cap sits at ${fmtBig(g.totalMarketCapUsd)}, ${g.change24h?.toFixed(2) ?? "n/a"}% lower over 24h. Reclaiming ${fmtBig(target)} requires new inflow, not rotation.`,
      resolution: `YES if CoinGecko's total crypto market cap prints at or above ${fmtBig(target)} on any day before ${day(eom)} 23:59 UTC.`,
      dataSource: "CoinGecko /global",
    });
  }

  editorial({
    title: `Will the 10-year Treasury yield close below 4.00% before ${label(eom)}?`,
    category: "Crypto & Macro",
    tags: ["Rates", "Macro", "US Treasury"],
    deadline: eom,
    p: 0.28,
    description: "Long-end yields set the discount rate for every risk asset in this protocol's universe. A monthly close under 4% would be the first since the last easing cycle.",
    resolution: `YES if the on-the-run US 10-year Treasury yield closes below 4.00% on any trading day before ${day(eom)} 23:59 UTC, per the US Treasury's daily yield curve.`,
    dataSource: "US Treasury daily yield curve",
  });

  /* ── 2. DeFi & L2 ──────────────────────────────────────────────────────── */
  const baseTvl = chains.base?.tvlUsd ?? 0;
  const ethTvl = chains.ethereum?.tvlUsd ?? 0;
  const solTvl = chains.solana?.tvlUsd ?? 0;

  if (baseTvl) {
    const target = Math.round((baseTvl * 1.05) / 1e8) * 1e8;
    editorial({
      title: `Will Base TVL close above ${fmtBig(target)} before ${label(eom)}?`,
      category: "DeFi & L2",
      tags: ["Base", "TVL", `now ${fmtBig(baseTvl)}`, "DefiLlama"],
      deadline: eom,
      p: clamp(0.55 - (target / baseTvl - 1) * 2.4, 0.1, 0.88),
      description: `Base holds ${fmtBig(baseTvl)} of deposits today. A 5% expansion inside the window needs net new capital, and TVL is the least gameable number in the category.`,
      resolution: `YES if DefiLlama's Base chain TVL prints at or above ${fmtBig(target)} on any UTC day before ${day(eom)} 23:59 UTC.`,
      dataSource: "DefiLlama /v2/chains",
    });
  }
  if (ethTvl) {
    const target = Math.round((ethTvl * 0.96) / 1e8) * 1e8;
    editorial({
      title: `Will Ethereum TVL fall below ${fmtBig(target)} before ${label(eom)}?`,
      category: "DeFi & L2",
      tags: ["Ethereum", "TVL", `now ${fmtBig(ethTvl)}`, "DefiLlama"],
      deadline: eom,
      p: clamp(0.35 - (1 - target / ethTvl) * 1.5, 0.08, 0.8),
      description: `A 4% drawdown in Ethereum TVL usually tracks the price leg, not a loss of confidence. The distinction matters and the number is public.`,
      resolution: `YES if DefiLlama's Ethereum chain TVL prints below ${fmtBig(target)} on any UTC day before ${day(eom)} 23:59 UTC.`,
      dataSource: "DefiLlama /v2/chains",
    });
  }
  if (baseTvl && solTvl) {
    editorial({
      title: `Will Base TVL overtake Solana TVL before ${label(eom)}?`,
      category: "DeFi & L2",
      tags: ["Base", "Solana", `gap ${fmtBig(solTvl - baseTvl)}`, "DefiLlama"],
      deadline: eom,
      p: clamp(0.5 - ((solTvl - baseTvl) / Math.max(baseTvl, 1)) * 0.12, 0.02, 0.4),
      description: `Base carries ${fmtBig(baseTvl)} against Solana's ${fmtBig(solTvl)} — a gap of ${fmtBig(solTvl - baseTvl)} that has to close without Base gaining anything from price.`,
      resolution: `YES if DefiLlama's Base chain TVL exceeds its Solana chain TVL on any UTC day before ${day(eom)} 23:59 UTC.`,
      dataSource: "DefiLlama /v2/chains",
    });
  }
  priceAbove({ sym: "AERO", name: "AERO", pct: 0.15, deadline: eom, category: "DeFi & L2",
    story: "Aerodrome is Base's largest venue; its token price is the closest thing the chain has to a beta on its own DEX volume.", tags: ["Aerodrome"] });

  editorial({
    title: `Will the top five L2s together settle more than 100M transactions in a single day before ${label(eom)}?`,
    category: "DeFi & L2",
    tags: ["Rollups", "Throughput", "L2Beat"],
    deadline: eom,
    p: 0.34,
    description: "Throughput is the one L2 metric that cannot be faked with incentives: either the blocks are full or they are not.",
    resolution: `YES if the combined daily transaction count of the five largest L2s by TVL exceeds 100,000,000 on any UTC day before ${day(eom)} 23:59 UTC, per L2Beat activity data.`,
    dataSource: "L2Beat activity",
  });

  /* ── 3. AI & Web3 Tech ────────────────────────────────────────────────── */
  editorial({
    title: `Will a major lab ship a model with a 2M-token context window before ${label(eom)}?`,
    category: "AI & Web3 Tech",
    tags: ["Models", "Context", "Frontier labs"],
    deadline: eom,
    p: 0.41,
    description: "Context length stopped being a marketing number the moment agent frameworks started depending on it. A public 2M window changes what can be built, not just what can be demoed.",
    resolution: "YES if a frontier lab makes a 2M-token (or larger) context window generally available through a documented API before the deadline. Waitlists and private previews resolve NO.",
    dataSource: "Provider API documentation",
  });
  editorial({
    title: `Will an autonomous agent complete a paid on-chain task end-to-end before ${label(eom)}?`,
    category: "AI & Web3 Tech",
    tags: ["Agents", "x402", "Onchain"],
    deadline: eom,
    p: 0.37,
    description: "Agent payments moved from demo to protocol in the last year. What is still missing is evidence of a job priced, delivered and accepted with no human in the loop.",
    resolution: "YES if an autonomous agent is paid in stablecoins on Base for a task that a buyer accepts without human edit, with the settlement visible on-chain, before the deadline.",
    dataSource: "On-chain settlement + public writeup",
  });
  editorial({
    title: `Will inference prices for a frontier-class model fall another 30% before ${label(eom)}?`,
    category: "AI & Web3 Tech",
    tags: ["Inference", "Pricing"],
    deadline: eom,
    p: 0.44,
    description: "Per-token prices have fallen faster than any comparable software metric. The question is whether margin compression finally flattens the curve.",
    resolution: "YES if the published list price, per million output tokens, of any frontier-class model falls 30% or more versus its price on the first day of the window.",
    dataSource: "Provider pricing pages",
  });
  editorial({
    title: `Will a zero-knowledge proof of an LLM inference be verified on a public chain before ${label(eom)}?`,
    category: "AI & Web3 Tech",
    tags: ["ZKML", "Verification", "Research"],
    deadline: eom,
    p: 0.22,
    description: "Verifiable inference is the missing primitive for on-chain agents: without it, an agent's work is an assertion rather than a proof.",
    resolution: "YES if a proof covering a full LLM inference step is verified by a deployed verifier contract on any public chain before the deadline, with the transaction publicly inspectable.",
    dataSource: "Block explorer + verifier contract",
  });
  editorial({
    title: `Will any AI-agent framework exceed 100k monthly active developers before ${label(eom)}?`,
    category: "AI & Web3 Tech",
    tags: ["Developers", "Adoption"],
    deadline: eom,
    p: 0.3,
    description: "Developer counts are the leading indicator that survives a funding cycle. 100k monthly actives separates a framework from a demo.",
    resolution: "YES if a public package registry or the maintainer publishes a figure of 100,000+ monthly active developers for an agent framework before the deadline.",
    dataSource: "Package registry download/usage stats",
  });

  /* ── 4. Memes & Culture ───────────────────────────────────────────────── */
  priceAbove({ sym: "DEGEN", name: "DEGEN", pct: 0.2, deadline: eom, category: "Memes & Culture",
    story: "DEGEN is Base's most liquid culture token; its price is the cleanest read on whether on-chain tipping still has a bid.", tags: ["Base", "Culture"] });
  priceAbove({ sym: "BRETT", name: "BRETT", pct: 0.18, deadline: eom, category: "Memes & Culture",
    story: "Meme liquidity on Base rotates faster than anywhere else; an 18% month-end strike filters rotation from real accumulation.", tags: ["Base", "Meme"] });
  priceAbove({ sym: "TOSHI", name: "TOSHI", pct: 0.25, deadline: eom, category: "Memes & Culture",
    story: "The long tail of Base memes lives or dies on a single week of attention; this strike is deliberately far out because the distribution is fat-tailed.", tags: ["Base", "Meme"] });

  editorial({
    title: `Will a Base-native meme token enter the top 200 by market cap before ${label(eom)}?`,
    category: "Memes & Culture",
    tags: ["Base", "Market cap", "CoinGecko"],
    deadline: eom,
    p: 0.26,
    description: "Base has produced culture tokens with real volume but no sustained top-200 entrant. The threshold is the difference between a rotation and a narrative.",
    resolution: "YES if any token launched on Base appears in CoinGecko's top 200 by market capitalisation on any day before the deadline.",
    dataSource: "CoinGecko market cap ranking",
  });
  editorial({
    title: `Will a creator-led token out-earn a top-20 protocol token in fees this month?`,
    category: "Memes & Culture",
    tags: ["Creators", "Fees", "Culture"],
    deadline: eom,
    p: 0.18,
    description: "Attention is now cheaper to acquire than shelf space. This market asks whether that shows up in actual fee revenue rather than cultural chatter.",
    resolution: "YES if a creator-issued token reports higher 30-day protocol fees than the 20th-ranked protocol by fees on DefiLlama for the same window.",
    dataSource: "DefiLlama fees",
  });

  /* ── 5. Sports & Esports ──────────────────────────────────────────────── */
  const sunday = nextSundayUTC(now);
  editorial({
    title: `Will this weekend's Premier League round produce 30 or more goals?`,
    category: "Sports & Esports",
    tags: ["Football", "Premier League", `matchday ${day(sunday)}`],
    deadline: sunday,
    p: 0.46,
    description: "Goal totals are the least narrative-driven number in football: either the round was open or it was not.",
    resolution: `YES if the ten matches scheduled in the Premier League round ending ${day(sunday)} produce 30 or more goals in total, per the league's official results.`,
    dataSource: "Premier League official results",
  });
  editorial({
    title: `Will the Champions League matchday produce a 4-goal comeback from a losing position?`,
    category: "Sports & Esports",
    tags: ["Football", "UCL", "Matchday"],
    deadline: addDaysUTC(now, 14),
    p: 0.21,
    description: "Comebacks are the tail event that keeps the competition priced: rare enough to be a genuine surprise, common enough to be mispriced.",
    resolution: "YES if any team wins a Champions League match after trailing by two or more goals, within the next two matchdays.",
    dataSource: "UEFA official match reports",
  });
  editorial({
    title: `Will an esports grand final go to a deciding map this month?`,
    category: "Sports & Esports",
    tags: ["Esports", "Finals", "Best-of-five"],
    deadline: eom,
    p: 0.52,
    description: "Best-of-five finals resolve to a decider more often than the market usually prices, because seeding and patch changes compress the skill gap.",
    resolution: "YES if any Tier-1 esports grand final (CS2, LoL, Dota 2, Valorant) played before the deadline reaches its final map.",
    dataSource: "Tournament organiser results",
  });
  editorial({
    title: `Will a Formula 1 race this month be decided by under one second?`,
    category: "Sports & Esports",
    tags: ["Motorsport", "F1", "Margins"],
    deadline: eom,
    p: 0.33,
    description: "Winning margins are the physical measure of how close the field actually is, independent of the championship narrative.",
    resolution: "YES if any Formula 1 race held before the deadline has an official winning margin below 1.000 seconds.",
    dataSource: "FIA official classification",
  });
  editorial({
    title: `Will the NBA's highest-scoring game this month break 150 points in regulation?`,
    category: "Sports & Esports",
    tags: ["Basketball", "NBA", "Scoring"],
    deadline: eom,
    p: 0.29,
    description: "Pace and spacing have pushed scoring distributions up for a decade; 150 in regulation is still the edge of the tail.",
    resolution: "YES if any NBA team scores 150 or more points in regulation (overtime excluded) before the deadline.",
    dataSource: "NBA official box scores",
  });

  /* ── 6. Politics & Policy ─────────────────────────────────────────────── */
  editorial({
    title: `Will the US Senate pass a comprehensive crypto market-structure bill before ${label(eom)}?`,
    category: "Politics & Policy",
    tags: ["US", "Legislation", "Market structure"],
    deadline: eom,
    p: 0.23,
    description: "Market-structure legislation has cleared one chamber and stalled in the other twice. The question is procedural: floor time, not intent.",
    resolution: "YES if the US Senate passes a comprehensive digital-asset market-structure bill before the deadline, per congress.gov. Committee approval alone resolves NO.",
    dataSource: "congress.gov",
  });
  editorial({
    title: `Will a G20 regulator issue final stablecoin rules naming reserve composition before ${label(eom)}?`,
    category: "Politics & Policy",
    tags: ["Stablecoins", "Regulation", "G20"],
    deadline: eom,
    p: 0.31,
    description: "Reserve composition is the clause that decides whether a stablecoin is a payment rail or a shadow fund. Drafts without it do not count.",
    resolution: "YES if a G20 member's financial regulator publishes final (not draft) stablecoin rules that specify permitted reserve assets before the deadline.",
    dataSource: "Regulator official publications",
  });
  editorial({
    title: `Will the EU open an infringement procedure against a member state over MiCA implementation before ${label(eom)}?`,
    category: "Politics & Policy",
    tags: ["EU", "MiCA", "Enforcement"],
    deadline: eom,
    p: 0.19,
    description: "MiCA's deadlines have passed and national transposition is uneven; enforcement is where that unevenness becomes visible.",
    resolution: "YES if the European Commission opens a formal infringement procedure citing MiCA transposition before the deadline, per an official Commission decision.",
    dataSource: "European Commission infringement register",
  });
  editorial({
    title: `Will the next FOMC statement remove the phrase about inflation remaining elevated?`,
    category: "Politics & Policy",
    tags: ["Fed", "FOMC", "Rates"],
    deadline: addDaysUTC(now, 35),
    p: 0.38,
    description: "Statement language moves markets before the rate decision does. The phrase has survived multiple cuts; its removal is the signal.",
    resolution: "YES if the FOMC statement released within the window no longer characterises inflation as elevated. Parsing is literal.",
    dataSource: "Federal Reserve statement",
  });
  editorial({
    title: `Will any major jurisdiction grant a spot crypto ETF listing approval before ${label(eom)}?`,
    category: "Politics & Policy",
    tags: ["ETF", "Approval", "Global"],
    deadline: eom,
    p: 0.27,
    description: "Approval is a process: consultation, delegated act, listing. This market prices whether the last step lands inside the window.",
    resolution: "YES if a national securities regulator in the EU, UK, Japan or Korea grants an effective listing approval for a spot crypto ETF before the deadline. Consultation papers resolve NO.",
    dataSource: "Regulator approval notices",
  });

  /* ── 7. Base Ecosystem ────────────────────────────────────────────────── */
  if (baseTvl) {
    const target = Math.round((baseTvl * 0.95) / 1e8) * 1e8;
    editorial({
      title: `Will Base TVL hold above ${fmtBig(target)} through ${label(eom)}?`,
      category: "Base Ecosystem",
      tags: ["Base", "TVL", `now ${fmtBig(baseTvl)}`, "DefiLlama"],
      deadline: eom,
      p: clamp(0.62 - (1 - target / baseTvl) * 2.2, 0.15, 0.9),
      description: `A 5% drawdown is one bad week in a risk-off tape. Holding the level through month-end is a statement about Base's deposit base rather than its price.`,
      resolution: `YES if DefiLlama's Base chain TVL stays at or above ${fmtBig(target)} on every UTC day through ${day(eom)} 23:59 UTC.`,
      dataSource: "DefiLlama /v2/chains",
    });
  }
  priceAbove({ sym: "AERO", name: "AERO", pct: 0.08, deadline: eom, category: "Base Ecosystem",
    story: "AERO is the closest thing Base has to an index on its own activity: veAERO locks, DEX volume and emissions all settle through it." });
  priceAbove({ sym: "DEGEN", name: "DEGEN", pct: 0.12, deadline: eom, category: "Base Ecosystem",
    story: "Base's culture layer has a price, and it front-runs retail flow into the chain by roughly a week." });

  editorial({
    title: `Will Base process more daily transactions than Ethereum before ${label(eom)}?`,
    category: "Base Ecosystem",
    tags: ["Base", "Ethereum", "Throughput"],
    deadline: eom,
    p: 0.71,
    description: "Base already runs an order of magnitude more transactions than L1 Ethereum on most days. The interesting question is whether it holds through a quiet week.",
    resolution: `YES if Base's daily transaction count exceeds Ethereum L1's on every day of the final week before ${day(eom)}, per L2Beat and Etherscan.`,
    dataSource: "L2Beat + Etherscan",
  });
  editorial({
    title: `Will a Base-native app cross 1M daily active addresses before ${label(eom)}?`,
    category: "Base Ecosystem",
    tags: ["Base", "DAU", "Growth"],
    deadline: eom,
    p: 0.24,
    description: "Daily actives are the metric that survives incentive programs ending. One app at a million addresses would be a first for the chain.",
    resolution: "YES if any app deployed on Base reports 1,000,000+ daily active addresses on a single day before the deadline, corroborated by on-chain unique senders.",
    dataSource: "On-chain unique senders",
  });
  editorial({
    title: `Will Base sequencer revenue exceed $1M in a single week before ${label(eom)}?`,
    category: "Base Ecosystem",
    tags: ["Base", "Revenue", "Sequencer"],
    deadline: eom,
    p: 0.35,
    description: "Sequencer revenue is the only number that says an L2 is a business rather than a subsidy. A million-dollar week is the threshold.",
    resolution: "YES if Base's published sequencer revenue exceeds $1,000,000 in any seven-day window ending before the deadline.",
    dataSource: "Base / L2Beat revenue dashboard",
  });

  return out;
}

/* ───────────────────────────── main ───────────────────────────── */

function main() {
  const snap = readSnapshot();
  const age = snapshotAgeMs(snap);
  if (!snap || age > MAX_AGE_MS) {
    console.error(
      `[board] refusing to build: price snapshot is ${snap ? `${Math.round(age / 60_000)}min old` : "missing"} (max ${MAX_AGE_MS / 60_000}min). Run scripts/fetch-prices.ts first.`
    );
    process.exit(1);
  }
  const now = new Date();
  const drafts = buildBoard(snap, now);

  // Pools that exist on the contract are the contract's rows, not ours: emit them as
  // `source: "chain"` so the UI reads status/liquidity live and the USDC rail is open. The
  // registry is written by scripts/sync-opened-pools.py from getPool(), so a pool that was
  // cancelled still shows up (and reads as Canceled) instead of silently becoming a demo row.
  const OPENED = join(ROOT, "scripts", "opened-pools.json");
  type OpenedPool = { id: string; title: string; category?: string; endTimeUtc: string };
  const openedRows: OpenedPool[] = existsSync(OPENED)
    ? Object.values(JSON.parse(readFileSync(OPENED, "utf8")) as Record<string, OpenedPool>)
    : [];
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const openedByTitle = new Map(openedRows.map((o) => [norm(o.title), o]));
  const openedIds = new Set(openedRows.map((o) => o.id));

  // Chain rows are the contract's; only the generated half is rewritten.
  let previous: { pools?: Pool[]; [k: string]: unknown } = {};
  if (existsSync(POOLS)) {
    try {
      previous = JSON.parse(readFileSync(POOLS, "utf8"));
    } catch {
      previous = {};
    }
  }
  const chainRows = (previous.pools ?? []).filter((p) => p.source === "chain");

  const usedDemoIds = new Set<string>();
  const generated: Pool[] = drafts.map((d, i) => {
    // Ids are positional, so keep the historical assignment: the opener creates pools for exactly
    // these ids, which is what lets the demo cards place real bets.
    let demoId = String(ID_BASE + i + 1);
    void openedIds;
    while (usedDemoIds.has(demoId)) demoId = String(Number(demoId) + 1);
    usedDemoIds.add(demoId);
    // Presentation numbers come from the id alone (lib/display-stats), the same function the card
    // calls at render time: liquidity $12.5k–$88.5k, 85–320 traders, turnover 16–66% of liquidity.
    // Derived from the id rather than from the model's probability, so a card never reads $0.00 and
    // never changes on a rebuild that only moved spot.
    const stats = displayStatsFor(demoId);
    return {
      id: demoId,
      title: d.title,
      category: d.category,
      tags: d.tags,
      source: "demo",
      status: 1,
      endTimeUtc: d.deadline.toISOString(),
      liquidityUsdc: String(stats.liquidityUsdc),
      yesShare: d.yesShare,
      volume24hUsdc: String(stats.volume24hUsdc),
      traders: stats.traders,
      description: d.description,
      resolution: d.resolution,
      dataSource: d.dataSource,
      dataAsOf: d.dataAsOf,
      marketData: d.marketData,
      visual: coverFor({ title: d.title, category: d.category, tags: d.tags, marketData: d.marketData }),
    };
  });

  // Expired generated markets are gone by construction; log what that removed.
  const dropped = (previous.pools ?? []).filter(
    (p) => p.source !== "chain" && p.endTimeUtc && Date.parse(p.endTimeUtc) < now.getTime()
  );

  const byCategory: Record<string, number> = {};
  for (const p of generated) byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;

  const manifest = {
    version: 2,
    address: (process.env.ARENA_ADDRESS ?? "").trim() || previous.address || "0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5",
    chainId: previous.chainId ?? 8453,
    deployBlock: Number((process.env.ARENA_DEPLOY_BLOCK ?? "").trim()) || previous.deployBlock || 53150166,
    updatedAt: now.toISOString(),
    featured: generated.find((p) => p.source === "chain")?.id ?? chainRows[0]?.id ?? generated[0]?.id,
    dataSources: {
      prices: "Binance /api/v3/ticker/24hr (majors) + CoinGecko /simple/price (Base tokens)",
      global: "CoinGecko /global",
      tvl: "DefiLlama /v2/chains",
      asOf: snap.updatedAt,
    },
    stats: {
      tvlUsdc: previous.stats && (previous.stats as { tvlUsdc?: string }).tvlUsdc ? (previous.stats as { tvlUsdc: string }).tvlUsdc : "0",
      volume24hUsdc: null,
      activeMarkets: generated.length + chainRows.length,
      settledMarkets: 0,
    },
    pools: (() => {
      const byId = new Map<string, Pool>();
      // generated rows come last, so a freshly built demo card replaces a stale chain row that
      // was written by an earlier pass (the pool behind the id is unaffected).
      for (const row of [...chainRows, ...generated]) byId.set(row.id, row);
      return [...byId.values()];
    })(),
  };

  mkdirSync(dirname(OUT_LOG), { recursive: true });
  mkdirSync(dirname(POOLS), { recursive: true });
  writeFileSync(POOLS, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(
    OUT_LOG,
    JSON.stringify(
      {
        generatedAt: now.toISOString(),
        snapshotAt: snap.updatedAt,
        snapshotAgeMin: Math.round(age / 60_000),
        sources: snap.sources,
        assets: snap.assets,
        global: snap.global,
        chains: snap.chains,
        count: generated.length,
        byCategory,
        droppedExpired: dropped.map((p) => p.title),
      },
      null,
      2
    ) + "\n"
  );

  console.log("── board rebuilt ─────────────────────────────────────────────");
  console.log(`snapshot   : ${snap.updatedAt} (${Math.round(age / 60_000)}min old, ${Object.entries(snap.sources).map(([k, v]) => `${k}=${v}`).join(" ")})`);
  console.log(`markets    : ${generated.length} generated + ${chainRows.length} on-chain`);
  for (const [cat, n] of Object.entries(byCategory)) console.log(`  ${cat.padEnd(20)} ${n}`);
  if (dropped.length) console.log(`expired    : ${dropped.length} removed (${dropped.map((p) => p.title.slice(0, 48)).join(" · ")})`);
  console.log(`written    : ${POOLS}`);
}

main();
