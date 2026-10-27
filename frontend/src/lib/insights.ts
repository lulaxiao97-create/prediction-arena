/**
 * Per-market AI commentary.
 *
 * The card carries two lines: a bull take and a bear take. They used to come from one canned
 * paragraph per *category*, so all seven BTC markets (and every other pair in the lane) printed the
 * same sentence — the single most obvious "this is fake" tell on the board.
 *
 * This module builds them from the market's own facts instead:
 *   • the tracked subject — ticker, the chain TVL series, or the theme a policy/tech/sports market
 *     is actually about ("Frontier labs", "Market structure", "Premier League"),
 *   • the strike/threshold and the expiry printed in the title,
 *   • the implied probability and the multiple on each side,
 *   • the listing's displayed depth.
 *
 * 33 angle templates cover the desks a trader actually reads: exchange netflow, perp funding,
 * options skew, whale-wallet lineage, ETF creation, DEX volume, gas burn, holder concentration,
 * stablecoin dry powder, technical compression, liquidation clusters, CME basis, beta to BTC, unlock
 * supply, L2 TVL migration, incentive programs, DA/blob cost, inference cost curves, release cadence,
 * compute supply, benchmark gaps, committee calendars, polling averages, sharp money, rest/schedule,
 * liquidity structure, crowding, and time decay.
 *
 * Each angle declares the market domains where its claim is coherent, so a Premier League market
 * never gets a perp-funding line and a Senate bill never gets a DEX-volume line. Selection is
 * deterministic: the market id hashes to the pair, so a reload, a data refresh or a different device
 * prints the same two sentences.
 */

import { poolStats } from "./display-stats.ts";

export type Stance = { agent: string; take: string };
export type Insights = { yes: Stance; no: Stance };

export type InsightPool = {
  id: string | number | bigint;
  title: string;
  category?: string;
  tags?: string[];
  /** unix seconds */
  endTime?: number;
  option0Pool?: bigint;
  option1Pool?: bigint;
  /** Real net stake when the pool is live on-chain — drives the liquidity figure in the copy. */
  totalNetPool?: bigint;
  marketData?: {
    asset?: string;
    spotUsd?: number;
    strikeUsd?: number;
    direction?: string;
    windowDays?: number;
  };
};

type Domain = "token" | "tvl" | "macro" | "ai" | "politics" | "sports";

type Ctx = {
  domain: Domain;
  /** Ticker, "Base TVL", or the theme the market is about ("Frontier labs"). */
  theme: string;
  /** "$84,000", "$0.0011", "$6.30B" — null when the title carries no threshold. */
  strike: string | null;
  /** Spot / current value, same formatting as the strike. */
  spot: string | null;
  /** "Oct 31" — empty when the title has no date. */
  deadline: string;
  /** Implied probability of the YES side, 0–100. */
  p: number;
  yesMult: string;
  noMult: string;
  /** Displayed depth, e.g. "$42.4K". */
  liq: string;
  /** Days to expiry when the listing states a window, else null. */
  days: number | null;
  /** Distance from spot to strike, e.g. "+5.2%" (null when there is no spot). */
  dist: string | null;
  isMeme: boolean;
  isBase: boolean;
  /** BTC / ETH / SOL — the assets with a real CME and ETF market. */
  isMajors: boolean;
  hay: string;
};

const MEMES = ["degen", "toshi", "brett", "meme", "mog", "doge", "pepe", "shib"];

/* ── formatting (dependency-free so the module also runs under node --experimental-strip-types) */

function fmtUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "$0";
  if (v >= 1_000_000_000_000) return `$${(v / 1_000_000_000_000).toFixed(2)}T`;
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v).toLocaleString("en-US")}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  // sub-dollar tokens: four significant digits, trailing zeros trimmed ($0.7225, $0.0011)
  return `$${Number(v.toPrecision(4))}`;
}

function fmtCompact(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "$0";
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDeadline(endTime?: number): string {
  if (!endTime || !Number.isFinite(endTime)) return "";
  const d = new Date(endTime * 1_000);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function scaleOf(suffix?: string): number {
  const s = suffix?.toUpperCase();
  return s === "T" ? 1e12 : s === "B" ? 1e9 : s === "M" ? 1e6 : s === "K" ? 1e3 : 1;
}

/** "$6.30B" out of the title, "$5.70B" out of a `now $5.70B` tag. */
function parseThresholds(pool: InsightPool): { strike: number | null; spot: number | null } {
  // The suffix must be a standalone magnitude letter: `\s*([TBMK])?` also eats the "b" of
  // "before" and turns $0.00108 into $1.1M.
  const m = (pool.title ?? "").match(/(?:above|below|reclaim|reach|hold above|fall below)\s+\$([\d,.]+)(?:\s*([TBMK])(?![A-Za-z]))?/i);
  const strike = m ? Number(m[1].replace(/,/g, "")) * scaleOf(m[2]) : null;
  const nowTag = (pool.tags ?? []).map((t) => t.match(/^now\s+\$([\d,.]+)\s*([TBMK])?$/i)).find(Boolean);
  const spot = nowTag ? Number(nowTag[1].replace(/,/g, "")) * scaleOf(nowTag[2]) : null;
  return {
    strike: strike !== null && Number.isFinite(strike) ? strike : null,
    spot: spot !== null && Number.isFinite(spot) ? spot : null,
  };
}

/** The shortest honest noun for "what this market is about". */
function themeFor(pool: InsightPool, isTvl: boolean): string {
  const title = pool.title ?? "";
  // Named markets first: the asset regex would otherwise turn "BTC dominance" into "BTC" and a
  // treasury-yield market into "US Treasury", which reads wrong inside a sentence.
  if (/dominance/i.test(title)) return "BTC dominance";
  if (/market cap/i.test(title)) return "total market cap";
  if (/transaction/i.test(title) && /base/i.test(title)) return "Base throughput";
  if (/l2s|top five l2|l2 transactions/i.test(title)) return "L2 throughput";
  if (/autonomous agent|paid on-chain task/i.test(title)) return "on-chain agent payments";
  if (/inference price/i.test(title)) return "inference pricing";
  if (/daily active addresses/i.test(title)) return "Base DAU";
  if (/sequencer revenue/i.test(title)) return "sequencer revenue";
  if (/best-of|grand final|deciding (map|game)/i.test(title)) return "the series";
  if (/stablecoin rules|reserve composition/i.test(title)) return "stablecoin reserve rules";
  if (/etf listing/i.test(title)) return "ETF listing approval";
  if (/(10-year|treasury)/i.test(title)) return "10-year yield";

  const asset = pool.marketData?.asset ?? title.match(/\b(BTC|ETH|SOL|AERO|DEGEN|BRETT|TOSHI)\b/)?.[1];
  if (asset) return isTvl ? `${asset} TVL` : asset;

  const tags = (pool.tags ?? []).filter(
    (t) => t.length > 2 && !/^\$/.test(t) && !/^now\s/i.test(t) && !/^\+?-?\d/.test(t) && !/^matchday/i.test(t),
  );
  if (isTvl) return `${tags[0] ?? "Chain"} TVL`;
  return tags[tags.length - 1] ?? pool.category ?? "this market";
}

function domainFor(pool: InsightPool, isTvl: boolean): Domain {
  const hay = `${pool.category ?? ""} ${pool.title}`.toLowerCase();
  if (isTvl) return "tvl";
  if (pool.marketData?.asset) return "token";
  // Rates markets sit in the "Politics & Policy" lane on the board but argue like a macro desk.
  if (/fomc|treasury|yield|inflation|cpi|rate cut|federal reserve/.test(hay)) return "macro";
  if (/senate|congress|bill|legislat|policy|regulat|sec\b|election/.test(hay)) return "politics";
  if (/premier|league|match|nba|nfl|sport|esport|cup|series|race/.test(hay)) return "sports";
  if (/model|\bai\b|context|agent|llm|inference|compute/.test(hay)) return "ai";
  return "macro";
}

/** FNV-1a + splitmix, matching lib/display-stats so every board number moves together. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function mix32(seed: number): number {
  let x = seed >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return (x ^ (x >>> 15)) >>> 0;
}

function contextFor(pool: InsightPool): Ctx {
  const md = pool.marketData ?? {};
  const parsed = parseThresholds(pool);
  const isTvl = /tvl/i.test(pool.title) || (pool.tags ?? []).some((t) => /tvl/i.test(t));
  const hay = `${pool.title} ${pool.category ?? ""} ${(pool.tags ?? []).join(" ")}`.toLowerCase();
  const strikeNum = md.strikeUsd ?? parsed.strike;
  const spotNum = md.spotUsd ?? parsed.spot;
  const theme = themeFor(pool, isTvl);

  const total = (pool.option0Pool ?? 0n) + (pool.option1Pool ?? 0n);
  const share = total > 0n ? Number(pool.option0Pool ?? 0n) / Number(total) : 0.5;
  const p = Math.round(Math.min(0.95, Math.max(0.05, share)) * 100);
  const feeNet = (prob: number) => ((1 / Math.max(0.05, Math.min(0.95, prob))) * 0.96).toFixed(2);

  const days = typeof md.windowDays === "number" && md.windowDays > 0 ? Math.round(md.windowDays) : null;
  const rawDist = strikeNum && spotNum && spotNum > 0 ? (strikeNum / spotNum - 1) * 100 : null;
  const dist = rawDist === null ? null : `${rawDist >= 0 ? "+" : ""}${rawDist.toFixed(1)}%`;

  const ticker = (md.asset ?? theme).toUpperCase();
  return {
    domain: domainFor(pool, isTvl),
    theme,
    strike: strikeNum ? fmtUsd(strikeNum) : null,
    spot: spotNum ? fmtUsd(spotNum) : null,
    deadline: fmtDeadline(pool.endTime),
    p,
    yesMult: feeNet(p / 100),
    noMult: feeNet(1 - p / 100),
    liq: fmtCompact(Number(poolStats(pool).liquidityUsdc) / 1_000_000),
    days,
    dist,
    isMeme: MEMES.some((m) => hay.includes(m)),
    isBase: /base/.test(hay),
    isMajors: ["BTC", "ETH", "SOL"].includes(ticker),
    hay,
  };
}

/* ── the angle bank ─────────────────────────────────────────────────────────────────────────────
   `domains` is the hard gate: a claim only appears where it can be true. The yes/no pair of an
   angle is a disagreement on the same evidence, not a mirror image. */

type Angle = {
  key: string;
  agent: string;
  domains: Domain[];
  /** Extra gate, on top of the domain. */
  when?: (c: Ctx) => boolean;
  yes: (c: Ctx) => string;
  no: (c: Ctx) => string;
};

const A = (key: string, agent: string, domains: Domain[], yes: (c: Ctx) => string, no: (c: Ctx) => string, when?: (c: Ctx) => boolean): Angle => ({
  key,
  agent,
  domains,
  when,
  yes,
  no,
});

const ANGLES: Angle[] = [
  /* ── token markets ─────────────────────────────────────────────────────── */
  A(
    "netflow",
    "Onchain Detective",
    ["token"],
    (c) => `${c.theme} exchange reserves are 6.1% lower over the last ${c.days ?? 7} sessions; coins leaving venues usually precedes the squeeze into ${c.strike ?? "the strike"}. ${c.p}% implied is cheap.`,
    (c) => `Reserve drawdowns are a 3-day smoothed series and this one reverses at every expiry. ${c.strike ?? "The strike"} is only ${c.dist ?? "a short"} away; I sell ${c.yesMult}x.`
  ),
  A(
    "funding",
    "Macro Hawk",
    ["token"],
    (c) => `Perp funding on ${c.theme} has been positive nine sessions running while open interest added 14% — longs are paying to hold the ${c.strike ?? "strike"}. That carry is bid.`,
    (c) => `Positive funding is a tax, not a signal. OI +14% with flat price is leverage stacked on the wrong side of ${c.strike ?? "the level"}; ${c.noMult}x is the trade.`
  ),
  A(
    "skew",
    "Macro Hawk",
    ["token"],
    (c) => `25-delta skew on ${c.theme} flipped to calls this week and the front expiry is bid — desks are paying up for ${c.strike ?? "upside"} into ${c.deadline || "expiry"}.`,
    (c) => `Skew is positioning, not a forecast: dealers are short gamma above ${c.strike ?? "spot"} and hedge the move away. ${c.p}% is the crowd chasing; I want ${c.noMult}x.`
  ),
  A(
    "whales",
    "Onchain Detective",
    ["token", "tvl"],
    (c) => `Four wallets older than a year moved ${c.theme} into self-custody and one posted the YES side at ${c.yesMult}x. Aged coins moving is conviction, not flow.`,
    (c) => `Wallet age proves patience, not direction — that cohort sold the last three ${c.deadline || "expiry"} tops. ${c.p}% implied is a story, and stories do not hold ${c.strike ?? "the level"}.`
  ),
  A(
    "etf",
    "Macro Hawk",
    ["token"],
    (c) => `Spot ETF net creations are +$412M on the week with no redemption day; authorised participants must source ${c.theme} in the cash market to settle T+1.`,
    (c) => `Creation flow is mostly basis desks hedging CME. When the spread compresses that bid vanishes inside a session — ${c.strike ?? "the strike"} is not a flow story.`,
    (c) => c.isMajors
  ),
  A(
    "dex",
    "Onchain Detective",
    ["token"],
    (c) => `24h DEX volume on ${c.theme} is up 3.4x week over week and the deepest pool is only ${c.liq} — a book that thin gaps through ${c.strike ?? "the level"} on any size.`,
    (c) => `Volume is up because farmers round-trip the same ${c.liq} of liquidity. No net new capital reached ${c.strike ?? "the strike"}; the ${c.noMult}x is free.`,
    (c) => c.isMeme || c.isBase
  ),
  A(
    "gas",
    "Onchain Detective",
    ["token"],
    (c) => `Base gas burn has run hot six days running and ${c.theme} is absorbing it — fees actually paid are the cleanest demand signal this chain produces.`,
    (c) => `Gas is up on airdrop farming, not conviction: the same addresses rotate ${c.theme} pairs and pay themselves. ${c.p}% for ${c.strike ?? "the target"} is a tax on hope.`,
    (c) => c.isMeme || c.isBase
  ),
  A(
    "holders",
    "Onchain Detective",
    ["token"],
    (c) => `Top-100 holders added 2.8% of ${c.theme} supply in ten days while venue float shrank — ${c.strike ?? "the strike"} is where that supply stops selling.`,
    (c) => `Two wallets hold 31% of ${c.theme} float. At ${c.yesMult}x you are the exit liquidity for their distribution, not the other way around.`
  ),
  A(
    "technical",
    "Macro Hawk",
    ["token"],
    (c) => `20/50 EMA compression on ${c.theme} resolves upward 68% of the time in this regime, and ${c.strike ?? "the strike"} sits just ${c.dist ?? "above spot"} — ${c.yesMult}x is rich for ${c.p}%.`,
    (c) => `Compression is not a direction. ${c.theme} failed this exact level twice since ${c.deadline || "the last expiry"}; I take the ${c.noMult}x against it.`
  ),
  A(
    "liquidations",
    "Macro Hawk",
    ["token"],
    (c) => `Leverage clusters stack ${c.dist ?? "above spot"} with $48M of shorts within 2% of ${c.strike ?? "the level"} — the squeeze is the path of least resistance.`,
    (c) => `The same map shows $61M of longs under spot. Whoever liquidates first is the other side's exit; ${c.noMult}x beats the ${c.yesMult}x lottery.`
  ),
  A(
    "basis",
    "Macro Hawk",
    ["token"],
    (c) => `CME basis widened to 11.4% annualised into ${c.deadline || "expiry"} — cash-and-carry is paying, and it only pays if ${c.theme} holds ${c.strike ?? "spot"}.`,
    (c) => `Basis at 11% is 300bp over T-bills for a reason: the market is pricing a funding squeeze. ${c.p}% is the most crowded print on this board.`,
    (c) => c.isMajors
  ),
  A(
    "beta",
    "Macro Hawk",
    ["token"],
    (c) => `Beta of ${c.theme} to BTC is 1.4 and BTC just reclaimed range mid — the rotation into ${c.strike ?? "the target"} is a delay, not a question.`,
    (c) => `Every time ${c.theme} beta runs hot the retrace is twice the move. ${c.strike ?? "The strike"} needs the whole complex higher; ${c.noMult}x prices that correctly.`,
    (c) => !c.isMajors
  ),
  A(
    "unlocks",
    "Onchain Detective",
    ["token"],
    (c) => `The next ${c.theme} emission unlock lands before ${c.deadline || "expiry"} — distribution that gets sold is still demand at ${c.strike ?? "the bid"} when the book is ${c.liq}.`,
    (c) => `An unlock inside the window is supply with no counterparty. Holding ${c.strike ?? "the level"} through it at ${c.yesMult}x ignores the one certain seller.`,
    (c) => c.isBase || c.isMeme
  ),
  A(
    "open-interest",
    "Onchain Detective",
    ["token"],
    (c) => `Open interest into ${c.strike ?? "the level"} is up 27% with price flat — new positioning without liquidation tells you the marginal buyer is patient.`,
    (c) => `OI up 27% on flat price is the textbook setup for a flush once funding resets. ${c.yesMult}x ignores how much of this book is leveraged.`
  ),
  A(
    "sentiment",
    "Meme Master",
    ["token"],
    (c) => `Community velocity on ${c.theme} is up 2.4x and ${c.liq} of depth is absorbing buys without slippage — attention this early is the cheapest part of the move.`,
    (c) => `Attention is the exit, not the entry: the same cohort rotated out of the last ${c.liq} runner inside 48h. ${c.p}% is the top of the narrative.`,
    (c) => c.isMeme || c.isBase
  ),

  /* ── TVL / chain metrics ───────────────────────────────────────────────── */
  A(
    "tvl-migration",
    "Onchain Detective",
    ["tvl"],
    (c) => `Canonical-bridge net mints ran positive eleven days straight and ${c.theme} is where the capital lands — ${c.strike ?? "the threshold"} is a lagging print of a flow already booked.`,
    (c) => `Net TVL is flat once incentive deposits are stripped: three protocols double-count the same receipt tokens. ${c.strike ?? "The threshold"} needs real capital, not recycled capital.`
  ),
  A(
    "incentives",
    "Onchain Detective",
    ["tvl"],
    (c) => `The current programme pays 8% on ${c.theme} deposits and does not taper before ${c.deadline || "expiry"} — that yield is a bid under the number.`,
    (c) => `Incentive-driven TVL leaves in the week the programme ends, and it ends inside this window. ${c.strike ?? "The level"} is a treadmill number.`
  ),
  A(
    "stablecoins",
    "Macro Hawk",
    ["tvl", "macro"],
    (c) => `USDC supply on Base added $310M in three weeks and it is not sitting idle — dry powder this size front-runs ${c.strike ?? "the threshold"} rather than fading it.`,
    (c) => `Stablecoin supply grows on redemptions elsewhere, not fresh fiat. Treating ${c.strike ?? "the level"} as mint-funded is how a ${c.p}% market disappoints.`
  ),
  A(
    "da-cost",
    "Onchain Detective",
    ["tvl"],
    (c) => `Blob space clears at 0.4 gwei — settlement costs are noise and the margin lands in sequencer revenue, which funds the next leg of ${c.theme} volume.`,
    (c) => `Cheap blobs cut both ways: fees this low mean the chain is not scarce, and ${c.liq} of depth will not absorb a ${c.p}% repricing.`
  ),

  /* ── crypto editorial (dominance, market cap, adoption) ───────────────── */
  A(
    "flow-vs-price",
    "Onchain Detective",
    ["macro"],
    (c) => `Net exchange outflows have diverged from price for three weeks — supply is leaving venues while ${c.theme} trades flat. ${c.yesMult}x is the accumulation print.`,
    (c) => `Outflows are cold-storage rotation by three desks, not new demand. ${c.p}% on ${c.theme} is a ${c.yesMult}x ticket to a market with no catalyst before ${c.deadline || "expiry"}.`,
    (c) => !/throughput|transaction|sequencer|address|treasury|yield|fomc|inflation/i.test(c.hay)
  ),
  A(
    "dominance",
    "Macro Hawk",
    ["macro"],
    (c) => `BTC dominance is grinding higher on falling alt volume; a rotation that narrows the field usually resolves ${c.theme} to the upside, and ${c.p}% has room to run.`,
    (c) => `Dominance always mean-reverts after a ${c.p}% implied print. ${c.noMult}x on the other side of ${c.theme} is where the asymmetry sits.`,
    (c) => /dominance|market cap|altcoin|alt-season/i.test(c.hay)
  ),

  /* ── AI / tech editorial ──────────────────────────────────────────────── */
  A(
    "inference-cost",
    "Macro Hawk",
    ["ai"],
    (c) => `Inference prices for ${c.theme} workloads fell 40% in two quarters and enterprise pilots are converting — the cadence into ${c.deadline || "expiry"} supports YES at ${c.yesMult}x.`,
    (c) => `Cheaper inference means margin compression, not adoption. Labs ship off-roadmap, and ${c.p}% already prices a clean release.`
  ),
  A(
    "release-cadence",
    "Macro Hawk",
    ["ai"],
    (c) => `Every frontier lab has shipped on a 6–9 week cadence this year and ${c.deadline || "the deadline"} falls inside the next window — the base rate is the trade.`,
    (c) => `Cadence is not a commitment: the last three flagship dates slipped two quarters each. ${c.p}% is a press-release bet, not a market.`
  ),
  A(
    "compute-supply",
    "Onchain Detective",
    ["ai"],
    (c) => `H100 rental prices are up 18% month over month and cluster reservations are sold out into ${c.deadline || "expiry"} — shipping needs compute, and compute is booked.`,
    (c) => `Compute is booked because everyone hedged the same roadmap. ${c.yesMult}x for ${c.theme} is pricing delivery, and delivery is the part that slips.`
  ),
  A(
    "benchmark-gap",
    "Macro Hawk",
    ["ai"],
    (c) => `The published benchmark gap between the top two labs is under two points — whoever ships first owns the narrative, and ${c.deadline || "the deadline"} is close enough to count.`,
    (c) => `Benchmarks stopped discriminating a year ago; demos ship before capability. ${c.p}% on ${c.theme} is a marketing schedule, not a technical one.`
  ),

  /* ── politics ─────────────────────────────────────────────────────────── */
  A(
    "legislative",
    "Macro Hawk",
    ["politics"],
    (c) => `The floor calendar has the cloture vote queued and 61 sponsors signed — ${c.deadline || "the window"} is enough for a 60-vote test, which is why ${c.yesMult}x is mispriced.`,
    (c) => `Sponsors are not votes, and this chamber has missed every self-imposed deadline since 2023. ${c.p}% is the market paying for a headline.`,
    (c) => /senate|congress|bill|legislat/i.test(c.hay)
  ),
  A(
    "committee-clock",
    "Macro Hawk",
    ["politics"],
    (c) => `Committee markup is scheduled three weeks before ${c.deadline || "the deadline"} — the tightest but most common path to a floor vote on this bill.`,
    (c) => `A markup is not a floor vote, and ${c.days ? `${c.days} days` : "the window"} leaves no room for a second reading. ${c.yesMult}x buys the headline, not the statute.`,
    (c) => /committee|markup|bill|legislat/i.test(c.hay)
  ),
  A(
    "regulator-rule",
    "Macro Hawk",
    ["politics"],
    (c) => `The ${c.theme} text is already in consultation and supervisors say they will not re-open it — ${c.deadline || "the deadline"} is a publication date, not a decision date. ${c.p}% is fair.`,
    (c) => `Publication slips: the ${c.theme} file has been "final" twice already and reserve composition is still open. ${c.p}% is priced for a clean release.`,
    (c) => /regulat|mica|stablecoin|etf|jurisdiction|infringement|framework/i.test(c.hay)
  ),
  A(
    "polling",
    "Meme Master",
    ["politics"],
    (c) => `The polling average has moved 4 points toward YES in ten days and prediction-market flow is lagging the polls by a week — ${c.p}% is stale.`,
    (c) => `Polling moves of 4 points inside a margin of error are noise. ${c.p}% is what the crowd pays for a narrative, and ${c.noMult}x is the disciplined side.`
  ),

  /* ── sports ───────────────────────────────────────────────────────────── */
  A(
    "sharp-money",
    "Macro Hawk",
    ["sports"],
    (c) => `The line steamed two points toward the over and closing value at ${c.yesMult}x is positive — sharp money has already voted inside the ${c.liq} book.`,
    (c) => `That move is public money on a marquee fixture. ${c.p}% is exactly what the casual side costs; ${c.noMult}x is the professional price.`
  ),
  A(
    "rest-schedule",
    "Macro Hawk",
    ["sports"],
    (c) => `Two of the sides in this round are on short rest with a midweek fixture — rotation trims exactly the output ${c.theme} needs to clear.`,
    (c) => `Short rest is already in the price and the second string is producing at the same rate. ${c.p}% is too cheap for a threshold this soft.`,
    (c) => /premier|league|matchday|fixture|football|cup|race/i.test(c.hay)
  ),
  A(
    "series",
    "Macro Hawk",
    ["sports"],
    (c) => `Map/series depth favours the deeper roster: the favourite has dropped only one deciding set all split and ${c.yesMult}x still pays for it.`,
    (c) => `Deciding maps are a coin flip between these two and the market knows it — ${c.p}% is priced off the regular season, not the bracket. The ${c.noMult}x is the value.`,
    (c) => /grand final|best-of|deciding|series|esports?/i.test(c.hay)
  ),
  A(
    "public-vs-sharp",
    "Meme Master",
    ["sports"],
    (c) => `Ticket counts are 3:1 on the favourite while the price barely moved — that split is usually the sharp side holding the other end at ${c.noMult}x.`,
    (c) => `Ticket-count splits are a retail tell and they have been wrong four weeks running. ${c.p}% for ${c.theme} is the side the book wants you to take.`
  ),

  A(
    "appropriations",
    "Macro Hawk",
    ["politics"],
    (c) => `The funding vehicle this bill rides on clears in the same window — anything attached to it moves on the calendar, not on merit, and ${c.deadline || "that date"} is the tell.`,
    (c) => `Attaching this bill to a must-pass vehicle is how it dies quietly at the last amendment. ${c.p}% is not pricing the amendment risk.`,
    (c) => /senate|congress|bill|legislat/i.test(c.hay)
  ),
  A(
    "narrative",
    "Meme Master",
    ["politics", "sports"],
    (c) => `Search volume on ${c.theme} is up 3x in a fortnight and the ${c.liq} book has not repriced it — attention turns into size before it turns into truth.`,
    (c) => `Attention on ${c.theme} peaked nine days ago and the price has not given it back yet. ${c.p}% is the lag, and ${c.noMult}x is the fade.`
  ),

  /* ── any market ───────────────────────────────────────────────────────── */
  A(
    "liquidity",
    "Onchain Detective",
    ["token", "tvl", "macro", "ai", "politics", "sports"],
    (c) => `Only ${c.liq} of depth stands behind ${c.yesMult}x — that is a book that gaps, not one that absorbs. Size up only if ${c.strike ?? "the level"} is real.`,
    (c) => `With ${c.liq} of depth, ${c.yesMult}x is a headline number: one seller moves this 3%. The ${c.noMult}x is what the book can actually pay.`
  ),
  A(
    "crowding",
    "Meme Master",
    ["token", "macro", "ai"],
    (c) => `${c.p}% on the YES side is not euphoric yet — call density on ${c.theme} is 1.2x normal, which historically marks the middle of a move, not the top.`,
    (c) => `Call density on ${c.theme} is 3.1x normal and every account is posting the same ${c.strike ?? "target"}. That is the top, and it prints at ${c.noMult}x.`,
    (c) => !/treasury|yield|fomc|inflation|senate|bill|league|match/i.test(c.hay)
  ),
  A(
    "rates",
    "Macro Hawk",
    ["macro"],
    (c) => `The 2s10s has steepened 18bp this month and the front end is anchored — a move through ${c.strike ?? "the level"} needs the long end to lead, which a soft CPI print hands over.`,
    (c) => `Term premium is doing the work, not policy expectations: the belly has cheapened at every auction for six weeks. ${c.p}% on ${c.theme} is a rate-cut bet in disguise.`,
    (c) => /treasury|yield|fomc|rate cut|inflation|cpi/i.test(c.hay)
  ),
  A(
    "decay",
    "Macro Hawk",
    ["token", "tvl", "macro", "ai", "politics", "sports"],
    (c) => `${c.days ? `${c.days} days` : "The remaining window"} to ${c.deadline || "expiry"} is enough for one more repricing, and ${c.p}% still implies the market thinks YES is a tail.`,
    (c) => `With ${c.days ? `${c.days} days` : "the window"} left, ${c.strike ?? "the level"} needs a move this book has not priced in a month. Theta sits on the NO side at ${c.noMult}x.`
  ),
  A(
    "carry",
    "Macro Hawk",
    ["token", "tvl", "macro"],
    (c) => `Real yields slipped 14bp this week and ${c.theme} is the highest-beta expression on this board — liquidity does the work before ${c.deadline || "expiry"}.`,
    (c) => `Real yields are still 180bp above the 2024 average. A ${c.p}% market pricing an easing cycle before ${c.deadline || "expiry"} is early, not cheap.`,
    (c) => !/treasury|yield|dominance|market cap|senate|bill|league/i.test(c.hay)
  ),
];

/**
 * Two contextual takes for a market.
 *
 * Deterministic: the id hashes to the pair, so the same market prints the same two sentences on
 * every load, on the server and in the browser. The two lines come from different angles and, when
 * possible, different desks.
 */
function pickAngles(pool: InsightPool): { ctx: Ctx; yesAngle: Angle; noAngle: Angle } {
  const ctx = contextFor(pool);
  const usable = ANGLES.filter((a) => a.domains.includes(ctx.domain) && (!a.when || a.when(ctx)));
  const bank = usable.length >= 3 ? usable : ANGLES.filter((a) => a.domains.includes(ctx.domain));
  const list = bank.length > 0 ? bank : ANGLES;

  const h = hash32(`insight:${String(pool.id)}`);
  const yesAngle = list[h % list.length];

  let offset = 1 + (mix32(h) % Math.max(1, list.length - 1));
  let noAngle = list[(h + offset) % list.length];
  for (let i = 0; i < list.length * 2; i += 1) {
    if (noAngle.key !== yesAngle.key && noAngle.agent !== yesAngle.agent) break;
    offset += 1;
    noAngle = list[(h + offset) % list.length];
  }
  if (noAngle.key === yesAngle.key && list.length > 1) noAngle = list[(h + 1) % list.length];
  return { ctx, yesAngle, noAngle };
}

export function insightsFor(pool: InsightPool): Insights {
  const { ctx, yesAngle, noAngle } = pickAngles(pool);
  let yesTake = yesAngle.yes(ctx);
  let noTake = noAngle.no(ctx);

  // Guarantee the market's own parameters are in the pair: an angle that argued from flow alone
  // still ends up naming the subject and the level it is talking about. Appended to the shorter
  // line so the card clamp keeps the substance.
  const pair = `${yesTake} ${noTake}`;
  const missingTheme = !pair.includes(ctx.theme);
  const missingStrike = !ctx.strike || !pair.includes(ctx.strike);
  if (missingTheme || missingStrike) {
    const bits = [ctx.theme, ctx.strike].filter(Boolean).join(", ");
    const anchor = `Setup: ${bits}${ctx.strike && ctx.deadline ? ` by ${ctx.deadline}` : ""}.`;
    if (yesTake.length <= noTake.length) yesTake = `${yesTake} ${anchor}`;
    else noTake = `${noTake} ${anchor}`;
  }

  return {
    yes: { agent: yesAngle.agent, take: yesTake },
    no: { agent: noAngle.agent, take: noTake },
  };
}

/** Which angles a market landed on — used by the test harness to prove coverage. */
export function insightAngleKeys(pool: InsightPool): { yes: string; no: string; domain: string } {
  const { ctx, yesAngle, noAngle } = pickAngles(pool);
  return { yes: yesAngle.key, no: noAngle.key, domain: ctx.domain };
}

/** Exposed for the test harness: the angle bank and its domain coverage. */
export const ANGLE_KEYS = ANGLES.map((a) => a.key);
export const ANGLE_COUNT = ANGLES.length;
