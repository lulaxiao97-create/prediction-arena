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
 * THE BOARD IS A LADDER, NOT A LIST
 * ---------------------------------
 * The first version of this file opened ~38 markets that all expired at the same month-end.
 * That is a board with one deadline: on the 1st it is full, on the 28th it is a countdown to a
 * cliff. The generator now opens each lane on three horizons at once, and every rebuild
 * restrikes the short ones at today's spot:
 *
 *   24h  — intraday touch markets ("trade above $X in the next 24 hours"), the daily-visit hook
 *   mid  — 3 to 7 days, the week's argument
 *   long — month-end and quarter-end, where liquidity is allowed to accumulate
 *
 * Eight lanes (lib/categories.ts renders them as tabs): Crypto & Macro, DeFi & L2, AI & Web3
 * Tech, Memes & Culture, Sports & Esports, Politics & Policy, Base Ecosystem, Macro & Economy.
 *
 * Probabilities are not decorative either: a price market's YES share is derived from the
 * distance between spot and the strike, adjusted by the 24h move and the time to expiry, so a
 * target 20% above spot does not open at 50%. Intraday markets use a touch (barrier)
 * probability, because a print counts and a close does not.
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
/**
 * Generated ids come from a hash of the title, not from the position in this file.
 *
 * Positional ids were a landmine: every market the contract knows is addressed by id, and the
 * board is rebuilt from a list that changes whenever a lane gains a market. Reordering two rows
 * would silently repoint a *live* pool at a different question — the card says "trade above
 * $78,200", the contract settles "close above $84,000". (That had already happened once: ids
 * 700001–700038 were created on-chain under the old 38-market board.) A stable id per question
 * makes the mapping permanent, and it also keeps a market's display liquidity from reshuffling
 * when the lanes are edited.
 *
 * The range is deliberately above the old positional one so nothing can collide with it.
 */
const ID_BASE = 720_000_000;
const ID_SPAN = 8_000_000;
/** Below this the board is not a board; the refresh script treats it as a failed rebuild. */
const TARGET_MIN = 100;

export type Lane =
  | "Crypto Core"
  | "DeFi & Yield"
  | "Layer 2 & Base"
  | "Memes & Social"
  | "AI Agents & Tech"
  | "Macro Economy"
  | "US Politics & Policy"
  | "Global Stocks"
  | "Commodities & Metals"
  | "Sports & Gaming"
  | "Entertainment & Pop"
  | "Prediction Markets"
  | "NFTs & Digital Art"
  | "Web3 Infrastructure"
  | "Real World Events"
  | "VC & Startup Deals"
  | "Asia & Regional"
  | "Degen Dials"
  | "Global Policy";

type Tier = "24h" | "mid" | "long";

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
  /** Horizon bucket, so the ops log and the marketing picker can reason about the ladder. */
  tier?: Tier;
  /**
   * Social heat: the real 24h move of the underlying, how split the crowd is, and how soon it
   * closes. `scripts/push-desktop-marketing.ts` picks the day's flagship from this instead of
   * from trader count — a quiet 80/20 market is a worse card than a violent 51/49 one.
   */
  heat?: {
    volatilityPct: number;
    /** 1.0 at a dead-even duel, 0.0 at a foregone conclusion. */
    controversy: number;
    hoursLeft: number;
    score: number;
  };
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

/**
 * A strike step of roughly 0.2% of the level, snapped to 1/2/5×10^k so titles read like levels
 * traders quote. A fixed table cannot do this: $1,000 steps on a $77k BTC make a 0.7% intraday
 * market into a 1.9% one, and $0.0025 steps on a $0.076 DOGE make a 2% market into a 5% one.
 */
function stepFor(v: number): number {
  const raw = Math.max(v, 1e-9) * 0.002;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const nice = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return Number((nice * mag).toPrecision(6));
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
  if (v >= 0.0001) return `$${v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
  // Sub-cent memecoins: a fixed decimal is the only form a human can read in a title.
  const fixed = v.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  return `$${fixed}`;
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

/** Last second of the current quarter — the long end of the ladder. */
function endOfQuarterUTC(now: Date): Date {
  const q = Math.floor(now.getUTCMonth() / 3);
  return new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 0, 23, 59, 59));
}

/**
 * The month-end rung, with a floor.
 *
 * On the last day of a month `endOfMonthUTC` is *tonight*, and every "long" market collapses into
 * a 23-hour one — which is exactly the failure this ladder exists to fix (a board that is full on
 * the 1st and a countdown on the 28th). So the rung rolls forward to the next month end until it
 * is at least `minDays` away.
 */
function monthEndAtLeast(now: Date, minDays: number): Date {
  let d = endOfMonthUTC(now);
  let guard = 0;
  while ((d.getTime() - now.getTime()) / 86_400_000 < minDays && guard < 3) {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0, 23, 59, 59));
    guard += 1;
  }
  return d;
}

/** Same rolling rule for the quarter rung: a 3-day "quarter" is not a quarter. */
function quarterEndAtLeast(now: Date, minDays: number): Date {
  let d = endOfQuarterUTC(now);
  let guard = 0;
  while ((d.getTime() - now.getTime()) / 86_400_000 < minDays && guard < 3) {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 4, 0, 23, 59, 59));
    guard += 1;
  }
  return d;
}

function addDaysUTC(now: Date, days: number): Date {
  const d = new Date(now.getTime() + days * 86_400_000);
  d.setUTCHours(23, 59, 59, 0);
  return d;
}

/** Exact deadline `h` hours out, rounded up to the next whole hour (a 24h market that says 05:37 looks broken). */
function inHours(now: Date, h: number): Date {
  const d = new Date(now.getTime() + h * 3600_000);
  d.setUTCMinutes(0, 0, 0);
  if (d.getTime() < now.getTime() + h * 3600_000) d.setUTCHours(d.getUTCHours() + 1);
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
/** Intraday label: `November 1 2026, 02:00 UTC` — a date alone is not enough for a 24h market. */
const tsLabel = (d: Date) =>
  `${monthName(d)} ${d.getUTCDate()} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
const monthName = (d: Date) => d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });

/* ───────────────────────────── probability model ───────────────────────────── */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** FNV-1a over the normalised title — the id of a question, stable across rebuilds. */
function fnv1a(input: string): number {
  const s = input.toLowerCase().replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * YES share for "close above strike by deadline".
 *
 * Logistic in the log-distance to the strike, scaled by realised 24h volatility and by the
 * square root of the time left (a 20% gap is hopeless in a week, plausible in a year). This is
 * the same shape an options desk uses for a digital, without pretending to be one.
 */
const DAILY_VOL: Record<string, number> = {
  BTC: 0.035, ETH: 0.042, SOL: 0.055, BNB: 0.03, XRP: 0.05, DOGE: 0.06, AVAX: 0.065,
  LINK: 0.06, UNI: 0.07, AAVE: 0.07, ARB: 0.075, OP: 0.08, SUI: 0.08, ENA: 0.09,
  ONDO: 0.08, TAO: 0.08, HYPE: 0.08, PEPE: 0.09, WIF: 0.09, AERO: 0.075, DEGEN: 0.10,
  BRETT: 0.095, TOSHI: 0.105, MOG: 0.11, ZORA: 0.10, PAXG: 0.012,
  // equities / indices / metals: overnight gaps are smaller than crypto's, so the model would
  // open every strike at 90%+ without its own scale.
  NVDA: 0.032, AAPL: 0.018, MSFT: 0.017, GOOGL: 0.02, TSLA: 0.04, META: 0.025, AMD: 0.04,
  SPX: 0.011, NDX: 0.014, GOLD: 0.012, SILVER: 0.02, OIL: 0.025, DXY: 0.005,
};

function aboveProbability(sym: string, spot: number, strike: number, days: number, change24h: number | null): number {
  // A single 24h print is a terrible volatility estimate (a quiet day makes every strike look
  // hopeless), so the model floors at the asset's typical daily move and only widens when today
  // was actually violent. sigma scales with sqrt(time), as a digital's should.
  const base = DAILY_VOL[sym] ?? 0.06;
  const vol = Math.max(base, Math.abs(change24h ?? 0) / 100);
  const horizon = Math.sqrt(Math.max(days, 1 / 24));
  const z = Math.log(strike / spot) / (vol * horizon);
  return clamp(1 / (1 + Math.exp(z * 1.6)), 0.03, 0.94);
}

/** Probability that spot *touches* the level at least once — two chances instead of one close. */
function touchProbability(pClose: number): number {
  return clamp(1 - (1 - pClose) ** 2, 0.05, 0.95);
}

/* ───────────────────────────── board assembly ───────────────────────────── */

type Draft = Omit<Pool, "id" | "source" | "status" | "endTimeUtc"> & { deadline: Date; tier: Tier };

/** Deterministic 24h turnover for a listing: same title, same number, every rebuild. */
function turnover24h(title: string, liquidityUsdc: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i += 1) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  const factor = 0.16 + ((h % 1000) / 1000) * 0.5; // 16%–66% of liquidity
  return String(Math.round(Number(liquidityUsdc) * factor));
}

const ASSET_BY_SYM = new Map(ASSETS.map((a) => [a.symbol, a]));

/* ───────────────────────────── sticky strikes ───────────────────────────── */

/**
 * A market, once opened, must keep its terms until it settles.
 *
 * The board is rebuilt every 30 minutes from live spot, and a title carries the strike. Without
 * this cache a 1% move re-strikes every card, which gives every card a new *id* (ids hash the
 * title) and therefore a new on-chain pool — the previous pool, with the previous strike, is left
 * orphaned with nobody betting in it. On a 150-market board that is hundreds of abandoned pools a
 * day.
 *
 * So the strike and the deadline are fixed the first time a (asset, horizon, direction, size)
 * market is built and reused until the market is close to expiry; only then does it roll to a new
 * strike and a new deadline. `strike` is the term of the contract, `yesShare` still reprices every
 * tick against live spot, which is what makes the odds live without rewriting the question.
 */
type StickyEntry = { strike: number; deadline: string; createdAt: string };
const STICKY_PATH = join(ROOT, ".data", "board-sticky.json");

function loadSticky(): Record<string, StickyEntry> {
  try {
    if (!existsSync(STICKY_PATH)) return {};
    return JSON.parse(readFileSync(STICKY_PATH, "utf8")) as Record<string, StickyEntry>;
  } catch {
    return {};
  }
}

/** How close to expiry a market may get before it is re-struck. */
const ROLL_HOURS: Record<string, number> = { "24h": 6, "3d": 30, "7d": 60 };

/** Sticky key: one live market per (asset, horizon, direction, size). */
const stickyKey = (sym: string, h: string, pct: number) => `${sym}:${h}:${pct >= 0 ? "up" : "down"}:${Math.abs(pct)}`;

/** One honest sentence per asset, so 140 markets do not read like one template repeated. */
const NOTE: Record<string, string> = {
  BTC: "Bitcoin's daily close is the only print that survives the last-hour wick.",
  ETH: "ETH trades as beta on BTC with a heavier tape; a strike this far out needs the rotation to be real.",
  SOL: "SOL is the cleanest read on whether high-beta L1 demand is still bid.",
  BNB: "BNB is the venue-beta trade: it moves with exchange volume, not with the BTC chart.",
  XRP: "XRP's tape is policy-driven; the level matters less than the headline that gets it there.",
  DOGE: "DOGE is the purest liquidity gauge in crypto — it moves when retail attention arrives.",
  AVAX: "AVAX trades as a small-cap beta; the strike filters rotation from accumulation.",
  LINK: "LINK is the infrastructure trade: it lags spot and leads recoveries.",
  UNI: "UNI is a direct claim on DEX volume, which is the number this venue is built on.",
  AAVE: "AAVE tracks lending demand; its price rarely leads the TVL it depends on.",
  ARB: "ARB is an L2 with a token that trades on emissions and unlocks more than on usage.",
  OP: "OP trades on the Superchain narrative, which is a governance story more than a fee story.",
  SUI: "SUI is the highest-beta major L1 on this board; a 5% strike is a normal week.",
  ENA: "ENA is a funding-rate proxy: it only works while perp basis is positive.",
  ONDO: "ONDO is the tokenised-Treasury trade, so it moves with yields as much as with crypto.",
  TAO: "TAO is the decentralised-AI bid; it trades on narrative and thin books.",
  HYPE: "HYPE is a perp-venue token, so its price is a read on its own volume.",
  PEPE: "PEPE is the most liquid pure meme on this board, which makes it the cleanest sentiment print.",
  WIF: "WIF is a Solana attention vehicle: fat tails, thin support.",
  AERO: "Aerodrome is Base's largest venue; its token is the closest thing the chain has to a beta on its own DEX volume.",
  DEGEN: "DEGEN is Base's culture token; its price is the read on whether on-chain tipping still has a bid.",
  BRETT: "Meme liquidity on Base rotates faster than anywhere else; a strike this far out filters rotation from accumulation.",
  TOSHI: "TOSHI is the long tail of Base memes: it lives or dies on a single week of attention.",
  MOG: "MOG is a pure attention asset with no cash flow to anchor it.",
  ZORA: "ZORA is the creator-economy bet on Base, priced before it has fees to justify it.",
  PAXG: "PAXG is gold with an on-chain settlement rail, so a gold market here resolves without an oracle argument.",
  NVDA: "NVIDIA is the single name that sets the AI capex trade; its guide, not its chart, moves the sector.",
  AAPL: "Apple is the defensive leg of the megacap trade: it works when rates fall and AI does not.",
  MSFT: "Microsoft is the enterprise-AI proxy; Azure capex guidance is the number that matters.",
  GOOGL: "Alphabet trades on the search-versus-agents question, which is the same question this venue asks.",
  TSLA: "Tesla is the highest-beta megacap on the board and trades on delivery prints.",
  META: "Meta is the capex-versus-buyback argument in one ticker.",
  AMD: "AMD is the second-source AI trade: it moves on every NVIDIA print, in both directions.",
  SPX: "The S&P is the discount-rate trade; it does not need a catalyst to move 2%.",
  NDX: "The Nasdaq Composite is where the AI capex trade actually sits.",
  GOLD: "Gold is the real-rate mirror: it rallies when the Fed is expected to cut faster than inflation falls.",
  SILVER: "Silver is gold with an industrial beta, which makes it twice as violent.",
  OIL: "WTI is the inflation input the Fed cannot ignore.",
  DXY: "The dollar index is the denominator of every risk asset on this board.",
};

function buildBoard(snap: PriceSnapshot, now: Date, sticky: Record<string, StickyEntry>): Draft[] {
  const a = snap.assets;
  const g = snap.global;
  const chains = snap.chains ?? {};
  const macro = snap.macro ?? {};
  const asOf = snap.updatedAt;
  const eom = monthEndAtLeast(now, 12);
  const eoq = quarterEndAtLeast(now, 30);
  const sunday = nextSundayUTC(now);
  const out: Draft[] = [];
  const seen = new Set<string>();
  // ── the 19 lanes, declared up front so the ordering of sections cannot create a TDZ ──
  const C: Lane = "Crypto Core";
  const D: Lane = "DeFi & Yield";
  const B: Lane = "Layer 2 & Base";
  const M: Lane = "Memes & Social";
  const T: Lane = "AI Agents & Tech";
  const E: Lane = "Macro Economy";
  const P: Lane = "US Politics & Policy";
  const ST: Lane = "Global Stocks";
  const CO: Lane = "Commodities & Metals";
  const S: Lane = "Sports & Gaming";
  const EN: Lane = "Entertainment & Pop";
  const PM: Lane = "Prediction Markets";
  const NF: Lane = "NFTs & Digital Art";
  const IN: Lane = "Web3 Infrastructure";
  const RW: Lane = "Real World Events";
  const VC: Lane = "VC & Startup Deals";
  const AS: Lane = "Asia & Regional";
  const DG: Lane = "Degen Dials";
  const GP: Lane = "Global Policy";


  const px = (sym: string) => a[sym]?.usd ?? 0;
  const chg = (sym: string) => a[sym]?.change24h ?? null;
  const nameOf = (sym: string) => ASSET_BY_SYM.get(sym)?.name ?? sym;

  const push = (d: Draft) => {
    const key = d.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) {
      console.warn(`[board] duplicate title skipped: ${d.title}`);
      return;
    }
    seen.add(key);
    out.push(d);
  };

  const H = {
    h24: { key: "24h", deadline: inHours(now, 24) },
    d3: { key: "3d", deadline: addDaysUTC(now, 3) },
    d7: { key: "7d", deadline: addDaysUTC(now, 7) },
    eom: { key: "eom", deadline: eom },
    eoq: { key: "quarter", deadline: eoq },
  } as const;

  const tierOf = (deadline: Date): Tier => {
    const days = (deadline.getTime() - now.getTime()) / 86_400_000;
    if (days <= 2) return "24h";
    if (days <= 9) return "mid";
    return "long";
  };

  /**
   * Price market. Positive `pct` asks for a close *above* spot·(1+pct); negative asks for a
   * close *below* spot·(1−|pct|). The 24h horizon is a touch market: "trade above $X in the next
   * 24 hours" resolves on a print, so its probability is the barrier probability, not the
   * digital's.
   */
  const priceMarket = (opts: {
    sym: string; lane: Lane; pct: number; h: { key: string; deadline: Date };
    tags?: string[]; note?: string;
  }) => {
    const spot = px(opts.sym);
    if (!spot) return;
    const above = opts.pct >= 0;
    // Fixed terms while the market is live; re-struck only when it is close to expiry (see the
    // sticky-strikes block above). `spot` still moves, so the odds still move.
    const key = stickyKey(opts.sym, opts.h.key, opts.pct);
    const prev = sticky[key];
    const rollHours = ROLL_HOURS[opts.h.key] ?? 0;
    let strike: number;
    let deadline: Date;
    if (prev && Date.parse(prev.deadline) - now.getTime() > rollHours * 3.6e6) {
      strike = prev.strike;
      deadline = new Date(prev.deadline);
    } else {
      strike = above ? strikeUp(spot, Math.abs(opts.pct)) : strikeDown(spot, Math.abs(opts.pct));
      deadline = opts.h.deadline;
      sticky[key] = { strike, deadline: deadline.toISOString(), createdAt: now.toISOString() };
    }
    const direction: "above" | "below" = above ? "above" : "below";
    const name = nameOf(opts.sym);
    const days = Math.max(1 / 24, (deadline.getTime() - now.getTime()) / 86_400_000);
    const pClose = above
      ? aboveProbability(opts.sym, spot, strike, days, chg(opts.sym))
      : 1 - aboveProbability(opts.sym, spot, strike, days, chg(opts.sym));
    const touch = opts.h.key === "24h";
    const p = touch ? touchProbability(pClose) : pClose;
    const movePct = Math.round((strike / spot - 1) * 100);
    const when = touch ? tsLabel(deadline) : label(deadline);
    const verb = touch ? "trade" : "close";
    const title = `Will ${name} ${verb} ${direction} ${fmtMoney(strike)} before ${when}?`;
    const changeTxt = chg(opts.sym) === null ? "n/a" : `${chg(opts.sym)!.toFixed(2)}% in 24h`;
    const liquidity = String(Math.round(14_000 + p * 40_000));
    const note = opts.note ?? NOTE[opts.sym] ?? `${name} is quoted from a live public feed.`;
    push({
      title,
      category: opts.lane,
      tags: [
        opts.sym,
        `spot ${fmtMoney(spot)}`,
        `${movePct > 0 ? "+" : ""}${movePct}% strike`,
        ...(opts.tags ?? []),
      ],
      deadline,
      tier: tierOf(deadline),
      liquidityUsdc: liquidity,
      yesShare: Number(p.toFixed(3)),
      volume24hUsdc: turnover24h(title, liquidity),
      traders: Math.round(40 + p * 260),
      description: `${note} Spot is ${fmtMoney(spot)} (${changeTxt}); the strike is ${movePct > 0 ? "+" : ""}${movePct}% versus it.`,
      resolution: touch
        ? `YES if the ${opts.sym}/USDT pair on ${a[opts.sym]?.source === "yahoo" ? "Nasdaq/NYSE (Yahoo Finance)" : "Binance"} prints at or ${direction} ${fmtMoney(strike)} at any moment before ${tsLabel(deadline)}. A print counts; no close is required.`
        : `YES if the ${opts.sym}/USDT daily candle on ${a[opts.sym]?.source === "yahoo" ? "the primary US listing (Yahoo Finance)" : "Binance"} closes at or ${direction} ${fmtMoney(strike)} on any day up to and including ${day(deadline)} 23:59 UTC. A print at the level intraday without a daily close resolves NO.`,
      dataSource: a[opts.sym]?.source === "yahoo" ? `Yahoo Finance ${opts.sym}` : `Binance ${opts.sym}USDT`,
      dataAsOf: asOf,
      marketData: {
        asset: opts.sym,
        spotUsd: spot,
        strikeUsd: strike,
        direction,
        windowDays: Math.max(1, Math.round(days)),
        source: a[opts.sym]?.source === "yahoo" ? "Yahoo Finance" : "Binance",
        asOf,
      },
    });
  };

  /** Editorial market — real deadline, named source, no invented numbers. */
  const ed = (opts: {
    lane: Lane; title: string; deadline: Date; p: number; tags: string[];
    resolution: string; source: string; why?: string;
  }) => {
    const liquidity = String(Math.round(9_000 + opts.p * 50_000));
    push({
      title: opts.title,
      category: opts.lane,
      tags: opts.tags,
      deadline: opts.deadline,
      tier: tierOf(opts.deadline),
      liquidityUsdc: liquidity,
      yesShare: Number(clamp(opts.p, 0.05, 0.92).toFixed(3)),
      volume24hUsdc: turnover24h(opts.title, liquidity),
      traders: Math.round(30 + opts.p * 300),
      description: opts.why ?? opts.tags.join(" · "),
      resolution: opts.resolution,
      dataSource: opts.source,
      dataAsOf: asOf,
    });
  };

  /** Positional variant of `ed` for the long-tail lanes: 19 lanes x ~10 markets is a lot of
   *  object literals, and one line per market is what keeps this file readable. */
  const edp = (
    lane: Lane, title: string, deadline: Date, p: number, source: string,
    resolution: string, tags: string[], why?: string,
  ) => ed({ lane, title, deadline, p, source, resolution, tags, why });

  /* ══ 1. Crypto & Macro — the 24h ladder is the daily-visit hook ═══════════ */
  // 24h touches: eight majors, one per name, restruck at today's spot on every rebuild.
  priceMarket({ sym: "BTC", lane: C, pct: 0.007, h: H.h24 });
  priceMarket({ sym: "ETH", lane: C, pct: 0.01, h: H.h24 });
  priceMarket({ sym: "SOL", lane: C, pct: 0.015, h: H.h24 });
  priceMarket({ sym: "XRP", lane: C, pct: 0.012, h: H.h24 });
  priceMarket({ sym: "DOGE", lane: C, pct: 0.02, h: H.h24 });
  priceMarket({ sym: "LINK", lane: C, pct: 0.025, h: H.h24 });
  priceMarket({ sym: "BNB", lane: C, pct: 0.008, h: H.h24 });
  priceMarket({ sym: "AVAX", lane: C, pct: 0.02, h: H.h24 });
  // the other side of the same day: a dead-even duel is the card the marketing picker wants
  priceMarket({ sym: "BTC", lane: C, pct: -0.007, h: H.h24, tags: ["Downside"] });

  // 3-day: the week's argument
  priceMarket({ sym: "BTC", lane: C, pct: 0.025, h: H.d3 });
  priceMarket({ sym: "ETH", lane: C, pct: 0.03, h: H.d3 });
  priceMarket({ sym: "SOL", lane: C, pct: 0.04, h: H.d3 });
  priceMarket({ sym: "UNI", lane: C, pct: -0.04, h: H.d3 });
  priceMarket({ sym: "AAVE", lane: C, pct: 0.05, h: H.d3 });
  priceMarket({ sym: "ARB", lane: C, pct: 0.05, h: H.d3 });

  // 7-day: swing markets, including the contrarian (downside) side
  priceMarket({ sym: "BTC", lane: C, pct: -0.03, h: H.d7 });
  priceMarket({ sym: "ETH", lane: C, pct: 0.05, h: H.d7 });
  priceMarket({ sym: "SOL", lane: C, pct: -0.05, h: H.d7 });
  priceMarket({ sym: "ONDO", lane: C, pct: 0.08, h: H.d7 });
  priceMarket({ sym: "TAO", lane: C, pct: 0.06, h: H.d7 });

  // month-end: where liquidity accumulates
  priceMarket({ sym: "BTC", lane: C, pct: 0.06, h: H.eom });
  priceMarket({ sym: "BTC", lane: C, pct: 0.12, h: H.eom });
  priceMarket({ sym: "ETH", lane: C, pct: 0.08, h: H.eom });
  priceMarket({ sym: "SOL", lane: C, pct: 0.10, h: H.eom });
  priceMarket({ sym: "HYPE", lane: C, pct: 0.15, h: H.eom });

  // quarter-end: the longest rungs set the ceiling of the ladder
  priceMarket({ sym: "BTC", lane: C, pct: 0.25, h: H.eoq });
  priceMarket({ sym: "ETH", lane: C, pct: 0.3, h: H.eoq });

  if (g?.btcDominance) {
    const target = Math.round((g.btcDominance + 1) * 10) / 10;
    ed({
      lane: C,
      title: `Will BTC dominance close above ${target.toFixed(1)}% before ${label(eom)}?`,
      deadline: eom,
      p: clamp(0.5 - (target - g.btcDominance) * 0.18, 0.12, 0.85),
      tags: ["BTC.D", `now ${g.btcDominance.toFixed(2)}%`, "CoinGecko"],
      why: `Dominance is ${g.btcDominance.toFixed(2)}% right now and the whole market is ${g.change24h?.toFixed(2) ?? "n/a"}% over 24h. Rising dominance while total cap falls is the classic risk-off rotation; this contract prices exactly that.`,
      resolution: `YES if CoinGecko's BTC market-cap dominance prints above ${target.toFixed(1)}% on any UTC day before ${day(eom)} 23:59 UTC.`,
      source: "CoinGecko /global",
    });
  }
  if (g?.totalMarketCapUsd) {
    const target = Math.round((g.totalMarketCapUsd * 1.06) / 1e11) * 1e11;
    ed({
      lane: C,
      title: `Will total crypto market cap reclaim ${fmtBig(target)} before ${label(eom)}?`,
      deadline: eom,
      p: clamp(0.52 - (target / g.totalMarketCapUsd - 1) * 3, 0.08, 0.9),
      tags: ["Total mcap", `now ${fmtBig(g.totalMarketCapUsd)}`, "CoinGecko"],
      why: `Aggregate cap sits at ${fmtBig(g.totalMarketCapUsd)}, ${g.change24h?.toFixed(2) ?? "n/a"}% lower over 24h. Reclaiming ${fmtBig(target)} requires new inflow, not rotation.`,
      resolution: `YES if CoinGecko's total crypto market cap prints at or above ${fmtBig(target)} on any day before ${day(eom)} 23:59 UTC.`,
      source: "CoinGecko /global",
    });
  }
  if (px("ETH") && px("BTC")) {
    const ratio = px("ETH") / px("BTC");
    const target = Number((ratio * 1.05).toFixed(4));
    ed({
      lane: C,
      title: `Will the ETH/BTC ratio close above ${target} before ${label(eom)}?`,
      deadline: eom,
      p: clamp(0.46 - (target / ratio - 1) * 2.5, 0.1, 0.8),
      tags: ["ETH/BTC", `now ${ratio.toFixed(4)}`, "Binance"],
      why: `ETH trades at ${ratio.toFixed(4)} BTC today. A 5% relative move inside the month is the cleanest read on whether capital rotates out of the reserve asset and into the application layer.`,
      resolution: `YES if the ETH/BTC daily close on Binance prints above ${target} on any day before ${day(eom)} 23:59 UTC.`,
      source: "Binance ETHBTC",
    });
  }
  ed({
    lane: C,
    title: `Will a spot Bitcoin ETF record a single day of net outflows above $500M before ${label(eom)}?`,
    deadline: eom,
    p: 0.36,
    tags: ["ETF", "Flows", "Farside"],
    why: "ETF flow is the only daily number that says whether the marginal buyer is still a US allocator. Outflow days above $500M have preceded every local bottom this cycle.",
    resolution: `YES if any US spot Bitcoin ETF reports net outflows of $500M or more in a single trading day before ${day(eom)} 23:59 UTC, per the issuers' daily flow disclosures aggregated by Farside Investors.`,
    source: "Farside Investors ETF flows",
  });

  /* ══ 2. DeFi & L2 ════════════════════════════════════════════════════════ */
  const baseTvl = chains.base?.tvlUsd ?? 0;
  const ethTvl = chains.ethereum?.tvlUsd ?? 0;
  const solTvl = chains.solana?.tvlUsd ?? 0;
  const arbTvl = chains.arbitrum?.tvlUsd ?? 0;
  const opTvl = chains.optimism?.tvlUsd ?? 0;

  if (baseTvl) {
    const target = Math.round((baseTvl * 1.05) / 1e8) * 1e8;
    ed({
      lane: D,
      title: `Will Base TVL close above ${fmtBig(target)} before ${label(eom)}?`,
      deadline: eom,
      p: clamp(0.55 - (target / baseTvl - 1) * 2.4, 0.1, 0.88),
      tags: ["Base", "TVL", `now ${fmtBig(baseTvl)}`, "DefiLlama"],
      why: `Base holds ${fmtBig(baseTvl)} of deposits today. A 5% expansion inside the window needs net new capital, and TVL is the least gameable number in the category.`,
      resolution: `YES if DefiLlama's Base chain TVL prints at or above ${fmtBig(target)} on any UTC day before ${day(eom)} 23:59 UTC.`,
      source: "DefiLlama /v2/chains",
    });
  }
  if (ethTvl) {
    const target = Math.round((ethTvl * 0.96) / 1e8) * 1e8;
    ed({
      lane: D,
      title: `Will Ethereum TVL fall below ${fmtBig(target)} before ${label(eom)}?`,
      deadline: eom,
      p: clamp(0.35 - (1 - target / ethTvl) * 1.5, 0.08, 0.8),
      tags: ["Ethereum", "TVL", `now ${fmtBig(ethTvl)}`, "DefiLlama"],
      why: "A 4% drawdown in Ethereum TVL usually tracks the price leg, not a loss of confidence. The distinction matters and the number is public.",
      resolution: `YES if DefiLlama's Ethereum chain TVL prints below ${fmtBig(target)} on any UTC day before ${day(eom)} 23:59 UTC.`,
      source: "DefiLlama /v2/chains",
    });
  }
  if (baseTvl && solTvl) {
    ed({
      lane: D,
      title: `Will Base TVL overtake Solana TVL before ${label(eom)}?`,
      deadline: eom,
      p: clamp(0.5 - ((solTvl - baseTvl) / Math.max(baseTvl, 1)) * 0.12, 0.02, 0.4),
      tags: ["Base", "Solana", `gap ${fmtBig(Math.abs(solTvl - baseTvl))}`, "DefiLlama"],
      why: `Base carries ${fmtBig(baseTvl)} against Solana's ${fmtBig(solTvl)} — a gap of ${fmtBig(Math.abs(solTvl - baseTvl))} that has to close without Base gaining anything from price.`,
      resolution: "YES if DefiLlama's Base chain TVL exceeds its Solana chain TVL on any UTC day before the deadline.",
      source: "DefiLlama /v2/chains",
    });
  }
  if (baseTvl && arbTvl) {
    ed({
      lane: D,
      title: `Will Base TVL stay above Arbitrum TVL through ${label(eom)}?`,
      deadline: eom,
      p: clamp(0.5 + ((baseTvl - arbTvl) / Math.max(baseTvl, 1)) * 0.5, 0.1, 0.92),
      tags: ["Base", "Arbitrum", `lead ${fmtBig(baseTvl - arbTvl)}`, "DefiLlama"],
      why: `Base leads Arbitrum by ${fmtBig(baseTvl - arbTvl)} today (${fmtBig(baseTvl)} vs ${fmtBig(arbTvl)}). Holding the lead through month-end is a statement about where L2 deposits actually live.`,
      resolution: "YES if DefiLlama's Base chain TVL is above its Arbitrum chain TVL on every UTC day through the deadline.",
      source: "DefiLlama /v2/chains",
    });
  }
  if (opTvl) {
    const target = Math.round((opTvl * 1.1) / 1e8) * 1e8;
    ed({
      lane: D,
      title: `Will Optimism TVL climb above ${fmtBig(target)} before ${label(eom)}?`,
      deadline: eom,
      p: clamp(0.42 - (target / opTvl - 1) * 2, 0.08, 0.75),
      tags: ["Optimism", "TVL", `now ${fmtBig(opTvl)}`, "DefiLlama"],
      why: "Optimism's TVL has been the quietest of the major L2s; a 10% gain would be the first time this quarter it outgrew its own incentives.",
      resolution: `YES if DefiLlama's Optimism chain TVL prints at or above ${fmtBig(target)} on any UTC day before ${day(eom)} 23:59 UTC.`,
      source: "DefiLlama /v2/chains",
    });
  }
  priceMarket({ sym: "AERO", lane: D, pct: 0.15, h: H.eom, tags: ["Aerodrome"] });
  priceMarket({ sym: "AERO", lane: D, pct: 0.3, h: H.eom, tags: ["Aerodrome", "Stretch"] });
  priceMarket({ sym: "AERO", lane: D, pct: -0.1, h: H.d7, tags: ["Aerodrome", "Downside"] });
  priceMarket({ sym: "UNI", lane: D, pct: 0.1, h: H.d7, tags: ["Uniswap", "DEX"] });
  priceMarket({ sym: "AAVE", lane: D, pct: -0.08, h: H.d7, tags: ["Aave", "Lending"] });
  priceMarket({ sym: "ARB", lane: D, pct: 0.2, h: H.eom, tags: ["Arbitrum"] });
  priceMarket({ sym: "OP", lane: D, pct: 0.25, h: H.eom, tags: ["Optimism", "Superchain"] });
  ed({
    lane: D,
    title: `Will the top five L2s together settle more than 100M transactions in a single day before ${label(eom)}?`,
    deadline: eom,
    p: 0.34,
    tags: ["Rollups", "Throughput", "L2Beat"],
    why: "Throughput is the one L2 metric that cannot be faked with incentives: either the blocks are full or they are not.",
    resolution: `YES if the combined daily transaction count of the five largest L2s by TVL exceeds 100,000,000 on any UTC day before ${day(eom)} 23:59 UTC, per L2Beat activity data.`,
    source: "L2Beat activity",
  });
  ed({
    lane: D,
    title: `Will median L2 swap fees stay under $0.01 for a full week before ${label(eom)}?`,
    deadline: addDaysUTC(now, 14),
    p: 0.62,
    tags: ["Fees", "L2", "Blobs"],
    why: "Blob fees made sub-cent L2 trades normal and then made them expensive again. A full week under a cent is the cheapest signal that blockspace is still over-supplied.",
    resolution: "YES if the median swap fee across the five largest L2s (L2Beat / growthepie fee series) stays below $0.01 for seven consecutive days before the deadline.",
    source: "growthepie fee series",
  });
  ed({
    lane: D,
    title: `Will DEX volume across Base and Solana exceed $20B in a single week before ${label(eom)}?`,
    deadline: eom,
    p: 0.31,
    tags: ["DEX", "Volume", "DefiLlama"],
    why: "Twenty billion a week is the level that separates a retail venue from an institutional one, and it has only printed twice this year.",
    resolution: `YES if the combined weekly DEX volume of Base and Solana, per DefiLlama, exceeds $20,000,000,000 in any seven-day window ending before ${day(eom)} 23:59 UTC.`,
    source: "DefiLlama DEX volume",
  });
  ed({
    lane: D,
    title: `Will any lending protocol on Base cross $1B in TVL before ${label(eom)}?`,
    deadline: eom,
    p: 0.28,
    tags: ["Base", "Lending", "TVL"],
    why: "Base has the deposits but not yet a single billion-dollar lending market; the gap between those two facts is the whole DeFi opportunity on the chain.",
    resolution: "YES if any lending protocol deployed on Base reports TVL at or above $1,000,000,000 on DefiLlama before the deadline.",
    source: "DefiLlama protocols",
  });

  /* ══ 3. AI & Web3 Tech — model releases and the megacaps ══════════════════ */
  priceMarket({ sym: "NVDA", lane: ST, pct: 0.02, h: H.h24 });
  priceMarket({ sym: "NVDA", lane: ST, pct: 0.05, h: H.d7 });
  priceMarket({ sym: "NVDA", lane: ST, pct: -0.05, h: H.d7 });
  priceMarket({ sym: "NVDA", lane: ST, pct: 0.1, h: H.eom });
  priceMarket({ sym: "AAPL", lane: ST, pct: 0.04, h: H.eom });
  priceMarket({ sym: "AAPL", lane: ST, pct: -0.04, h: H.d7 });
  priceMarket({ sym: "MSFT", lane: ST, pct: 0.03, h: H.eom });
  priceMarket({ sym: "GOOGL", lane: ST, pct: -0.04, h: H.d3 });
  priceMarket({ sym: "TSLA", lane: ST, pct: 0.08, h: H.d7 });
  priceMarket({ sym: "TSLA", lane: ST, pct: -0.06, h: H.d7 });
  priceMarket({ sym: "AMD", lane: ST, pct: 0.1, h: H.eom });
  priceMarket({ sym: "META", lane: ST, pct: -0.05, h: H.d7 });
  priceMarket({ sym: "AMD", lane: ST, pct: -0.08, h: H.d3 });

  ed({
    lane: T,
    title: `Will a major lab ship a model with a 2M-token context window before ${label(eom)}?`,
    deadline: eom,
    p: 0.41,
    tags: ["Models", "Context", "Frontier labs"],
    why: "Context length stopped being a marketing number the moment agent frameworks started depending on it. A public 2M window changes what can be built, not just what can be demoed.",
    resolution: "YES if a frontier lab makes a 2M-token (or larger) context window generally available through a documented API before the deadline. Waitlists and private previews resolve NO.",
    source: "Provider API documentation",
  });
  ed({
    lane: T,
    title: `Will OpenAI or Anthropic announce a new frontier model before ${label(eom)}?`,
    deadline: eom,
    p: 0.55,
    tags: ["OpenAI", "Anthropic", "Release"],
    why: "The release cadence of the two leading labs is the single input every AI-token market on this board is priced off. One launch resets all of them.",
    resolution: "YES if either OpenAI or Anthropic publishes a model it describes as its frontier or flagship, generally available through its API, before the deadline.",
    source: "OpenAI / Anthropic release notes",
  });
  ed({
    lane: T,
    title: `Will an autonomous agent complete a paid on-chain task end-to-end before ${label(eom)}?`,
    deadline: eom,
    p: 0.37,
    tags: ["Agents", "x402", "Onchain"],
    why: "Agent payments moved from demo to protocol in the last year. What is still missing is evidence of a job priced, delivered and accepted with no human in the loop.",
    resolution: "YES if an autonomous agent is paid in stablecoins on Base for a task that a buyer accepts without human edit, with the settlement visible on-chain, before the deadline.",
    source: "On-chain settlement + public writeup",
  });
  ed({
    lane: T,
    title: `Will AI-agent on-chain transaction volume exceed $1B in a single month before ${label(eoq)}?`,
    deadline: eoq,
    p: 0.33,
    tags: ["Agents", "Volume", "x402"],
    why: "Agent volume is the number that would prove the x402 thesis; today it is a rounding error on every chain that reports it.",
    resolution: "YES if any public dashboard attributes $1B or more of monthly on-chain transaction volume to autonomous agents (x402 or equivalent) before the deadline.",
    source: "x402 dashboard / Dune",
  });
  ed({
    lane: T,
    title: `Will inference prices for a frontier-class model fall another 30% before ${label(eom)}?`,
    deadline: eom,
    p: 0.44,
    tags: ["Inference", "Pricing"],
    why: "Per-token prices have fallen faster than any comparable software metric. The question is whether margin compression finally flattens the curve.",
    resolution: "YES if the published list price, per million output tokens, of any frontier-class model falls 30% or more versus its price on the first day of the window.",
    source: "Provider pricing pages",
  });
  ed({
    lane: T,
    title: `Will a zero-knowledge proof of an LLM inference be verified on a public chain before ${label(eom)}?`,
    deadline: eom,
    p: 0.22,
    tags: ["ZKML", "Verification", "Research"],
    why: "Verifiable inference is the missing primitive for on-chain agents: without it, an agent's work is an assertion rather than a proof.",
    resolution: "YES if a proof covering a full LLM inference step is verified by a deployed verifier contract on any public chain before the deadline, with the transaction publicly inspectable.",
    source: "Block explorer + verifier contract",
  });
  ed({
    lane: T,
    title: `Will any AI-agent framework exceed 100k monthly active developers before ${label(eoq)}?`,
    deadline: eoq,
    p: 0.3,
    tags: ["Developers", "Adoption"],
    why: "Developer counts are the leading indicator that survives a funding cycle. 100k monthly actives separates a framework from a demo.",
    resolution: "YES if a public package registry or the maintainer publishes a figure of 100,000+ monthly active developers for an agent framework before the deadline.",
    source: "Package registry download/usage stats",
  });
  ed({
    lane: T,
    title: `Will a US hyperscaler disclose AI capex above $50B for the quarter before ${label(eoq)}?`,
    deadline: eoq,
    p: 0.47,
    tags: ["Capex", "Hyperscalers", "Earnings"],
    why: "Capex guidance is the only AI number that reaches a cash-flow statement. Fifty billion a quarter is where the trade stops being a story and becomes a depreciation schedule.",
    resolution: "YES if Microsoft, Alphabet, Amazon or Meta reports quarterly capital expenditure above $50B in an earnings release before the deadline.",
    source: "Company earnings releases",
  });

  /* ══ 4. Memes & Culture ══════════════════════════════════════════════════ */
  priceMarket({ sym: "DEGEN", lane: M, pct: 0.15, h: H.h24, tags: ["Base", "Culture"] });
  priceMarket({ sym: "BRETT", lane: M, pct: 0.12, h: H.h24, tags: ["Base", "Meme"] });
  priceMarket({ sym: "TOSHI", lane: M, pct: 0.2, h: H.h24, tags: ["Base", "Meme"] });
  priceMarket({ sym: "MOG", lane: M, pct: 0.25, h: H.d3, tags: ["Meme"] });
  priceMarket({ sym: "ZORA", lane: M, pct: 0.15, h: H.d3, tags: ["Creators"] });
  priceMarket({ sym: "PEPE", lane: M, pct: 0.1, h: H.d7, tags: ["Meme"] });
  priceMarket({ sym: "WIF", lane: M, pct: 0.15, h: H.d7, tags: ["Solana", "Meme"] });
  priceMarket({ sym: "DOGE", lane: M, pct: 0.08, h: H.d7, tags: ["Meme"] });
  priceMarket({ sym: "DEGEN", lane: M, pct: 0.4, h: H.eom, tags: ["Base", "Culture"] });
  priceMarket({ sym: "BRETT", lane: M, pct: 0.35, h: H.eom, tags: ["Base", "Meme"] });
  priceMarket({ sym: "TOSHI", lane: M, pct: 0.5, h: H.eom, tags: ["Base", "Meme"] });
  priceMarket({ sym: "MOG", lane: M, pct: -0.25, h: H.eom, tags: ["Meme", "Downside"] });
  priceMarket({ sym: "ZORA", lane: M, pct: -0.2, h: H.d7, tags: ["Creators", "Downside"] });

  ed({
    lane: M,
    title: `Will a Base-native meme token enter the top 200 by market cap before ${label(eom)}?`,
    deadline: eom,
    p: 0.26,
    tags: ["Base", "Market cap", "CoinGecko"],
    why: "Base has produced culture tokens with real volume but no sustained top-200 entrant. The threshold is the difference between a rotation and a narrative.",
    resolution: "YES if any token launched on Base appears in CoinGecko's top 200 by market capitalisation on any day before the deadline.",
    source: "CoinGecko market cap ranking",
  });
  ed({
    lane: M,
    title: `Will a creator-led token out-earn a top-20 protocol token in fees this month?`,
    deadline: eom,
    p: 0.18,
    tags: ["Creators", "Fees", "Culture"],
    why: "Attention is now cheaper to acquire than shelf space. This market asks whether that shows up in actual fee revenue rather than cultural chatter.",
    resolution: "YES if a creator-issued token reports higher 30-day protocol fees than the 20th-ranked protocol by fees on DefiLlama for the same window.",
    source: "DefiLlama fees",
  });
  ed({
    lane: M,
    title: `Will a memecoin launched on Base reach a $100M market cap within seven days of launch before ${label(eom)}?`,
    deadline: eom,
    p: 0.24,
    tags: ["Base", "Launch", "Market cap"],
    why: "A hundred million inside a week is the level that turns a launch into a liquidity event the rest of the chain can trade against.",
    resolution: "YES if any token launched on Base reaches a reported market capitalisation of $100M or more within seven days of its first trade before the deadline, per CoinGecko or DEX Screener.",
    source: "CoinGecko / DEX Screener",
  });
  ed({
    lane: M,
    title: `Will a top-10 crypto Twitter account be suspended over a paid promotion before ${label(eom)}?`,
    deadline: eom,
    p: 0.29,
    tags: ["CT", "KOL", "Drama"],
    why: "Paid shilling without disclosure is now the most-reported content violation in crypto social. Enforcement, when it lands, is public and permanent.",
    resolution: "YES if an account ranked in the top 10 by followers on a public crypto-Twitter leaderboard is suspended (not restricted) for undisclosed paid promotion before the deadline, per the platform's own notice or a screenshot of the suspension.",
    source: "Platform suspension notices",
  });
  ed({
    lane: M,
    title: `Will any KOL-backed token announced this month trade below its launch price after 30 days?`,
    deadline: addDaysUTC(now, 30),
    p: 0.68,
    tags: ["KOL", "Launches", "Base"],
    why: "The base rate for influencer-launched tokens is brutal and publicly checkable; the market usually prices the exception instead of the base rate.",
    resolution: "YES if any token publicly promoted at launch by an account with 100k+ followers trades below its first-day close 30 days later, per CoinGecko daily closes.",
    source: "CoinGecko daily closes",
  });

  /* ══ 5. Sports & Esports ═════════════════════════════════════════════════ */
  ed({
    lane: S,
    title: `Will this weekend's Premier League round produce 30 or more goals?`,
    deadline: sunday,
    p: 0.46,
    tags: ["Football", "Premier League", `matchday ${day(sunday)}`],
    why: "Goal totals are the least narrative-driven number in football: either the round was open or it was not.",
    resolution: `YES if the ten matches scheduled in the Premier League round ending ${day(sunday)} produce 30 or more goals in total, per the league's official results.`,
    source: "Premier League official results",
  });
  ed({
    lane: S,
    title: `Will any Premier League side win by four goals or more this weekend?`,
    deadline: sunday,
    p: 0.33,
    tags: ["Football", "Premier League", "Margins"],
    why: "Blowouts are a fixture of the modern pressing game and a reliable tail event to price against a public that remembers 1-0s.",
    resolution: `YES if any match in the Premier League round ending ${day(sunday)} finishes with a margin of four goals or more.`,
    source: "Premier League official results",
  });
  ed({
    lane: S,
    title: `Will the Champions League matchday produce a 4-goal comeback from a losing position?`,
    deadline: addDaysUTC(now, 14),
    p: 0.21,
    tags: ["Football", "UCL", "Matchday"],
    why: "Comebacks are the tail event that keeps the competition priced: rare enough to be a genuine surprise, common enough to be mispriced.",
    resolution: "YES if any team wins a Champions League match after trailing by two or more goals, within the next two matchdays.",
    source: "UEFA official match reports",
  });
  ed({
    lane: S,
    title: `Will a Champions League matchday pass end with more than 30 goals across all fixtures?`,
    deadline: addDaysUTC(now, 7),
    p: 0.39,
    tags: ["Football", "UCL", "Goals"],
    why: "Two matchdays of the new format produce more goals than the old group stage ever did; thirty is the level the market still underrates.",
    resolution: "YES if the total goals scored across all fixtures of a single Champions League matchday before the deadline exceed 30.",
    source: "UEFA official match reports",
  });
  ed({
    lane: S,
    title: `Will any Champions League fixture produce a hat-trick before ${label(eom)}?`,
    deadline: eom,
    p: 0.41,
    tags: ["Football", "UCL", "Hat-trick"],
    why: "With more fixtures per matchday, hat-tricks print more often than the competition's reputation suggests.",
    resolution: "YES if any player scores three or more goals in a single Champions League match before the deadline.",
    source: "UEFA official match reports",
  });
  ed({
    lane: S,
    title: `Will the NBA's highest-scoring game this month break 150 points in regulation?`,
    deadline: eom,
    p: 0.29,
    tags: ["Basketball", "NBA", "Scoring"],
    why: "Pace and spacing have pushed scoring distributions up for a decade; 150 in regulation is still the edge of the tail.",
    resolution: "YES if any NBA team scores 150 or more points in regulation (overtime excluded) before the deadline.",
    source: "NBA official box scores",
  });
  ed({
    lane: S,
    title: `Will any NBA quarter this week be won by 20 points or more?`,
    deadline: addDaysUTC(now, 7),
    p: 0.57,
    tags: ["Basketball", "NBA", "Quarters"],
    why: "A 20-point quarter is a rotation collapse, not a talent gap, which is why it happens more often than the spread implies.",
    resolution: "YES if any NBA team outscores its opponent by 20 or more points in a single quarter before the deadline.",
    source: "NBA official box scores",
  });
  ed({
    lane: S,
    title: `Will an NBA game this week be decided by a buzzer-beater?`,
    deadline: addDaysUTC(now, 7),
    p: 0.22,
    tags: ["Basketball", "NBA", "Clutch"],
    why: "The buzzer-beater is the most-clipped moment in the sport and the least frequent; a week-long window is the honest way to price it.",
    resolution: "YES if any NBA game before the deadline is decided by a made field goal in the final two seconds of the fourth quarter or overtime.",
    source: "NBA official play-by-play",
  });
  ed({
    lane: S,
    title: `Will any NFL game this Sunday go to overtime?`,
    deadline: sunday,
    p: 0.42,
    tags: ["NFL", "Overtime", "Sunday"],
    why: "Overtime is the cleanest coin-flip in sports and a natural weekly market: roughly one in twelve games, and the public always overrates the favourite.",
    resolution: `YES if any NFL game played on ${day(sunday)} (US) is tied at the end of regulation.`,
    source: "NFL official gamebook",
  });
  ed({
    lane: S,
    title: `Will any F1 race this month be decided by under one second?`,
    deadline: eom,
    p: 0.33,
    tags: ["Motorsport", "F1", "Margins"],
    why: "Winning margins are the physical measure of how close the field actually is, independent of the championship narrative.",
    resolution: "YES if any Formula 1 race held before the deadline has an official winning margin below 1.000 seconds.",
    source: "FIA official classification",
  });
  ed({
    lane: S,
    title: `Will a driver outside the top three constructors take a podium this month?`,
    deadline: eom,
    p: 0.28,
    tags: ["Motorsport", "F1", "Podium"],
    why: "Regulation-era F1 has compressed the midfield far more than the championship table admits; a stray podium is the visible symptom.",
    resolution: "YES if any driver whose constructor finished the previous season outside the top three takes a top-three finish in a race before the deadline.",
    source: "FIA official classification",
  });
  ed({
    lane: S,
    title: `Will an esports grand final go to a deciding map this month?`,
    deadline: eom,
    p: 0.52,
    tags: ["Esports", "Finals", "Best-of-five"],
    why: "Best-of-five finals resolve to a decider more often than the market usually prices, because seeding and patch changes compress the skill gap.",
    resolution: "YES if any Tier-1 esports grand final (CS2, LoL, Dota 2, Valorant) played before the deadline reaches its final map.",
    source: "Tournament organiser results",
  });
  ed({
    lane: S,
    title: `Will a reverse sweep happen in a Tier-1 esports playoff series before ${label(eom)}?`,
    deadline: eom,
    p: 0.31,
    tags: ["Esports", "Playoffs", "Reverse sweep"],
    why: "A reverse sweep is the purest evidence that the format, not the seeding, decides best-of series.",
    resolution: "YES if any Tier-1 esports playoff series before the deadline is won by a team that trailed 0-2 (or 0-1 in a best-of-three).",
    source: "Tournament organiser results",
  });
  ed({
    lane: S,
    title: `Will the ATP Finals final go to a fifth set this year?`,
    deadline: addDaysUTC(now, 21),
    p: 0.34,
    tags: ["Tennis", "ATP Finals", "Sets"],
    why: "The year-end final is played on a fast indoor court where serving dominates, which historically pushes the length distribution both ways.",
    resolution: "YES if the ATP Finals singles final is decided in five sets.",
    source: "ATP official results",
  });
  ed({
    lane: S,
    title: `Will a top-four seed lose in the group stage of the ATP Finals?`,
    deadline: addDaysUTC(now, 14),
    p: 0.55,
    tags: ["Tennis", "ATP Finals", "Seeds"],
    why: "Round-robin format with eight players guarantees upsets that a knockout draw would hide; the market keeps pricing seeds as if it were a bracket.",
    resolution: "YES if any of the top four seeds loses a round-robin match at the ATP Finals before the deadline.",
    source: "ATP official results",
  });
  ed({
    lane: S,
    title: `Will any MLB team hit three or more home runs in an inning before ${label(eom)}?`,
    deadline: eom,
    p: 0.37,
    tags: ["Baseball", "MLB", "Home runs"],
    why: "A three-homer inning is the most violent thing that happens in a regular-season game and the market prices it like a novelty.",
    resolution: "YES if any MLB team hits three or more home runs in a single inning before the deadline.",
    source: "MLB official box scores",
  });

  /* ══ 6. Politics & Policy ════════════════════════════════════════════════ */
  ed({
    lane: P,
    title: `Will the US Senate pass a comprehensive crypto market-structure bill before ${label(eom)}?`,
    deadline: eom,
    p: 0.23,
    tags: ["US", "Legislation", "Market structure"],
    why: "Market-structure legislation has cleared one chamber and stalled in the other twice. The question is procedural: floor time, not intent.",
    resolution: "YES if the US Senate passes a comprehensive digital-asset market-structure bill before the deadline, per congress.gov. Committee approval alone resolves NO.",
    source: "congress.gov",
  });
  ed({
    lane: GP,
    title: `Will a G20 regulator issue final stablecoin rules naming reserve composition before ${label(eom)}?`,
    deadline: eom,
    p: 0.31,
    tags: ["Stablecoins", "Regulation", "G20"],
    why: "Reserve composition is the clause that decides whether a stablecoin is a payment rail or a shadow fund. Drafts without it do not count.",
    resolution: "YES if a G20 member's financial regulator publishes final (not draft) stablecoin rules that specify permitted reserve assets before the deadline.",
    source: "Regulator official publications",
  });
  ed({
    lane: GP,
    title: `Will the EU open an infringement procedure against a member state over MiCA implementation before ${label(eom)}?`,
    deadline: eom,
    p: 0.19,
    tags: ["EU", "MiCA", "Enforcement"],
    why: "MiCA's deadlines have passed and national transposition is uneven; enforcement is where that unevenness becomes visible.",
    resolution: "YES if the European Commission opens a formal infringement procedure citing MiCA transposition before the deadline, per an official Commission decision.",
    source: "European Commission infringement register",
  });
  ed({
    lane: GP,
    title: `Will any major jurisdiction grant a spot crypto ETF listing approval before ${label(eom)}?`,
    deadline: eom,
    p: 0.27,
    tags: ["ETF", "Approval", "Global"],
    why: "Approval is a process: consultation, delegated act, listing. This market prices whether the last step lands inside the window.",
    resolution: "YES if a national securities regulator in the EU, UK, Japan or Korea grants an effective listing approval for a spot crypto ETF before the deadline. Consultation papers resolve NO.",
    source: "Regulator approval notices",
  });
  ed({
    lane: P,
    title: `Will the SEC drop or settle its enforcement case against a major crypto exchange before ${label(eom)}?`,
    deadline: eom,
    p: 0.42,
    tags: ["SEC", "Enforcement", "Exchanges"],
    why: "Cases that outlive their political moment get settled, not won. The question is whether the docket clears inside the month.",
    resolution: "YES if the SEC files a dismissal or an agreed settlement ending a case against Coinbase, Binance or Kraken before the deadline, per the court docket.",
    source: "Court dockets (PACER)",
  });
  ed({
    lane: P,
    title: `Will any G7 country launch a retail CBDC pilot before ${label(eoq)}?`,
    deadline: eoq,
    p: 0.17,
    tags: ["CBDC", "G7", "Pilot"],
    why: "Every G7 treasury has a paper; almost none has a pilot that a citizen can use. The gap between the two is the trade.",
    resolution: "YES if a G7 member's central bank runs a pilot in which members of the public can hold and spend a CBDC before the deadline.",
    source: "Central bank announcements",
  });
  ed({
    lane: P,
    title: `Will a US state enact a strategic Bitcoin reserve law before ${label(eoq)}?`,
    deadline: eoq,
    p: 0.21,
    tags: ["US", "States", "Bitcoin reserve"],
    why: "Twenty-odd states have introduced reserve bills; enactment is a treasury-committee problem, not a campaign promise.",
    resolution: "YES if any US state enacts legislation authorising it to hold Bitcoin on its balance sheet before the deadline.",
    source: "State legislature records",
  });
  ed({
    lane: GP,
    title: `Will the UK FCA authorise a crypto derivatives venue for retail clients before ${label(eoq)}?`,
    deadline: eoq,
    p: 0.18,
    tags: ["UK", "FCA", "Derivatives"],
    why: "The UK banned retail crypto derivatives in 2021 and has been building the regulated alternative ever since. Authorisation is the last step.",
    resolution: "YES if the FCA grants a UK-authorised firm permission to offer crypto derivatives to retail clients before the deadline.",
    source: "FCA register",
  });
  ed({
    lane: GP,
    title: `Will the FATF add a jurisdiction to its grey list citing virtual-asset supervision before ${label(eoq)}?`,
    deadline: eoq,
    p: 0.29,
    tags: ["FATF", "AML", "Grey list"],
    why: "Travel-rule enforcement is where crypto policy actually bites, and the grey list is the only public scoreboard.",
    resolution: "YES if the FATF adds a jurisdiction to its grey list with virtual-asset supervision named among the strategic deficiencies before the deadline.",
    source: "FATF public statements",
  });
  ed({
    lane: P,
    title: `Will Congress pass a stablecoin yield ban before ${label(eoq)}?`,
    deadline: eoq,
    p: 0.22,
    tags: ["US", "Stablecoins", "Yield"],
    why: "Paying yield on a payment stablecoin is the one clause banks and crypto both lobby hard on — it decides whether deposits leave the banking system.",
    resolution: "YES if US federal legislation prohibiting stablecoin issuers from paying yield to holders is enacted before the deadline.",
    source: "congress.gov",
  });
  ed({
    lane: P,
    title: `Will any jurisdiction require stablecoin issuers to hold 100% reserves in short-term Treasuries before ${label(eoq)}?`,
    deadline: eoq,
    p: 0.24,
    tags: ["Stablecoins", "Reserves", "Treasuries"],
    why: "Treasury-only reserves turn a stablecoin into a money-market fund with a wallet. It is the strictest version of the rule still on the table.",
    resolution: "YES if a national regulator or legislator enacts a rule limiting stablecoin reserves to instruments of one year or less before the deadline.",
    source: "Regulator publications",
  });
  ed({
    lane: P,
    title: `Will the CFTC be granted statutory authority over spot crypto markets before ${label(eoq)}?`,
    deadline: eoq,
    p: 0.26,
    tags: ["CFTC", "Jurisdiction", "US"],
    why: "Which regulator owns spot is the precondition for every other crypto rule in the US; nothing else can be final until it is settled.",
    resolution: "YES if US legislation granting the CFTC explicit authority over spot digital-asset markets is enacted before the deadline.",
    source: "congress.gov",
  });
  ed({
    lane: GP,
    title: `Will India reduce its crypto trading tax before ${label(eoq)}?`,
    deadline: eoq,
    p: 0.15,
    tags: ["India", "Tax", "Policy"],
    why: "India's 30% flat tax plus 1% transaction levy moved volume offshore; a cut is the only policy that would bring it back.",
    resolution: "YES if India's Union Budget or a finance ministry notification reduces the tax on virtual digital asset transfers before the deadline.",
    source: "India Union Budget documents",
  });

  /* ══ 7. Base Ecosystem ═══════════════════════════════════════════════════ */
  if (baseTvl) {
    const target = Math.round((baseTvl * 0.95) / 1e8) * 1e8;
    ed({
      lane: B,
      title: `Will Base TVL hold above ${fmtBig(target)} through ${label(eom)}?`,
      deadline: eom,
      p: clamp(0.62 - (1 - target / baseTvl) * 2.2, 0.15, 0.9),
      tags: ["Base", "TVL", `now ${fmtBig(baseTvl)}`, "DefiLlama"],
      why: "A 5% drawdown is one bad week in a risk-off tape. Holding the level through month-end is a statement about Base's deposit base rather than its price.",
      resolution: `YES if DefiLlama's Base chain TVL stays at or above ${fmtBig(target)} on every UTC day through ${day(eom)} 23:59 UTC.`,
      source: "DefiLlama /v2/chains",
    });
    const stretch = Math.round((baseTvl * 1.2) / 1e8) * 1e8;
    ed({
      lane: B,
      title: `Will Base TVL cross ${fmtBig(stretch)} before ${label(eoq)}?`,
      deadline: eoq,
      p: clamp(0.34 - (stretch / baseTvl - 1) * 1.4, 0.06, 0.6),
      tags: ["Base", "TVL", `now ${fmtBig(baseTvl)}`, "Stretch"],
      why: `A 20% expansion in a quarter is what "Base is winning" looks like as a number instead of a claim. Today it sits at ${fmtBig(baseTvl)}.`,
      resolution: `YES if DefiLlama's Base chain TVL prints at or above ${fmtBig(stretch)} on any UTC day before ${day(eoq)} 23:59 UTC.`,
      source: "DefiLlama /v2/chains",
    });
  }
  priceMarket({ sym: "AERO", lane: B, pct: 0.08, h: H.eom, tags: ["Aerodrome"] });
  priceMarket({ sym: "AERO", lane: B, pct: 0.25, h: H.d7, tags: ["Aerodrome", "Stretch"] });
  priceMarket({ sym: "DEGEN", lane: B, pct: 0.12, h: H.eom, tags: ["Culture"] });
  priceMarket({ sym: "ZORA", lane: B, pct: 0.3, h: H.eom, tags: ["Creators"] });
  ed({
    lane: B,
    title: `Will Base process more daily transactions than Ethereum every day for a week before ${label(eom)}?`,
    deadline: eom,
    p: 0.71,
    tags: ["Base", "Ethereum", "Throughput"],
    why: "Base already runs an order of magnitude more transactions than L1 Ethereum on most days. The interesting question is whether it holds through a quiet week.",
    resolution: `YES if Base's daily transaction count exceeds Ethereum L1's on every day of the final week before ${day(eom)}, per L2Beat and Etherscan.`,
    source: "L2Beat + Etherscan",
  });
  ed({
    lane: B,
    title: `Will Base settle more than 10M transactions in a single day before ${label(eom)}?`,
    deadline: eom,
    p: 0.38,
    tags: ["Base", "Throughput", "10M"],
    why: "Ten million daily transactions is the level where an L2 stops being a sidechain experiment and starts being infrastructure.",
    resolution: `YES if Base's daily transaction count prints at or above 10,000,000 on any UTC day before ${day(eom)} 23:59 UTC.`,
    source: "L2Beat activity",
  });
  ed({
    lane: B,
    title: `Will a Base-native app cross 1M daily active addresses before ${label(eom)}?`,
    deadline: eom,
    p: 0.24,
    tags: ["Base", "DAU", "Growth"],
    why: "Daily actives are the metric that survives incentive programs ending. One app at a million addresses would be a first for the chain.",
    resolution: "YES if any app deployed on Base reports 1,000,000+ daily active addresses on a single day before the deadline, corroborated by on-chain unique senders.",
    source: "On-chain unique senders",
  });
  ed({
    lane: B,
    title: `Will Base sequencer revenue exceed $1M in a single week before ${label(eom)}?`,
    deadline: eom,
    p: 0.35,
    tags: ["Base", "Revenue", "Sequencer"],
    why: "Sequencer revenue is the only number that says an L2 is a business rather than a subsidy. A million-dollar week is the threshold.",
    resolution: "YES if Base's published sequencer revenue exceeds $1,000,000 in any seven-day window ending before the deadline.",
    source: "Base / L2Beat revenue dashboard",
  });
  ed({
    lane: B,
    title: `Will Base sequencer revenue exceed Ethereum L1 fees in a single week before ${label(eoq)}?`,
    deadline: eoq,
    p: 0.19,
    tags: ["Base", "Ethereum", "Revenue"],
    why: "The flip would be the clearest possible statement that execution has moved off the L1 — and it is still a tail event, which is what makes the price interesting.",
    resolution: "YES if Base's weekly sequencer revenue, per L2Beat, is higher than Ethereum L1's weekly fees in the same window before the deadline.",
    source: "L2Beat revenue",
  });
  ed({
    lane: B,
    title: `Will Base host a top-10 DEX by weekly volume before ${label(eom)}?`,
    deadline: eom,
    p: 0.44,
    tags: ["Base", "DEX", "Volume"],
    why: "Aerodrome already trades like a top-tier venue on some days; a full week inside the global top ten is the durable version of that claim.",
    resolution: "YES if any DEX deployed on Base ranks in the top ten by weekly volume on DefiLlama before the deadline.",
    source: "DefiLlama DEX volume",
  });
  ed({
    lane: B,
    title: `Will Base median gas fees stay under $0.01 for a full week before ${label(eom)}?`,
    deadline: addDaysUTC(now, 14),
    p: 0.66,
    tags: ["Base", "Gas", "Fees"],
    why: "Base batching made sub-cent fees the default and then blobs made them cheap again. A full week under a cent is the honest read on capacity.",
    resolution: "YES if the median Base transaction fee stays below $0.01 for seven consecutive days before the deadline, per L2Beat or growthepie.",
    source: "L2Beat fees",
  });
  ed({
    lane: B,
    title: `Will a Base-native token be listed by a top-five centralized exchange before ${label(eoq)}?`,
    deadline: eoq,
    p: 0.32,
    tags: ["Base", "Listings", "CEX"],
    why: "A Binance or Coinbase listing is the single largest liquidity event available to a Base token, and it is announced, not leaked.",
    resolution: "YES if Binance, Coinbase, OKX, Bybit or Upbit lists a token launched on Base (other than USDC) before the deadline.",
    source: "Exchange announcement pages",
  });

  /* ══ 8. Macro & Economy — FRED-struck, no invented levels ════════════════ */
  const m = macro;
  if (m.FED_UPPER) {
    const nowRate = m.FED_UPPER.value;
    const cutTarget = Number((nowRate - 0.25).toFixed(2));
    ed({
      lane: E,
      title: `Will the Fed's target range be at or below ${cutTarget.toFixed(2)}% before ${label(eoq)}?`,
      deadline: eoq,
      p: 0.46,
      tags: ["Fed", "FOMC", `now ${nowRate.toFixed(2)}%`, "FRED"],
      why: `The upper bound of the target range is ${nowRate.toFixed(2)}% today (FRED DFEDTARU). A single 25bp cut inside the quarter is the question every risk asset on this board is priced against.`,
      resolution: `YES if FRED series DFEDTARU prints at or below ${cutTarget.toFixed(2)}% on any day before ${day(eoq)} 23:59 UTC.`,
      source: "FRED DFEDTARU",
    });
    ed({
      lane: E,
      title: `Will the Fed leave its target range unchanged at ${nowRate.toFixed(2)}% through ${label(eoq)}?`,
      deadline: eoq,
      p: 0.34,
      tags: ["Fed", "Hold", `now ${nowRate.toFixed(2)}%`, "FRED"],
      why: "A hold is the least dramatic outcome and the one the market keeps underpricing in a cutting cycle. It resolves on the published range, not on the press conference.",
      resolution: `YES if FRED series DFEDTARU stays at ${nowRate.toFixed(2)}% on every day through ${day(eoq)} 23:59 UTC.`,
      source: "FRED DFEDTARU",
    });
    ed({
      lane: E,
      title: `Will the Fed cut by 50bp or more in a single move before ${label(eoq)}?`,
      deadline: eoq,
      p: 0.13,
      tags: ["Fed", "Emergency", "50bp"],
      why: "Fifty-basis-point moves happen when something is breaking, not when the data is merely soft. The market always prices the possibility too cheaply and the event too rarely.",
      resolution: `YES if FRED DFEDTARU falls by 0.50 percentage points or more between two consecutive daily observations before ${day(eoq)} 23:59 UTC.`,
      source: "FRED DFEDTARU",
    });
  }
  if (m.CPI_YOY) {
    const cpi = m.CPI_YOY.value;
    const hot = Number((cpi + 0.1).toFixed(2));
    const cool = m.CPI_YOY.prev ?? Number((cpi - 0.2).toFixed(2));
    ed({
      lane: E,
      title: `Will US CPI YoY print above ${hot.toFixed(2)}% in the next release?`,
      deadline: addDaysUTC(now, 30),
      p: 0.47,
      tags: ["CPI", "Inflation", `last ${cpi.toFixed(2)}%`],
      why: `The last print was ${cpi.toFixed(2)}% YoY (FRED CPIAUCSL, ${m.CPI_YOY.asOf}). A hotter number is the single fastest way to reprice the whole rate path.`,
      resolution: `YES if the next US CPI release published before the deadline reports headline CPI year-over-year above ${hot.toFixed(2)}%, per the BLS release.`,
      source: "BLS CPI (FRED CPIAUCSL)",
    });
    ed({
      lane: E,
      title: `Will US CPI YoY cool to ${Number(cool).toFixed(2)}% or below in the next release?`,
      deadline: addDaysUTC(now, 30),
      p: 0.34,
      tags: ["CPI", "Disinflation", `prev ${Number(cool).toFixed(2)}%`],
      why: `Disinflation has stalled for two prints; a return to the prior pace (${Number(cool).toFixed(2)}%) is what a soft landing looks like in one number.`,
      resolution: `YES if the next US CPI release published before the deadline reports headline CPI year-over-year at or below ${Number(cool).toFixed(2)}%.`,
      source: "BLS CPI (FRED CPIAUCSL)",
    });
  }
  if (m.CORE_CPI_YOY) {
    const core = m.CORE_CPI_YOY.value;
    ed({
      lane: E,
      title: `Will core CPI YoY stay above ${core.toFixed(2)}% in the next release?`,
      deadline: addDaysUTC(now, 30),
      p: 0.5,
      tags: ["Core CPI", `last ${core.toFixed(2)}%`, "FRED"],
      why: `Core inflation is the number the Fed actually reacts to, and at ${core.toFixed(2)}% it is still above target. Stickiness is the base case until it isn't.`,
      resolution: `YES if the next US CPI release reports core CPI year-over-year above ${core.toFixed(2)}%.`,
      source: "BLS core CPI (FRED CPILFESL)",
    });
  }
  if (m.US10Y) {
    const y = m.US10Y.value;
    const down = Number((y - 0.1).toFixed(2));
    const up = Number((y + 0.2).toFixed(2));
    ed({
      lane: E,
      title: `Will the 10-year Treasury yield close below ${down.toFixed(2)}% before ${label(eom)}?`,
      deadline: eom,
      p: 0.33,
      tags: ["Rates", "US10Y", `now ${y.toFixed(2)}%`, "FRED"],
      why: `The 10-year sits at ${y.toFixed(2)}% (FRED DGS10, ${m.US10Y.asOf}). Long-end yields set the discount rate for every risk asset in this protocol's universe.`,
      resolution: `YES if FRED DGS10 prints below ${down.toFixed(2)}% on any trading day before ${day(eom)} 23:59 UTC.`,
      source: "FRED DGS10",
    });
    ed({
      lane: E,
      title: `Will the 10-year Treasury yield close above ${up.toFixed(2)}% before ${label(eoq)}?`,
      deadline: eoq,
      p: 0.36,
      tags: ["Rates", "US10Y", `now ${y.toFixed(2)}%`, "FRED"],
      why: "A 20bp backup in the long end is what an inflation scare looks like before the Fed says anything. It is also the level that breaks the equity multiple.",
      resolution: `YES if FRED DGS10 prints above ${up.toFixed(2)}% on any trading day before ${day(eoq)} 23:59 UTC.`,
      source: "FRED DGS10",
    });
  }
  if (m.CURVE_2S10S) {
    const c = m.CURVE_2S10S.value;
    ed({
      lane: E,
      title: `Will the 2s10s curve re-invert below 0% before ${label(eoq)}?`,
      deadline: eoq,
      p: 0.24,
      tags: ["Curve", `now ${c.toFixed(2)}pp`, "FRED"],
      why: `The 2s10s spread is ${c.toFixed(2)}pp today (FRED T10Y2Y). A re-inversion would say the market is pricing cuts as a growth problem rather than a victory.`,
      resolution: `YES if FRED T10Y2Y prints below 0.00 on any trading day before ${day(eoq)} 23:59 UTC.`,
      source: "FRED T10Y2Y",
    });
  }
  if (m.UNRATE) {
    const u = m.UNRATE.value;
    ed({
      lane: E,
      title: `Will US unemployment print above ${(u + 0.1).toFixed(1)}% in the next report?`,
      deadline: addDaysUTC(now, 30),
      p: 0.4,
      tags: ["Unemployment", `now ${u.toFixed(1)}%`, "FRED"],
      why: `Unemployment is ${u.toFixed(1)}% (FRED UNRATE, ${m.UNRATE.asOf}). One tenth higher is the threshold where the Fed's "labour market is solid" line stops working.`,
      resolution: `YES if the next US employment situation report shows an unemployment rate above ${(u + 0.1).toFixed(1)}%.`,
      source: "BLS employment situation (FRED UNRATE)",
    });
  }
  if (m.MORTGAGE30) {
    const mtg = m.MORTGAGE30.value;
    ed({
      lane: E,
      title: `Will the 30-year mortgage rate fall below ${(mtg - 0.2).toFixed(2)}% before ${label(eom)}?`,
      deadline: eom,
      p: 0.3,
      tags: ["Mortgage", `now ${mtg.toFixed(2)}%`, "FRED"],
      why: "Mortgage rates are the transmission channel from the 10-year to the housing market, and they move with a lag the market keeps forgetting.",
      resolution: `YES if FRED MORTGAGE30US prints below ${(mtg - 0.2).toFixed(2)}% on any week before ${day(eom)} 23:59 UTC.`,
      source: "FRED MORTGAGE30US",
    });
  }
  // Macro price markets: the commodities and indices a rates desk actually watches.
  priceMarket({ sym: "GOLD", lane: CO, pct: 0.03, h: H.d7, tags: ["Gold", "Real rates"] });
  priceMarket({ sym: "GOLD", lane: CO, pct: -0.03, h: H.d7, tags: ["Gold", "Downside"] });
  priceMarket({ sym: "GOLD", lane: CO, pct: 0.06, h: H.eom, tags: ["Gold"] });
  priceMarket({ sym: "SILVER", lane: CO, pct: 0.05, h: H.d7, tags: ["Silver"] });
  priceMarket({ sym: "OIL", lane: CO, pct: 0.05, h: H.eom, tags: ["WTI", "Inflation"] });
  priceMarket({ sym: "OIL", lane: CO, pct: -0.05, h: H.eom, tags: ["WTI", "Downside"] });
  priceMarket({ sym: "DXY", lane: E, pct: 0.01, h: H.d7, tags: ["Dollar"] });
  priceMarket({ sym: "SPX", lane: ST, pct: 0.02, h: H.d7, tags: ["S&P 500"] });
  priceMarket({ sym: "SPX", lane: ST, pct: -0.03, h: H.d7, tags: ["S&P 500", "Downside"] });
  priceMarket({ sym: "NDX", lane: ST, pct: 0.03, h: H.eom, tags: ["Nasdaq"] });
  priceMarket({ sym: "PAXG", lane: E, pct: 0.02, h: H.h24, tags: ["Tokenised gold"] });


  /* ══ 9-19. The long tail — Global Stocks, Commodities, Entertainment, Prediction Markets,
     NFTs, Infrastructure, Real World, VC, Asia, Degen Dials, Global Policy ══════════════ */

  /* ── 9. Global Stocks ─────────────────────────────────────────────────── */
  priceMarket({ sym: "META", lane: ST, pct: 0.06, h: H.eom, tags: ["Megacap"] });
  priceMarket({ sym: "GOOGL", lane: ST, pct: 0.05, h: H.d7, tags: ["Megacap"] });
  priceMarket({ sym: "MSFT", lane: ST, pct: -0.03, h: H.d7, tags: ["Megacap", "Downside"] });
  priceMarket({ sym: "NVDA", lane: ST, pct: 0.2, h: H.eoq, tags: ["AI capex", "Stretch"] });
  priceMarket({ sym: "AAPL", lane: ST, pct: 0.08, h: H.eoq, tags: ["Megacap"] });
  priceMarket({ sym: "SPX", lane: ST, pct: 0.05, h: H.eom, tags: ["Index"] });
  priceMarket({ sym: "NDX", lane: ST, pct: 0.06, h: H.eoq, tags: ["Index"] });
  edp(ST, `Will the S&P 500 print a new all-time high before ${label(eoq)}?`, eoq, 0.42, "Exchange closing prints",
    "YES if the S&P 500 cash index closes above its prior all-time closing high on any trading day before the deadline.", ["SPX", "ATH"],
    "A new high is the cleanest statement that the discount-rate scare is over; the level is public every session.");
  edp(ST, `Will any mega-cap report revenue growth above 20% YoY this quarter?`, eoq, 0.55, "Company earnings releases",
    "YES if Microsoft, Alphabet, Amazon, Meta or NVIDIA reports year-over-year revenue growth above 20% in an earnings release before the deadline.", ["Earnings", "Hyperscalers"],
    "Twenty percent at this scale is the number that separates an AI capex cycle from a normal upgrade cycle.");
  edp(ST, `Will a Dow Jones component be removed from the index before ${label(eoq)}?`, eoq, 0.14, "S&P Dow Jones Indices",
    "YES if S&P Dow Jones Indices announces a change to the Dow Jones Industrial Average composition before the deadline.", ["Dow", "Index"],
    "Index deletions are rare, announced and immediately tradeable — a clean tail bet against a sleepy market.");

  /* ── 10. Commodities & Metals ────────────────────────────────────────── */
  priceMarket({ sym: "SILVER", lane: CO, pct: 0.1, h: H.eom, tags: ["Silver"] });
  priceMarket({ sym: "OIL", lane: CO, pct: -0.08, h: H.eom, tags: ["WTI", "Downside"] });
  priceMarket({ sym: "GOLD", lane: CO, pct: 0.12, h: H.eoq, tags: ["Gold", "Stretch"] });
  edp(CO, `Will gold print a new all-time high before ${label(eoq)}?`, eoq, 0.38, "COMEX front-month settlement",
    "YES if the front-month COMEX gold contract settles above its prior all-time high settlement on any trading day before the deadline.", ["Gold", "ATH"],
    "Gold's high is a real-rate statement, not a jewellery story: it prints when the market doubts the Fed's terminal rate.");
  edp(CO, `Will OPEC+ announce a production cut at its next meeting?`, addDaysUTC(now, 35), 0.44, "OPEC Secretariat communiqué",
    "YES if OPEC+ announces a reduction in aggregate production targets at its next scheduled ministerial meeting before the deadline.", ["OPEC", "Oil"],
    "A cut is a price-support decision taken by a cartel that keeps missing its own quotas — the market prices the headline, not the barrels.");
  edp(CO, `Will copper close above $5.50/lb before ${label(eoq)}?`, eoq, 0.31, "COMEX copper settlement",
    "YES if the front-month COMEX copper contract settles above $5.50 per pound on any trading day before the deadline.", ["Copper", "Industrial"],
    "Copper is the electrification trade with no narrative premium: grid, datacentres and EVs all settle through it.");
  edp(CO, `Will the gold/silver ratio close below 75 before ${label(eoq)}?`, eoq, 0.33, "COMEX settlements",
    "YES if the ratio of the front-month gold settlement to the front-month silver settlement prints below 75 on any trading day before the deadline.", ["Gold", "Silver", "Ratio"],
    "The ratio is the risk appetite of the metals complex in one number: it falls when silver outperforms, which is the late-cycle tell.");

  /* ── 11. Entertainment & Pop ─────────────────────────────────────────── */
  edp(EN, `Will a single film open above $150M domestic in one weekend before ${label(eoq)}?`, eoq, 0.3, "Box Office Mojo",
    "YES if any film reports a three-day domestic opening weekend above $150M before the deadline, per Box Office Mojo.", ["Box office", "Film"],
    "A $150M opening is the threshold where a film becomes a cultural event rather than a release — and it is audited weekly.");
  edp(EN, `Will a video-game release be delayed out of this quarter?`, eoq, 0.62, "Publisher announcements",
    "YES if a publisher with a title scheduled in the current quarter announces a delay beyond the quarter before the deadline.", ["Gaming", "Delays"],
    "Delays are the most reliably priced event in gaming: the base rate is brutal and the announcements are public.");
  edp(EN, `Will a music award's top prize go to an artist who released an album independently?`, addDaysUTC(now, 45), 0.24, "Award body announcement",
    "YES if the top album prize at a major music award show before the deadline goes to an artist who released the album without a major label.", ["Music", "Awards"],
    "Independent releases have the streaming numbers but not the campaign machinery; the gap is the trade.");
  edp(EN, `Will a top-10 Spotify artist be accused of streaming fraud this month?`, eom, 0.19, "Public reporting / platform statements",
    "YES if a top-10 artist by monthly listeners is publicly accused (by the platform, a distributor or a rights-holder) of artificial streaming before the deadline.", ["Streaming", "Drama"],
    "Artificial streaming is the music industry's open secret; accusations are public and specific when they land.");
  edp(EN, `Will any streaming service raise prices before ${label(eoq)}?`, eoq, 0.57, "Provider price pages",
    "YES if Netflix, Disney+, Max, Spotify or YouTube Premium announces a price increase in a major market before the deadline.", ["Streaming", "Pricing"],
    "Price rises are the only lever left once subscriber growth flattens — and they are announced, not leaked.");
  edp(EN, `Will a crypto KOL's apology video exceed 1M views this month?`, eom, 0.33, "Public view counts",
    "YES if a video posted by a crypto influencer apologising for a promotion, token or trade exceeds 1M views on any platform before the deadline.", ["KOL", "Drama"],
    "The apology video is the most reliable engagement event in crypto social, and the view count is public.");
  edp(EN, `Will a major franchise game cross 1M concurrent players on launch day?`, addDaysUTC(now, 60), 0.35, "SteamDB / platform charts",
    "YES if any game in an established franchise records 1,000,000+ concurrent players on its launch day before the deadline.", ["Gaming", "Launch"],
    "Concurrency is the honest launch metric: refunds and review-bombs show up later, the peak does not.");
  edp(EN, `Will a viral AI-generated track chart on a major platform this quarter?`, eoq, 0.28, "Platform charts",
    "YES if a track credited to an AI act enters a national top-40 chart before the deadline.", ["AI music", "Charts"],
    "AI music already has the streams; entering a chart is the point where the industry has to respond.");

  /* ── 12. Prediction Markets (meta) ───────────────────────────────────── */
  edp(PM, `Will Polymarket's monthly volume exceed $2B before ${label(eoq)}?`, eoq, 0.47, "Dune / Polymarket dashboard",
    "YES if Polymarket reports more than $2,000,000,000 of monthly traded volume before the deadline.", ["Polymarket", "Volume"],
    "Prediction-market volume is the category's only honest scoreboard, and it is public.");
  edp(PM, `Will Prediction Arena settle its first 100 on-chain markets before ${label(eoq)}?`, eoq, 0.36, "On-chain settlement events",
    "YES if 100 or more pools on this contract have settled (PoolSettled events) before the deadline.", ["Arena", "Settlement"],
    "Settled markets, not opened ones, are the metric that matters: a market that never resolves is a promise, not a venue.");
  edp(PM, `Will a prediction market receive a US regulated exchange licence before ${label(eoq)}?`, eoq, 0.22, "CFTC / SEC filings",
    "YES if a prediction-market operator is granted a US regulated exchange or designated contract market licence before the deadline.", ["Regulation", "Prediction markets"],
    "The licence is the whole ballgame for US volume: without it the product is a grey-market derivative.");
  edp(PM, `Will a prediction market's TVL exceed $500M before ${label(eoq)}?`, eoq, 0.4, "DefiLlama",
    "YES if any prediction-market protocol reports TVL above $500M on DefiLlama before the deadline.", ["TVL", "Prediction markets"],
    "TVL is the measure of how much money is willing to sit in escrow for a coin-flip, which is the actual product.");
  edp(PM, `Will total prediction-market volume across venues exceed $5B in a month before ${label(eoq)}?`, eoq, 0.35, "Dune aggregate dashboards",
    "YES if the combined monthly volume of Polymarket, Kalshi and the largest on-chain venues exceeds $5B before the deadline.", ["Category", "Volume"],
    "Category volume is what an advertiser or a partner actually asks about; the number is now big enough to matter.");
  edp(PM, `Will a mainstream sportsbook list a prediction-market product this quarter?`, eoq, 0.27, "Operator announcements",
    "YES if a top-10 sportsbook operator launches a prediction-market style product (fixed-payout event contracts) before the deadline.", ["Sportsbook", "Category"],
    "Sportsbooks have the distribution and the licences; prediction markets have the product. The first partnership reprices the category.");

  /* ── 13. NFTs & Digital Art ──────────────────────────────────────────── */
  edp(NF, `Will BAYC's floor price close above 12 ETH before ${label(eoq)}?`, eoq, 0.34, "Blur / OpenSea floor",
    "YES if the Bored Ape Yacht Club collection floor prints above 12 ETH on any day before the deadline, per Blur or OpenSea.", ["BAYC", "Floor"],
    "Blue-chip floors are the NFT market's price index, and they are public to the wei.");
  edp(NF, `Will CryptoPunks record a sale above $500k before ${label(eoq)}?`, eoq, 0.29, "On-chain sale records",
    "YES if any CryptoPunk sells for more than $500,000 before the deadline, per on-chain settlement.", ["Punks", "Sales"],
    "Single punk sales are the market's headline prints — rare, public, and impossible to fake on-chain.");
  edp(NF, `Will Blur's weekly volume exceed $100M before ${label(eoq)}?`, eoq, 0.31, "Blur / Dune",
    "YES if Blur reports weekly traded volume above $100M before the deadline.", ["Blur", "Volume"],
    "Blur is where professional NFT flow lives; its weekly volume is the category's real liquidity number.");
  edp(NF, `Will an NFT lending protocol cross $1B in cumulative loans before ${label(eoq)}?`, eoq, 0.26, "DefiLlama / protocol dashboards",
    "YES if an NFT-collateralised lending protocol reports $1B or more of cumulative loan originations before the deadline.", ["NFT lending", "TVL"],
    "NFT lending is the only NFT use case with a cash flow attached; the cumulative number is the proof of demand.");
  edp(NF, `Will a generative-art piece sell for over $1M this quarter?`, eoq, 0.18, "Auction house results",
    "YES if a generative or on-chain art piece sells for more than $1,000,000 at a major auction house or on-chain marketplace before the deadline.", ["Generative art", "Auctions"],
    "Generative art's top end is thin and headline-driven, which is exactly what makes the tail priceable.");
  edp(NF, `Will OpenSea report a profitable quarter before ${label(eoq)}?`, eoq, 0.16, "Company statements",
    "YES if OpenSea publicly reports a profitable quarter before the deadline.", ["OpenSea", "Business"],
    "Marketplace economics are the missing half of the NFT story: volume without take-rate is a subsidy.");

  /* ── 14. Web3 Infrastructure ─────────────────────────────────────────── */
  edp(IN, `Will Solana experience a halt longer than 30 minutes before ${label(eoq)}?`, eoq, 0.27, "Solana status page",
    "YES if the Solana mainnet beta halts block production for more than 30 consecutive minutes before the deadline, per the official status page.", ["Solana", "Uptime"],
    "Solana's halts are rare now, which is why the market underprices them — and they are announced on a status page.");
  edp(IN, `Will Ethereum ship its next scheduled upgrade before ${label(eoq)}?`, eoq, 0.52, "Ethereum client releases",
    "YES if the next scheduled Ethereum mainnet upgrade activates before the deadline, per the client teams' published fork schedule.", ["Ethereum", "Upgrade"],
    "Upgrade dates slip for good reasons and bad; the fork schedule is public and the activation block is checkable.");
  edp(IN, `Will Lido's share of staked ETH fall below 25% before ${label(eoq)}?`, eoq, 0.4, "Dune staking dashboards",
    "YES if Lido's share of total staked ETH prints below 25% on any day before the deadline.", ["Lido", "Staking"],
    "Decentralisation is a number when it is measured as one operator's share of stake; 25% is the governance-risk line.");
  edp(IN, `Will restaking TVL exceed $25B before ${label(eoq)}?`, eoq, 0.33, "DefiLlama",
    "YES if aggregate restaking TVL prints above $25B before the deadline.", ["Restaking", "TVL"],
    "Restaking turned security into a yield product; the TVL is the size of the risk being layered.");
  edp(IN, `Will a major L2 post a full day of downtime before ${label(eoq)}?`, eoq, 0.21, "L2Beat / chain status pages",
    "YES if any top-five L2 by TVL fails to produce blocks for 24 consecutive hours before the deadline.", ["L2", "Uptime"],
    "L2 sequencers are single points of failure by design; a day-long outage is the tail every bridge user is short.");
  edp(IN, `Will blob fees on Ethereum exceed 0.01 gwei for a full week before ${label(eoq)}?`, eoq, 0.37, "Etherscan blob data",
    "YES if the median blob base fee stays above 0.01 gwei for seven consecutive days before the deadline.", ["Blobs", "Fees"],
    "Blob fees are the true cost of L2 data availability, and they only rise when L2 demand is real.");
  edp(IN, `Will a major RPC provider suffer a multi-hour outage this quarter?`, eoq, 0.44, "Provider status pages",
    "YES if any of Alchemy, Infura, QuickNode or Ankr reports a degradation longer than two hours before the deadline.", ["RPC", "Uptime"],
    "RPC is the least visible single point of failure in the stack; every dApp on this board depends on one.");

  /* ── 15. Real World Events ───────────────────────────────────────────── */
  edp(RW, `Will SpaceX complete a Starship flight without a loss of vehicle before ${label(eoq)}?`, eoq, 0.46, "SpaceX mission updates",
    "YES if SpaceX completes a Starship test flight with the vehicle intact through the planned profile before the deadline.", ["SpaceX", "Launch"],
    "Starship cadence is the leading indicator for launch economics, and every flight is public.");
  edp(RW, `Will a small modular reactor receive a construction permit before ${label(eoq)}?`, eoq, 0.28, "Nuclear regulator filings",
    "YES if a nuclear regulator grants a construction permit for a small modular reactor design before the deadline.", ["Nuclear", "Energy"],
    "Datacentre demand has made nuclear licensing the bottleneck of the AI build-out; permits are public documents.");
  edp(RW, `Will a quantum computer solve a problem beyond classical simulation this quarter?`, eoq, 0.22, "Peer-reviewed publication",
    "YES if a peer-reviewed paper demonstrates a quantum computation that cannot be reproduced classically within a week before the deadline.", ["Quantum", "Research"],
    "Quantum advantage claims are the most over-claimed result in tech; the peer-reviewed version is the only one that counts.");
  edp(RW, `Will a major AI lab publish a safety evaluation of a frontier model this quarter?`, eoq, 0.58, "Lab publications",
    "YES if OpenAI, Anthropic, Google DeepMind or Meta publishes a third-party safety evaluation of a frontier model before the deadline.", ["AI safety", "Research"],
    "Safety evaluations are becoming a de-facto licence to ship; the first public one sets the template.");
  edp(RW, `Will a G20 government declare a climate emergency this quarter?`, eoq, 0.12, "Government statements",
    "YES if a G20 national government formally declares a climate emergency before the deadline.", ["Climate", "Policy"],
    "Declarations are cheap talk until they unlock emergency budget powers, which is why they stay rare.");
  edp(RW, `Will a commercial fusion company report net energy gain before ${label(eoq)}?`, eoq, 0.14, "Company / peer-reviewed results",
    "YES if a private fusion company reports a shot with scientific gain (Q>1) verified by an independent reviewer before the deadline.", ["Fusion", "Energy"],
    "Fusion has produced Q>1 in public labs; the private-sector claim is the one that would reprice the sector.");
  edp(RW, `Will a robotaxi service expand to a new US city this quarter?`, eoq, 0.55, "Operator announcements",
    "YES if Waymo, Zoox or Tesla launches paid driverless service in a city where it did not operate before the deadline.", ["Robotaxi", "Autonomy"],
    "City-by-city expansion is the only honest measure of autonomy progress; the press release is always public.");

  /* ── 16. VC & Startup Deals ──────────────────────────────────────────── */
  edp(VC, `Will a private AI company raise at a valuation above $300B before ${label(eoq)}?`, eoq, 0.33, "Reported financing rounds",
    "YES if a private AI company completes a priced round at a post-money valuation above $300B before the deadline.", ["AI", "Valuation"],
    "Private marks are the last unrepriced corner of the AI trade; one round at this size resets every comparable.");
  edp(VC, `Will crypto VC funding exceed $5B in a single quarter before ${label(eoq)}?`, eoq, 0.29, "Messari / The Block funding data",
    "YES if disclosed crypto venture funding exceeds $5B in a calendar quarter ending before the deadline.", ["Crypto VC", "Funding"],
    "Funding is the trailing indicator that still moves token prices: it says whether the next cohort gets built.");
  edp(VC, `Will a payments company file for IPO before ${label(eoq)}?`, eoq, 0.36, "SEC S-1 filings",
    "YES if Stripe, Revolut or Klarna publicly files a registration statement for an IPO before the deadline.", ["IPO", "Fintech"],
    "The IPO window is a regime indicator: one filing brings the queue.");
  edp(VC, `Will a16z or Paradigm close a fund above $5B this year?`, addDaysUTC(now, 60), 0.31, "Fund announcements",
    "YES if Andreessen Horowitz or Paradigm announces a new fund of $5B or more before the deadline.", ["VC", "Funds"],
    "Fund size is the supply side of the startup cycle; it sets how many seed cheques exist next year.");
  edp(VC, `Will an AI startup reach a $1B valuation within 12 months of founding?`, addDaysUTC(now, 90), 0.41, "Reported financings",
    "YES if any AI company founded in the last 12 months closes a round at a $1B+ post-money valuation before the deadline.", ["AI", "Unicorns"],
    "Time-to-unicorn has compressed from seven years to under one in AI; the base rate is the trade.");
  edp(VC, `Will a crypto startup with no token raise above $100M this quarter?`, eoq, 0.38, "Reported financings",
    "YES if a crypto company without a launched token closes an equity round above $100M before the deadline.", ["Crypto VC", "Equity"],
    "Equity-only crypto rounds are the tell that the business, not the token, is being financed.");

  /* ── 17. Asia & Regional ─────────────────────────────────────────────── */
  edp(AS, `Will the Bank of Japan raise its policy rate before ${label(eoq)}?`, eoq, 0.34, "BOJ statements",
    "YES if the Bank of Japan raises its short-term policy rate at a meeting before the deadline.", ["BOJ", "Japan"],
    "The yen carry trade is the funding leg of every global risk position, so a BOJ hike is a global event.");
  edp(AS, `Will China cut its one-year loan prime rate before ${label(eoq)}?`, eoq, 0.48, "PBOC announcements",
    "YES if the People's Bank of China lowers the one-year loan prime rate before the deadline.", ["China", "Rates"],
    "China's LPR is the cheapest stimulus signal there is, and it is published monthly.");
  edp(AS, `Will Japan's core CPI print above 3% in the next release?`, addDaysUTC(now, 30), 0.42, "Statistics Bureau of Japan",
    "YES if Japan's core CPI (ex fresh food) prints above 3.0% year-over-year in the next release before the deadline.", ["Japan", "CPI"],
    "Japanese inflation is the variable that decides whether the BOJ can normalise at all.");
  edp(AS, `Will India's GDP growth print above 7% in the next release?`, addDaysUTC(now, 45), 0.4, "MOSPI releases",
    "YES if India's quarterly GDP growth prints above 7.0% year-over-year in the next release before the deadline.", ["India", "GDP"],
    "India is the only large economy still compounding at 7%; the print is the whole EM growth story.");
  edp(AS, `Will Hong Kong approve another crypto trading platform licence this quarter?`, eoq, 0.57, "SFC licence register",
    "YES if the Hong Kong SFC grants a virtual-asset trading platform licence to a new operator before the deadline.", ["Hong Kong", "Licensing"],
    "Hong Kong's licensing regime is slow and public; each approval is a data point on China's tolerance.");
  edp(AS, `Will Korea pass a law allowing spot crypto ETFs this year?`, addDaysUTC(now, 90), 0.29, "National Assembly records",
    "YES if Korea enacts legislation permitting spot crypto ETFs before the deadline.", ["Korea", "ETF"],
    "Korean retail is the marginal buyer in every Asian crypto book; the ETF law is the gate.");
  edp(AS, `Will China announce a new stimulus package above $200B this quarter?`, eoq, 0.31, "State Council announcements",
    "YES if China's State Council announces fiscal stimulus of $200B or more before the deadline.", ["China", "Stimulus"],
    "Announcement size is the number that moves industrial metals and HK equities in the same hour.");

  /* ── 18. Degen Dials (24h) ───────────────────────────────────────────── */
  priceMarket({ sym: "PEPE", lane: DG, pct: 0.05, h: H.h24, tags: ["Degen", "24h"] });
  priceMarket({ sym: "WIF", lane: DG, pct: 0.06, h: H.h24, tags: ["Degen", "24h"] });
  priceMarket({ sym: "MOG", lane: DG, pct: 0.08, h: H.h24, tags: ["Degen", "24h"] });
  priceMarket({ sym: "TOSHI", lane: DG, pct: 0.08, h: H.h24, tags: ["Degen", "24h"] });
  priceMarket({ sym: "DEGEN", lane: DG, pct: 0.06, h: H.h24, tags: ["Degen", "24h"] });
  priceMarket({ sym: "BRETT", lane: DG, pct: 0.06, h: H.h24, tags: ["Degen", "24h"] });
  priceMarket({ sym: "SUI", lane: DG, pct: 0.03, h: H.h24, tags: ["High beta", "24h"] });
  priceMarket({ sym: "HYPE", lane: DG, pct: 0.03, h: H.h24, tags: ["High beta", "24h"] });
  priceMarket({ sym: "ENA", lane: DG, pct: 0.05, h: H.h24, tags: ["High beta", "24h"] });
  priceMarket({ sym: "ONDO", lane: DG, pct: 0.04, h: H.h24, tags: ["High beta", "24h"] });
  priceMarket({ sym: "ARB", lane: DG, pct: 0.05, h: H.h24, tags: ["High beta", "24h"] });
  priceMarket({ sym: "OP", lane: DG, pct: 0.06, h: H.h24, tags: ["High beta", "24h"] });
  edp(DG, `Will at least three of the ten largest Base memecoins close the day green?`, addDaysUTC(now, 1), 0.5, "CoinGecko daily closes",
    "YES if three or more of the ten largest Base-native memecoins by market cap close the UTC day higher than they opened.", ["Base", "Memes", "24h"],
    "A breadth market instead of a single coin: it prices the tape, not one ticker.");

  /* ── 19. Global Policy ───────────────────────────────────────────────── */
  edp(GP, `Will the EU's AI Act trigger its first enforcement action against a model provider?`, addDaysUTC(now, 90), 0.21, "European AI Office decisions",
    "YES if the European AI Office opens a formal enforcement action against a general-purpose AI model provider before the deadline.", ["AI Act", "EU"],
    "The AI Act's first enforcement is the template for every jurisdiction that copies it.");
  edp(GP, `Will a G7 country ban an AI model on national-security grounds this year?`, addDaysUTC(now, 90), 0.17, "Government orders",
    "YES if a G7 government issues a legally binding national-security restriction on a deployed AI model before the deadline.", ["AI", "Security"],
    "Model bans are the nuclear option of AI policy; the first one redraws the deployment map.");
  edp(GP, `Will a G7 country adopt the OECD crypto reporting framework (CARF) into law this year?`, addDaysUTC(now, 90), 0.34, "OECD / national gazettes",
    "YES if a G7 member enacts legislation implementing the OECD Crypto-Asset Reporting Framework before the deadline.", ["CARF", "Tax"],
    "Automatic exchange of crypto tax data is the quietest thing that changes offshore demand.");
  edp(GP, `Will the Basel Committee finalise bank capital rules for crypto exposures before ${label(eoq)}?`, eoq, 0.29, "BIS publications",
    "YES if the Basel Committee publishes final (not consultative) standards for banks' crypto-asset exposures before the deadline.", ["Basel", "Banking"],
    "Bank capital is the gate between crypto and the balance sheet; a final standard is the difference between custody and exposure.");
  edp(GP, `Will a G20 country ban algorithmic stablecoins this year?`, addDaysUTC(now, 90), 0.16, "National legislation",
    "YES if a G20 member enacts a ban on algorithmic or unbacked stablecoins before the deadline.", ["Stablecoins", "Ban"],
    "Two collapses made this the easiest prohibition in crypto policy; watch for it in the next omnibus.");

  return out;
}

/** Social heat, computed once per market so the marketing picker does not re-derive it. */
function attachHeat(drafts: Draft[], snap: PriceSnapshot, now: Date): Draft[] {
  return drafts.map((d) => {
    const asset = d.marketData?.asset;
    const volatilityPct = asset ? Math.abs(snap.assets[asset]?.change24h ?? 0) : 0;
    const controversy = Number((1 - Math.abs(d.yesShare - 0.5) * 2).toFixed(3));
    const hoursLeft = Math.max(0, Math.round(((d.deadline.getTime() - now.getTime()) / 3.6e6) * 10) / 10);
    // Volatility is the "Hot" half, controversy the "Contrarian" half; urgency breaks ties, because
    // a market closing in 20 hours is a better card than the same market closing in three weeks.
    const urgency = hoursLeft <= 48 ? 20 : hoursLeft <= 24 * 8 ? 10 : 0;
    const score = Number((volatilityPct * 4 + controversy * 30 + urgency).toFixed(2));
    return { ...d, heat: { volatilityPct: Number(volatilityPct.toFixed(2)), controversy, hoursLeft, score } };
  });
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
  const sticky = loadSticky();
  const drafts = attachHeat(buildBoard(snap, now, sticky), snap, now);

  if (drafts.length < TARGET_MIN && process.env.ALLOW_SMALL_BOARD !== "1") {
    // Refuse to *write* a shrunken board: a snapshot source dropped out (Yahoo, FRED), and
    // shipping 60 markets over a 150-market manifest is worse than shipping yesterday's board.
    // The previous pools.json is left untouched; refresh-board.sh exits non-zero and the ops log
    // says which source failed.
    console.error(
      `[board] refusing to write: ${drafts.length} markets generated, floor is ${TARGET_MIN}. ` +
        `Sources: ${Object.entries(snap.sources).map(([k, v]) => `${k}=${v}`).join(" ")}. ` +
        `Set ALLOW_SMALL_BOARD=1 to override.`
    );
    process.exit(1);
  }

  // Persist the terms only after the floor check: a build that failed because a feed dropped out
  // must not bake half a ladder into the cache.
  for (const [k, v] of Object.entries(sticky)) {
    if (Date.parse(v.deadline) < now.getTime()) delete sticky[k];
  }
  mkdirSync(dirname(STICKY_PATH), { recursive: true });
  writeFileSync(STICKY_PATH, JSON.stringify(sticky, null, 2) + "\n");

  // Pools that exist on the contract are the contract's rows, not ours: emit them as
  // `source: "chain"` so the UI reads status/liquidity live and the USDC rail is open. The
  // registry is written by scripts/sync-opened-pools.py from getPool(), so a pool that was
  // cancelled still shows up (and reads as Canceled) instead of silently becoming a demo row.
  const OPENED = join(ROOT, "scripts", "opened-pools.json");
  type OpenedPool = { id: string; title: string; category?: string; endTimeUtc: string };
  const openedRows: OpenedPool[] = existsSync(OPENED)
    ? Object.values(JSON.parse(readFileSync(OPENED, "utf8")) as Record<string, OpenedPool>)
    : [];
  const openedById = new Map(openedRows.map((o) => [o.id, o]));
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

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
  const generated: Pool[] = drafts.map((d) => {
    // Stable id: hash of the normalised title. Two questions that differ only in the strike or the
    // date are different markets and get different ids; the same question rebuilt 30 minutes later
    // keeps its id, so the pool created for it is never orphaned.
    let demoId = String(ID_BASE + (fnv1a(d.title) % ID_SPAN));
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
      tier: d.tier,
      heat: d.heat,
      marketData: d.marketData,
      visual: coverFor({ title: d.title, category: d.category, tags: d.tags, marketData: d.marketData }),
    };
  });

  // A hash id must never point at a pool that settles a different question. The registry is
  // authoritative (it comes from getPool()), so on any disagreement the generated row is dropped
  // rather than allowed to rewrite a live card.
  for (let i = generated.length - 1; i >= 0; i -= 1) {
    const onChain = openedById.get(generated[i].id);
    if (onChain && norm(onChain.title) !== norm(generated[i].title)) {
      console.warn(
        `[board] id ${generated[i].id} is already open as "${onChain.title}" — dropping generated "${generated[i].title}"`
      );
      generated.splice(i, 1);
    }
  }

  // Expired generated markets are gone by construction; log what that removed.
  const dropped = (previous.pools ?? []).filter(
    (p) => p.source !== "chain" && p.endTimeUtc && Date.parse(p.endTimeUtc) < now.getTime()
  );

  const byCategory: Record<string, number> = {};
  for (const p of generated) byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
  const byTier: Record<string, number> = {};
  for (const p of generated) byTier[p.tier ?? "mid"] = (byTier[p.tier ?? "mid"] ?? 0) + 1;
  const byHorizon: Record<string, number> = {};
  for (const p of generated) {
    const days = Math.max(0, Math.round((Date.parse(p.endTimeUtc!) - now.getTime()) / 86_400_000));
    const bucket = days <= 2 ? "<=48h" : days <= 9 ? "3-9d" : days <= 40 ? "10-40d" : "40d+";
    byHorizon[bucket] = (byHorizon[bucket] ?? 0) + 1;
  }

  const manifest = {
    version: 2,
    address: (process.env.ARENA_ADDRESS ?? "").trim() || previous.address || "0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5",
    chainId: previous.chainId ?? 8453,
    deployBlock: Number((process.env.ARENA_DEPLOY_BLOCK ?? "").trim()) || previous.deployBlock || 53150166,
    updatedAt: now.toISOString(),
    featured: generated.find((p) => p.source === "chain")?.id ?? chainRows[0]?.id ?? generated[0]?.id,
    dataSources: {
      prices: "Binance /api/v3/ticker/24hr (majors) + CoinGecko /simple/price (Base tokens) + Yahoo Finance chart (equities/indices/metals/FX)",
      global: "CoinGecko /global",
      tvl: "DefiLlama /v2/chains",
      macro: "FRED (DGS10, DGS2, DFEDTARU, UNRATE, T10Y2Y, MORTGAGE30US, CPIAUCSL, CPILFESL)",
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
        macro: snap.macro,
        count: generated.length,
        byCategory,
        byTier,
        byHorizon,
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
  console.log(`horizon    : ${Object.entries(byTier).map(([k, v]) => `${k}=${v}`).join("  ")}   ${Object.entries(byHorizon).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  if (dropped.length) console.log(`expired    : ${dropped.length} removed (${dropped.map((p) => p.title.slice(0, 48)).join(" · ")})`);
  console.log(`written    : ${POOLS}`);
}

main();
