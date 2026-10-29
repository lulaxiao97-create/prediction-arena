/**
 * Content factory for the daily market cycle.
 *
 * It picks the loudest market on the board and writes the three posts the channels need — an X
 * tweet, a Farcaster cast, a Telegram daily — then archives them under `docs/campaigns/`, one
 * folder per day plus a weekly schedule file. Archiving matters: a campaign that only exists in a
 * terminal scrollback cannot be reviewed, re-used or attributed later.
 *
 *   bun scripts/auto-market.ts                       # biggest payout, dry run
 *   bun scripts/auto-market.ts --pick=expiry         # closest to closing
 *   bun scripts/auto-market.ts --pick=tvl            # deepest liquidity
 *   bun scripts/auto-market.ts --limit=3 --write     # three markets, archived to docs/campaigns
 *   bun scripts/auto-market.ts --limit=2 --send      # publish (needs credentials below)
 *
 * Credentials (optional; without them nothing is published):
 *   X_OAUTH2_BEARER=...        user-context token with tweet.write
 *   TELEGRAM_BOT_TOKEN=...     bot that is an admin of @predictionarena_hq
 *   TELEGRAM_CHAT_ID=@predictionarena_hq
 *
 * Rules the copy follows:
 *  - no invented numbers: probability, payout, traders and close time come from the manifest;
 *  - no "0% fee" and no guaranteed returns — the contract takes 4% into per-market escrow;
 *  - every link carries `utm_*` + `ref` so a spike can be traced to the channel that caused it;
 *  - length budgets are enforced per platform (X: 280 with URLs counted as 23; Farcaster: 320).
 */

import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://predictionarena.online").replace(/\/+$/, "");
const ROOT = join(import.meta.dir, "..");
const MANIFEST = join(ROOT, "frontend", "public", "pools.json");
const CAMPAIGNS = join(ROOT, "docs", "campaigns");
const X_HANDLE = "@Predict065";

type Pool = {
  id: string | number;
  title: string;
  status?: number;
  endTimeUtc?: string;
  traders?: number;
  liquidityUsdc?: string | number;
  yesShare?: number;
  marketData?: { asset?: string; spotUsd?: number; strikeUsd?: number; source?: string };
};

type Args = {
  pick: "movers" | "expiry" | "tvl" | "tribal";
  limit: number;
  send: boolean;
  json: boolean;
  write: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { pick: "tribal", limit: 1, send: false, json: false, write: false };
  for (const raw of argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "pick" && ["movers", "expiry", "tvl", "tribal"].includes(value)) args.pick = value as Args["pick"];
    else if (key === "limit") args.limit = Math.max(1, Math.min(12, Number(value) || 1));
    else if (key === "send") args.send = true;
    else if (key === "json") args.json = true;
    else if (key === "write") args.write = true;
    else if (key === "help" || key === "-h") {
      console.log("usage: bun scripts/auto-market.ts [--pick=tribal|movers|expiry|tvl] [--limit=N] [--write] [--send] [--json]");
      process.exit(0);
    }
  }
  return args;
}

function loadPools(): Pool[] {
  const board = JSON.parse(readFileSync(MANIFEST, "utf8")) as { pools?: Pool[] };
  return (board.pools ?? []).filter((p) => (p.status ?? 1) === 1);
}

function yesShare(pool: Pool): number {
  const raw = Number(pool.yesShare ?? Number.NaN);
  if (Number.isFinite(raw) && raw > 0 && raw < 1) return raw;
  return 0.5;
}

/** X counts every URL as 23 characters. */
function weight(text: string): number {
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  return urls.reduce((n, u) => n + 23 - u.length, text.length);
}

function money(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

/** Prices need more precision than a liquidity figure: "$0" for TOSHI is worse than no number. */
function price(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "$—";
  if (v >= 1_000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${Number(v.toPrecision(4))}`;
}

function clipped(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

function poolClosed(pool: Pool): boolean {
  if (!pool.endTimeUtc) return false;
  return new Date(pool.endTimeUtc).getTime() <= Date.now();
}

function closeIn(pool: Pool): string {
  if (!pool.endTimeUtc) return "soon";
  const ms = new Date(pool.endTimeUtc).getTime() - Date.now();
  if (ms <= 0) return "closed";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function trackedUrl(id: string | number, source: "x" | "telegram" | "farcaster"): string {
  const url = new URL(`${SITE}/market/${id}`);
  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", source === "farcaster" ? "cast" : "social");
  url.searchParams.set("utm_campaign", "auto_market");
  url.searchParams.set("utm_content", String(id));
  url.searchParams.set("ref", source === "farcaster" ? "fc" : source);
  return url.toString();
}


/**
 * "Tribal" score — how much of a fight a market is.
 *
 * The board is full of macro questions ("will CPI print above 3.2%"). They are fine products and
 * terrible social content: nobody roots for a statistic. A market where one community can beat
 * another — a token flipping a rival, a chain overtaking a chain, a whale getting liquidated —
 * gets shared because taking a side is a statement about who you are.
 *
 * Signals, weighted by what actually moved traffic on Farcaster:
 *   +4  head-to-head framing (vs / flip / overtake / surpass / higher than)
 *   +3  a token whose tribe exists (DEGEN, TOSHI, BRETT, AERO, MOG…) — matched against the title
 *   +2  price/市值 style binary with a tight strike (a coin flip is a fight)
 *   +1  deep trailing liquidity per trader (a crowded room)
 *   -3  macro/politics framing (nobody tribes up over a CPI print)
 */
/**
 * Tokens with an actual community behind them. `base`, `onchain` and `higher` used to be in this
 * list and were a mistake: "Will Base TVL close above $6.4B" matched as a tribe and outranked real
 * DEGEN/TOSHI fights, and `higher` matches the comparison word in "closes higher than". A false
 * tribe is worse than a missed one — the picker's whole job is to find a side worth taking.
 */
const TRIBE_TOKENS = ["degen", "toshi", "brett", "mog", "aero", "aerodrome", "zora"];
const BATTLE_RE = /\b(vs\.?|versus|flip|flips|overtake|overtakes|surpass|surpasses|beat|beats|higher than|below|above)\b/i;
const MACRO_RE = /\b(cpi|fomc|fed|inflation|unemployment|gdp|election|senate|powell)\b/i;

/**
 * Learned tribal weights, written by `scripts/sync-attribution.ts` from `/api/growth/summary`.
 *
 * Until the first referred bet lands on Base this file has `bets: 0` and contributes exactly zero:
 * the score below stays the hand-tuned prior. Once real money moves, the tribe that actually drew
 * volume gets the extra points, so the daily pick drifts toward the fight people paid for instead
 * of the fight we guessed they wanted.
 *
 * It is a *bonus*, never a penalty, and it is capped at +2 — a leader with 100× the volume of the
 * runner-up must not turn one market into the only market the channel ever posts.
 */
type TribeStat = { token: string; bets: number; volumeUsdc: number };
type Attribution = {
  generatedAt: string;
  source: string;
  bets: number;
  referredBets: number;
  volumeUsdc: number;
  byTribe: TribeStat[];
  leader: string | null;
};

const ATTRIBUTION_FILE = process.env.ATTRIBUTION_FILE ?? join(CAMPAIGNS, "attribution.json");
const ATTRIBUTION_TTL_MS = 7 * 86_400_000;

/** null = no usable signal (missing file, stale file, or no bets yet). */
function loadAttribution(): { data: Attribution | null; note: string } {
  let raw: string;
  try {
    raw = readFileSync(ATTRIBUTION_FILE, "utf8");
  } catch {
    return { data: null, note: "no attribution file — tribal weights stay at the hand-tuned prior" };
  }
  let data: Attribution;
  try {
    data = JSON.parse(raw) as Attribution;
  } catch {
    return { data: null, note: "attribution file is not valid JSON — ignoring it" };
  }
  const age = Date.now() - new Date(data.generatedAt ?? 0).getTime();
  if (!Number.isFinite(age) || age > ATTRIBUTION_TTL_MS) {
    return { data: null, note: `attribution is older than ${ATTRIBUTION_TTL_MS / 86_400_000}d — ignoring it` };
  }
  if (!data.bets || data.bets <= 0) {
    return { data: null, note: "no on-chain bets yet — tribal weights stay at the hand-tuned prior" };
  }
  return { data, note: `attribution live: ${data.bets} bets, leader=${data.leader ?? "none"}` };
}

let ATTR: Attribution | null = null;

/**
 * +2 for the tribe that took the most referred USDC, scaled down for the rest, +0 when there is
 * no signal. Matched on the same token list as the static +3 above, so a market can score both.
 */
function adaptiveBonus(pool: Pool): number {
  if (!ATTR || !ATTR.byTribe?.length) return 0;
  const top = Math.max(...ATTR.byTribe.map((t) => t.volumeUsdc));
  if (!(top > 0)) return 0;
  const title = pool.title.toLowerCase();
  const matched = ATTR.byTribe.filter((t) => title.includes(t.token.toLowerCase()));
  if (matched.length === 0) return 0;
  const best = Math.max(...matched.map((t) => t.volumeUsdc));
  return Math.round((best / top) * 2 * 10) / 10;
}

function tribalScore(pool: Pool, withAdaptive = true): number {
  const title = pool.title.toLowerCase();
  let score = 0;
  if (BATTLE_RE.test(pool.title)) score += 4;
  if (TRIBE_TOKENS.some((t) => title.includes(t))) score += 3;
  if (pool.marketData?.asset && pool.marketData.strikeUsd) {
    const spot = pool.marketData.spotUsd ?? 0;
    const dist = spot > 0 ? Math.abs((pool.marketData.strikeUsd - spot) / spot) : 1;
    if (dist < 0.08) score += 2; // strike within 8% of spot: a real coin flip
  }
  const traders = pool.traders ?? 0;
  const liquidity = Number(pool.liquidityUsdc ?? 0);
  if (traders > 0 && liquidity / traders > 120) score += 1;
  if (MACRO_RE.test(title)) score -= 3;
  if (withAdaptive) score += adaptiveBonus(pool);
  return score;
}

/**
 * ASCII share bar. Blocks, not emoji: an 8-cell bar of █/░ is one character per cell in JS length,
 * survives every client's font stack, and reads as data instead of decoration. Emoji would cost two
 * characters per cell and eat a fifth of the X budget.
 */
function bar(sharePct: number, cells = 8): string {
  const filled = Math.max(0, Math.min(cells, Math.round((sharePct / 100) * cells)));
  return "█".repeat(filled) + "░".repeat(cells - filled);
}

/** Both sides, always: one number is a stat, two numbers are a fight. */
function bothOdds(yes: number): { y: string; n: string } {
  return {
    y: (1 / Math.max(0.02, yes / 100)).toFixed(1),
    n: (1 / Math.max(0.02, (100 - yes) / 100)).toFixed(1),
  };
}

/** Battle-call copy: the version that reads like a side to pick, not a report to read. */
function battleTweet(pool: Pool): string | null {
  const yes = Math.round(yesShare(pool) * 100);
  const no = 100 - yes;
  const { y, n } = bothOdds(yes);
  const url = trackedUrl(pool.id, "x");
  const traders = pool.traders ?? 0;
  const left = closeIn(pool);

  // Longest first. The first draft that fits under 275 weighted characters wins, so a long market
  // title degrades into the compact version instead of being truncated mid-word.
  const drafts = [
    `🏴 ${clipped(pool.title, 64)}\n\nYES ${bar(yes)} ${yes}% → ${y}×\nNO\u00a0\u00a0${bar(no)} ${no}% → ${n}×\n\n${traders} already picked a side. ${left} left. The wrong side pays the right side.\n\n${url}`,
    `🏴 ${clipped(pool.title, 62)}\n\nYES ${bar(yes)} ${yes}% pays ${y}×\nNO\u00a0\u00a0${bar(no)} ${no}% pays ${n}×\n\n${traders} in · ${left} left · no house, no bailout.\n\n${url}`,
    `${yes}% YES · ${y}× — ${traders} already picked a side, ${left} left.\n\n${clipped(pool.title, 58)}\n\n${url}`,
    `${y}× on ${yes}% of the crowd. ${traders} are in.\n\n${clipped(pool.title, 56)}\n\n${url}`,
  ];
  for (const d of drafts) {
    const text = `${d}\n${X_HANDLE}`;
    if (weight(text) <= 275) return text;
  }
  return null;
}

function rank(pools: Pool[], pick: Args["pick"]): Pool[] {
  const alive = pools.filter((p) => !poolClosed(p));
  if (pick === "tribal") {
    return [...alive].sort((a, b) => {
      const d = tribalScore(b) - tribalScore(a);
      return d !== 0 ? d : (b.traders ?? 0) - (a.traders ?? 0);
    });
  }
  if (pick === "expiry") {
    return [...alive].sort(
      (a, b) => new Date(a.endTimeUtc ?? 8.64e15).getTime() - new Date(b.endTimeUtc ?? 8.64e15).getTime(),
    );
  }
  if (pick === "tvl") {
    return [...alive].sort((a, b) => Number(b.liquidityUsdc ?? 0) - Number(a.liquidityUsdc ?? 0));
  }
  // movers: the side that pays the most — longest odds first, traders as the tie-break.
  return [...alive].sort((a, b) => {
    const pa = 1 / Math.max(0.02, yesShare(a));
    const pb = 1 / Math.max(0.02, yesShare(b));
    if (Math.abs(pb - pa) > 0.05) return pb - pa;
    return (b.traders ?? 0) - (a.traders ?? 0);
  });
}

function tweetFor(pool: Pool): string {
  // A fight gets the battle copy; a macro print keeps the analytical one. Same numbers either way.
  if (tribalScore(pool) >= 4) {
    const battle = battleTweet(pool);
    if (battle) return battle;
  }
  const yes = Math.round(yesShare(pool) * 100);
  const no = 100 - yes;
  const mult = (1 / Math.max(0.02, yes / 100)).toFixed(1);
  const traders = pool.traders ?? 0;
  const url = trackedUrl(pool.id, "x");
  const lead = pool.marketData?.asset
    ? `${pool.marketData.asset} at ${price(pool.marketData.spotUsd ?? 0)} right now.`
    : `Closes in ${closeIn(pool)}.`;

  const options = [
    `The crowd is paying ${mult}× on one side of this market:\n\n"${clipped(pool.title, 70)}"\n\nYES ${bar(yes)} ${yes}% · ${no}% NO\n${traders} traders in · ${lead}`,
    `Still ${closeIn(pool)} left to take a side:\n\n"${clipped(pool.title, 70)}"\n\nYES ${bar(yes)} ${yes}% pays ${mult}× · ${traders} in.`,
    `Two AI agents argued this one and the crowd split ${yes}/${no}:\n\n"${clipped(pool.title, 66)}"\n\nYES pays ${mult}×. ${lead}`,
  ];

  for (const draft of options) {
    const text = `${draft}\n${url}\n${X_HANDLE}`;
    if (weight(text) <= 275) return text;
  }
  return `${clipped(pool.title, 60)}\n${yes}% YES pays ${mult}×.\n${url}\n${X_HANDLE}`;
}

/** Farcaster: 320 characters, links counted at full length, frame renders the card inline. */
function castFor(pool: Pool): string {
  const yes = Math.round(yesShare(pool) * 100);
  const no = 100 - yes;
  const { y, n } = bothOdds(yes);
  const url = trackedUrl(pool.id, "farcaster");
  const spot = pool.marketData?.asset
    ? `${pool.marketData.asset} ${price(pool.marketData.spotUsd ?? 0)} now`
    : `closes in ${closeIn(pool)}`;

  const full = `🏴 ${clipped(pool.title, 66)}\n\nYES ${bar(yes)} ${yes}% · ${y}×\nNO\u00a0\u00a0${bar(no)} ${no}% · ${n}×\n${pool.traders ?? 0} in · ${spot}\n\n${url}`;
  if (full.length <= 320) return full;
  const mid = `🏴 ${clipped(pool.title, 54)}\n\nYES ${bar(yes)} ${yes}% · ${y}× · ${pool.traders ?? 0} in\n\n${url}`;
  if (mid.length <= 320) return mid;
  return `🏴 ${clipped(pool.title, 44)}\n\n${yes}% YES · ${y}×\n${url}`;
}

function telegramFor(pool: Pool): string {
  const yes = Math.round(yesShare(pool) * 100);
  const no = 100 - yes;
  const { y, n } = bothOdds(yes);
  const url = trackedUrl(pool.id, "telegram");
  return [
    `🏴 DAILY BOARD — ${new Date().toISOString().slice(0, 10)}`,
    "",
    `🔥 ${pool.title}`,
    `YES ${bar(yes)} ${yes}% · pays ${y}×`,
    `NO\u00a0\u00a0${bar(no)} ${no}% · pays ${n}×`,
    `${pool.traders ?? 0} traders · ${money(Number(pool.liquidityUsdc ?? 0))} liquidity · ${closeIn(pool)} left`,
    "",
    `Take a side → ${url}`,
    "",
    // The affiliate flywheel. Wording is deliberately narrow: the contract pays the referrer a cut
    // of the rake, it does not pay a commission rate we can promise, and nobody here can mint it.
    "🧑‍💼 CAPTAIN PROGRAM — copy your referral link from the portfolio drawer (Portfolio → Invite & Earn),",
    "share this market, and automatically earn a cut of the 4% platform fee on-chain.",
    "Mechanically: the arena credits the referrer 30% of that 4% rake per referred position, paid by the contract at settlement — not by us, and not out of anyone's stake.",
    "",
    `Only official links: ${SITE} · x.com/Predict065 · t.me/predictionarena_hq`,
    `Contract: 0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5 (Base, v3)`,
  ].join("\n");
}

type Post = {
  id: string | number;
  title: string;
  pick: Args["pick"];
  tweet: string;
  tweetWeight: number;
  cast: string;
  castChars: number;
  telegram: string;
  links: { x: string; farcaster: string; telegram: string };
  /** Why this market outranked the others — auditable instead of "the bot felt like it". */
  tribal: { base: number; adaptive: number; total: number; leader: string | null };
  generatedAt: string;
};

function build(pool: Pool, pick: Args["pick"]): Post {
  const tweet = tweetFor(pool);
  const cast = castFor(pool);
  const base = tribalScore(pool, false);
  const total = tribalScore(pool);
  return {
    id: pool.id,
    title: pool.title,
    pick,
    tweet,
    tweetWeight: weight(tweet),
    cast,
    castChars: cast.length,
    telegram: telegramFor(pool),
    links: {
      x: trackedUrl(pool.id, "x"),
      farcaster: trackedUrl(pool.id, "farcaster"),
      telegram: trackedUrl(pool.id, "telegram"),
    },
    tribal: { base, adaptive: Math.round((total - base) * 10) / 10, total, leader: ATTR?.leader ?? null },
    generatedAt: new Date().toISOString(),
  };
}

/** ISO week key, e.g. 2026-W44 — matches how the schedule file is named. */
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Market ids already archived today. Two slots a day means the second run would otherwise feature
 * the same top-scoring tribal market as the first — the channel repeating itself is the failure
 * mode the schedule comment warned about, so the picker skips what it already posted today.
 */
function archivedToday(): Set<string> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const parsed = JSON.parse(readFileSync(join(CAMPAIGNS, day, "index.json"), "utf8")) as {
      posts?: { id: string | number }[];
    };
    return new Set((parsed.posts ?? []).map((p) => String(p.id)));
  } catch {
    return new Set();
  }
}

/**
 * Archive the generated copy. One folder per day so a post can be traced to the bot run that
 * produced it, plus a week file that is the schedule a human actually reads on Monday.
 */
function archive(posts: Post[]): string[] {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const dir = join(CAMPAIGNS, day);
  mkdirSync(dir, { recursive: true });

  const written: string[] = [];
  for (const post of posts) {
    const base = join(dir, String(post.id));
    writeFileSync(`${base}-x.txt`, `${post.tweet}\n`, "utf8");
    writeFileSync(`${base}-cast.txt`, `${post.cast}\n`, "utf8");
    writeFileSync(`${base}-telegram.txt`, `${post.telegram}\n`, "utf8");
    written.push(`${base}-x.txt`, `${base}-cast.txt`, `${base}-telegram.txt`);
  }

  // Merge, do not replace: the evening run used to overwrite the morning run's index.json, which
  // silently deleted the only record of what was posted at 09:10 and re-enabled the duplicate pick.
  const indexPath = join(dir, "index.json");
  let prior: Post[] = [];
  try {
    const parsed = JSON.parse(readFileSync(indexPath, "utf8")) as { posts?: Post[] };
    prior = (parsed.posts ?? []).filter((p) => !posts.some((q) => String(q.id) === String(p.id)));
  } catch {
    prior = [];
  }
  const merged = [...prior, ...posts].sort((a, b) => (a.generatedAt < b.generatedAt ? -1 : 1));
  writeFileSync(indexPath, JSON.stringify({ day, posts: merged }, null, 2), "utf8");
  written.push(indexPath);

  const week = isoWeek(now);
  const weekFile = join(CAMPAIGNS, `${week}.md`);
  let existing = "";
  try {
    existing = readFileSync(weekFile, "utf8");
  } catch {
    existing = `# Campaign week ${week}\n\nAuto-generated by scripts/auto-market.ts --write. One row per market; copy lives in the day folder.\n\n| Generated | Market | Pick | Tweet | Cast |\n|---|---|---|---|---|\n`;
  }
  const rows = posts
    .map(
      (p) =>
        `| ${p.generatedAt.slice(0, 16).replace("T", " ")}Z | ${p.title.replace(/\\|/g, "\\\\|")} | ${p.pick} | ${p.tweetWeight}/280 | ${p.castChars}/320 |`,
    )
    .join("\n");
  writeFileSync(weekFile, `${existing}${rows}\n`, "utf8");
  written.push(weekFile);
  return written;
}


/**
 * OAuth 1.0a (HMAC-SHA1) for X API v2.
 *
 * X still requires a *user context* to post, and the only user-context credential a solo operator
 * can mint without a browser round-trip is the four-part OAuth 1.0a key set. The app-only bearer we
 * were given first can only read, which is why `sendX` tries OAuth 1.0a first and only falls back
 * to the bearer for a clearly-worded error.
 *
 * Signing rules that bite if you get them wrong:
 *  - the base string is `METHOD & percentEncode(url) & percentEncode(sorted param string)`;
 *  - a JSON body contributes **no** parameters — only `oauth_*` values and the query string do;
 *  - percent encoding is RFC 3986 (encodeURIComponent plus `!'()*`), not encodeURIComponent alone;
 *  - the signing key is `percentEncode(consumerSecret) & percentEncode(tokenSecret)`.
 */
function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function oauthHeader(method: string, url: string, creds: {
  key: string;
  secret: string;
  token: string;
  tokenSecret: string;
}): string {
  const params: Record<string, string> = {
    oauth_consumer_key: creds.key,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.token,
    oauth_version: "1.0",
  };

  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${pct(k)}=${pct(params[k])}`)
    .join("&");
  const base = `${method.toUpperCase()}&${pct(url)}&${pct(paramString)}`;
  const signingKey = `${pct(creds.secret)}&${pct(creds.tokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(base).digest("base64");

  const header = { ...params, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(header)
      .sort()
      .map((k) => `${pct(k)}="${pct(header[k])}"`)
      .join(", ")
  );
}

/** The four-part key set, or null when the environment only carries a bearer. */
function xOauthCreds(): { key: string; secret: string; token: string; tokenSecret: string } | null {
  const key = process.env.X_CONSUMER_KEY;
  const secret = process.env.X_CONSUMER_SECRET;
  const token = process.env.X_ACCESS_TOKEN;
  const tokenSecret = process.env.X_ACCESS_SECRET;
  if (!key || !secret || !token || !tokenSecret) return null;
  return { key, secret, token, tokenSecret };
}

/**
 * One POST with retries. A cron job is not a person: if a 429 or a 502 kills the run, the day's
 * post is simply missing, and nobody notices until the channel has been quiet for a week.
 */
async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  let last = { ok: false, status: 0, text: "no attempt" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
      const text = await res.text();
      last = { ok: res.ok, status: res.status, text };
      if (res.ok || (res.status !== 429 && res.status < 500)) return last;
    } catch (err) {
      last = { ok: false, status: 0, text: (err as Error).message };
    }
    await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
  }
  return last;
}

/**
 * X needs a *user-context* credential. An app-only bearer can read but not post — the API answers
 * 403 "Unsupported Authentication" — so the failure is reported as a configuration problem with
 * the exact fix, instead of a generic 403. The other channels still go out.
 */
async function sendX(text: string): Promise<string> {
  const url = "https://api.x.com/2/tweets";
  const oauth = xOauthCreds();
  const token = process.env.X_BEARER_TOKEN ?? process.env.X_OAUTH2_BEARER;
  if (!oauth && !token) return "skipped: no X credential (need the 4 OAuth 1.0a keys or a user bearer)";

  // OAuth 1.0a first: it is the only credential here that can actually publish.
  const res = await postJson(
    url,
    oauth ? { Authorization: oauthHeader("POST", url, oauth) } : { Authorization: `Bearer ${token}` },
    { text },
  );

  if (res.ok) {
    const id = (() => {
      try {
        return (JSON.parse(res.text) as { data?: { id?: string } }).data?.id ?? "";
      } catch {
        return "";
      }
    })();
    return `sent${id ? `: ${id}` : ""}`;
  }

  if (res.status === 403 && /unsupported authentication|application-only/i.test(res.text)) {
    return "skipped: the configured X credential is an app-only bearer (read-only). Set X_CONSUMER_KEY/X_CONSUMER_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET for OAuth 1.0a — see docs/GROWTH_MILESTONE_1K_30.md §6.";
  }
  if (res.status === 401) return "failed 401: token invalid or expired";
  if (res.status === 429) return "failed 429: rate limited after 3 attempts";
  return `failed ${res.status}: ${res.text.slice(0, 200)}`;
}

async function sendTelegram(text: string): Promise<string> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID ?? "@predictionarena_hq";
  if (!token) return "skipped: TELEGRAM_BOT_TOKEN unset";

  const res = await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {}, {
    chat_id: chat,
    text,
    // No parse_mode: market titles are user-facing text and a stray & or < would make Telegram
    // reject the whole message with "can't parse entities".
    disable_web_page_preview: false,
  });

  if (res.ok) return "sent";
  if (res.status === 403) {
    return "failed 403: the bot is not an admin of the channel — add it under Channel → Administrators (docs/GROWTH_MILESTONE_1K_30.md §6).";
  }
  return `failed ${res.status}: ${res.text.slice(0, 200)}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const pools = loadPools();
  if (pools.length === 0) {
    console.error("no open markets in the manifest");
    process.exit(1);
  }

  const attribution = loadAttribution();
  ATTR = attribution.data;

  // `--pick=tribal` is the flagship slot, and it runs twice a day. Skip whatever today's archive
  // already featured so the 17:10 run is the *next* tribal fight instead of a repost. If every
  // market has been used (a very thin board), fall back to the full ranking — a repeat beats silence.
  let ranked = rank(pools, args.pick);
  let skippedToday = 0;
  if (args.pick === "tribal") {
    const seen = archivedToday();
    const fresh = ranked.filter((p) => !seen.has(String(p.id)));
    if (fresh.length > 0) {
      skippedToday = ranked.length - fresh.length;
      ranked = fresh;
    }
  }

  const picked = ranked.slice(0, args.limit);
  const posts = picked.map((p) => build(p, args.pick));

  const results: Record<string, unknown>[] = [];
  for (const post of posts) {
    const row: Record<string, unknown> = { ...post };
    if (args.send) {
      row.x = await sendX(post.tweet);
      row.telegramSend = await sendTelegram(post.telegram);
      // Farcaster has no public post API for bots without a signer; the cast is archived for a human
      // (or a Warpcast signer) to send, which is why it is written to disk rather than "posted".
    }
    results.push(row);
  }

  const files = args.write ? archive(posts) : [];

  if (args.json) {
    console.log(JSON.stringify({ site: SITE, attribution: { ...attribution, data: ATTR }, posts: results, files }, null, 2));
    return;
  }

  console.log(`\n[attribution] ${attribution.note}`);
  if (skippedToday > 0) {
    console.log(`[schedule] skipped ${skippedToday} market(s) already featured today — the next tribal fight is on deck`);
  }

  results.forEach((r) => {
    const p = r as unknown as Post & { x?: string; telegramSend?: string };
    console.log(`\n=== market ${p.id} — ${p.title}`);
    console.log(
      `--- tribal ${p.tribal.total} (prior ${p.tribal.base}${p.tribal.adaptive ? ` + attribution ${p.tribal.adaptive}` : ""})${p.tribal.leader ? ` · ledger leader ${p.tribal.leader}` : ""}`,
    );
    console.log(`--- X (${p.tweetWeight}/280 weighted)`);
    console.log(p.tweet);
    console.log(`--- Farcaster (${p.castChars}/320)`);
    console.log(p.cast);
    console.log("--- Telegram");
    console.log(p.telegram);
    if (p.x) console.log(`--- x: ${p.x}`);
    if (p.telegramSend) console.log(`--- telegram: ${p.telegramSend}`);
  });
  if (files.length > 0) console.log(`\narchived ${files.length} files under docs/campaigns/`);
  if (!args.send) console.log("\n(dry run — pass --send with credentials to publish, --write to archive)");

  // A cron run must not fail the workflow because one channel is unconfigured: the next tick is
  // hours away and the post is lost either way. --strict flips this for local use.
  if (args.send) {
    const xStatus = results.map((r) => String(r.x ?? ""));
    const tgStatus = results.map((r) => String(r.telegramSend ?? ""));
    console.log(`\nsummary: x=${xStatus.join("|")} telegram=${tgStatus.join("|")}`);
    const hardFail = [...xStatus, ...tgStatus].some((s) => s.startsWith("failed"));
    if (hardFail && process.argv.includes("--strict")) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
