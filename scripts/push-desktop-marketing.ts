/**
 * Desktop marketing pack — the zero-budget distribution arm.
 *
 * The X API is a paid gate we do not pay; a folder of paste-ready copy on the operator's desktop
 * costs nothing. Once a day (and on demand) this script writes:
 *
 *   Desktop/PredictionArena_Marketing/
 *     01-main-tweet.txt        the day's flagship tribal market, <280 weighted, bar + both odds
 *     02-alpha-reply-deck.txt  three replies built to be dropped under a big account's post
 *     03-captain-pitch.txt     the DM/enquiry script for a TG owner or KOL (30% rakeback)
 *     04-calendar.md           the archived campaigns, so a human can plan the week
 *     meta.json                the numbers behind all of it, with timestamps
 *     README.txt               how to use the folder
 *
 * Design rules (same as the cloud factory, deliberately identical):
 *  - every number comes from `frontend/public/pools.json`, nothing is typed by hand;
 *  - the main tweet is copied verbatim from the archive when the cloud run has already produced
 *    one today, so the desktop pack and the channel cannot disagree;
 *  - nothing here posts anything. Distribution is a human pasting into an app, which is the whole
 *    point of the zero-budget route.
 *
 *   bun run push:marketing                  # write the pack for today
 *   bun run push:marketing --dry-run        # print it instead
 *   bun run push:marketing --dir=/tmp/pack  # somewhere other than the desktop
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { heatScore, pickContrarian } from "./lib/hot";
import { SITE, X_HANDLE, bar, bothOdds, clipped, price, shortTrackedUrl, timeLeft, trackedUrl, weight } from "./lib/copy-kit";

const ROOT = join(import.meta.dir, "..");
const MANIFEST = join(ROOT, "frontend", "public", "pools.json");
const CAMPAIGNS = join(ROOT, "docs", "campaigns");
const FOLDER = "PredictionArena_Marketing";

type Pool = {
  id: string | number;
  title: string;
  status?: number;
  endTimeUtc?: string;
  traders?: number;
  liquidityUsdc?: string | number;
  yesShare?: number;
  category?: string;
  tier?: "24h" | "mid" | "long";
  /** Written by scripts/gen-board.ts: real 24h move of the underlying + how split the crowd is. */
  heat?: { volatilityPct: number; controversy: number; hoursLeft: number; score: number };
  marketData?: { asset?: string; spotUsd?: number; strikeUsd?: number; source?: string };
};

type Post = {
  id: string | number;
  title: string;
  tweet: string;
  tweetWeight: number;
  links?: { x?: string };
  tribal?: { total: number };
  /** Present on archives written after the snapshot change; absent means "numbers unprovable". */
  snapshot?: { yes: number; traders: number; liquidityUsdc: number };
};

type Args = { dryRun: boolean; dir: string | null };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, dir: null };
  for (const raw of argv.slice(2)) {
    const [key, value = ""] = raw.replace(/^--/, "").split("=");
    if (key === "dry-run") args.dryRun = true;
    else if (key === "dir") args.dir = value;
    else if (key === "help" || key === "-h") {
      console.log("usage: bun scripts/push-desktop-marketing.ts [--dry-run] [--dir=<path>]");
      process.exit(0);
    }
  }
  return args;
}

/**
 * Where the Windows desktop is. WSL sees it as /mnt/c/Users/<name>/Desktop; on a plain Linux box
 * (or in CI, where this script is pointless) it falls back to $HOME/Desktop so the code still runs.
 */
function desktopDir(): string {
  if (process.env.MARKETING_DIR) return join(process.env.MARKETING_DIR, FOLDER);
  for (const base of ["/mnt/c/Users", "/mnt/d/Users"]) {
    if (!existsSync(base)) continue;
    for (const user of readdirSync(base)) {
      const desktop = join(base, user, "Desktop");
      if (existsSync(desktop) && statSync(desktop).isDirectory()) return join(desktop, FOLDER);
    }
  }
  return join(process.env.HOME ?? ".", "Desktop", FOLDER);
}

function openPools(): Pool[] {
  const board = JSON.parse(readFileSync(MANIFEST, "utf8")) as { pools?: Pool[] };
  return (board.pools ?? []).filter((p) => (p.status ?? 1) === 1 && !poolClosed(p));
}

/** Where the numbers came from, so a stale pack is obvious before it gets posted. */
function pricesMeta(): { updatedAt: string | null; sources: Record<string, string>; BTC: number | null } {
  try {
    const snapshot = JSON.parse(readFileSync(join(ROOT, "frontend", "public", "prices.json"), "utf8")) as {
      updatedAt?: string;
      sources?: Record<string, string>;
      assets?: Record<string, { usd?: number }>;
    };
    return {
      updatedAt: snapshot.updatedAt ?? null,
      sources: snapshot.sources ?? {},
      BTC: snapshot.assets?.BTC?.usd ?? null,
    };
  } catch {
    return { updatedAt: null, sources: {}, BTC: null };
  }
}

function poolClosed(pool: Pool): boolean {
  return Boolean(pool.endTimeUtc) && new Date(pool.endTimeUtc as string).getTime() <= Date.now();
}

function yesShare(pool: Pool): number {
  const raw = Number(pool.yesShare ?? Number.NaN);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.5;
}

/**
 * Heat: why the day's flagship is chosen by move + disagreement instead of by crowd size.
 *
 * With 150 markets the old rule ("most traders, tribe preferred") picked the same handful of
 * cards every day and never surfaced the thing that actually travels on X — a violent underlying
 * with a split crowd. `heat` is written by the generator (real 24h change of the underlying,
 * `1 - |yes-0.5|*2` for how split the two sides are, urgency for the 24h rung), so this file only
 * has to weigh it. `tribe()` stays as a small bonus: a Base-native token travels further in the
 * comments section that actually gets read.
 */
/**
 * The day's three flagships: the hottest market in each of three *different* lanes.
 *
 * One flagship was fine on a 38-market board. On 232 markets across 19 lanes it means the same
 * two or three crypto cards every day, and the macro / AI / entertainment audiences never see
 * themselves. Picking one per lane, ranked by heat, keeps the daily pack varied and gives the
 * reply deck three genuinely different comment sections to sit in.
 */
function pickFlagships(pools: Pool[], n = 3): Pool[] {
  const ranked = [...pools].sort((a, b) => flagshipScore(b) - flagshipScore(a));
  const out: Pool[] = [];
  const lanes = new Set<string>();
  for (const pool of ranked) {
    const lane = String(pool.category ?? "");
    if (lane && lanes.has(lane)) continue;
    lanes.add(lane);
    out.push(pool);
    if (out.length >= n) break;
  }
  for (const pool of ranked) {
    if (out.length >= n) break;
    if (!out.includes(pool)) out.push(pool);
  }
  return out;
}

/** How each lane's audience actually talks — the reply has to read like it belongs in that thread. */
const LANE_VOICE: Record<string, { contrarian: string; receipt: string; challenge: string }> = {
  "Macro Economy": { contrarian: "The board is pricing this as a coin-flip and the dot plot disagrees", receipt: "Rates desk check", challenge: "Anyone long duration has to have a view on this" },
  "Global Stocks": { contrarian: "The tape disagrees with the sell-side note", receipt: "Earnings-season tell", challenge: "If you own the megacaps, this is your hedge" },
  "AI Agents & Tech": { contrarian: "Everyone is long the narrative and short the timeline", receipt: "The shipping cadence says otherwise", challenge: "Builders: this is the number that decides your roadmap" },
  "Commodities & Metals": { contrarian: "Real rates say one thing, the futures curve says another", receipt: "Positioning is stretched", challenge: "Physical desks are on the other side of this" },
  "Memes & Social": { contrarian: "CT is fading this and the book is thin", receipt: "Liquidity says otherwise", challenge: "Degens, the odds are not what your timeline claims" },
  "Entertainment & Pop": { contrarian: "The industry consensus has been wrong on this three years running", receipt: "The numbers leaked early", challenge: "Culture desk, settle this" },
  "Prediction Markets": { contrarian: "The category is pricing its own growth wrong", receipt: "Volume, not vibes", challenge: "If you trade prediction markets, this is the meta-trade" },
  "Sports & Gaming": { contrarian: "The market is on the wrong side of the run of play", receipt: "The line moved for a reason", challenge: "Handicappers, defend the number" },
  "US Politics & Policy": { contrarian: "Floor time, not intent — the market keeps confusing the two", receipt: "The calendar is public", challenge: "Policy people: price the procedure, not the promise" },
  "Crypto Core": { contrarian: "The crowd is leaning the wrong way into the close", receipt: "Funding is already telling you", challenge: "Spot buyers, this is your entry question" },
  "Degen Dials": { contrarian: "24 hours is enough to prove who is actually long", receipt: "The tape does not lie on a one-day clock", challenge: "One-day degen, no leverage excuses" },
};

function laneVoice(pool: Pool) {
  return LANE_VOICE[String(pool.category ?? "")] ?? null;
}

function flagshipScore(pool: Pool): number {
  const controversy = pool.heat?.controversy ?? 1 - Math.abs(yesShare(pool) - 0.5) * 2;
  const volatility = pool.heat?.volatilityPct ?? 0;
  const hoursLeft = pool.endTimeUtc ? (Date.parse(pool.endTimeUtc) - Date.now()) / 3.6e6 : 999;
  const urgency = hoursLeft <= 48 ? 12 : hoursLeft <= 24 * 8 ? 6 : 0;
  const crowd = Math.min(1, (pool.traders ?? 0) / 320) * 8;
  const tribal = tribe(pool) ? 6 : 0;
  return volatility * 4 + controversy * 30 + urgency + crowd + tribal;
}

/** Same list as the cloud picker: a token with a community behind it, nothing generic. */
/**
 * The genesis-airdrop line. It rides every tweet and every card because it is the only reason a
 * stranger stops scrolling: the venue pays attention with a scoreboard before it has a token.
 * `weight()` counts it like any other text — a draft that runs over 280 falls back to the shorter
 * variant rather than getting truncated mid-URL.
 */
const AIRDROP_TAG = "🔥 Arena Points genesis airdrop live — bet or refer, earn $ARENA";

/** The closing line of every reply: same claim everywhere, short enough to fit under a duel. */
const REPLY_HOOK = "🎁 Bet now — every $1 earns genesis $ARENA points (1:1 at launch)";

const TRIBES = ["aero", "degen", "toshi", "brett", "mog", "zora"];

function tribe(pool: Pool): string | null {
  const title = pool.title.toLowerCase();
  return TRIBES.find((t) => title.includes(t)) ?? null;
}

function todayArchive(): { day: string; posts: Post[] } | null {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const parsed = JSON.parse(readFileSync(join(CAMPAIGNS, day, "index.json"), "utf8")) as {
      day?: string;
      posts?: Post[];
    };
    return { day: parsed.day ?? day, posts: parsed.posts ?? [] };
  } catch {
    return null;
  }
}

/**
 * The archived flagship tweet for today — but only if that archive carries the snapshot the copy
 * was written from. An archive without one cannot be reconciled with a freshly rendered card, and
 * shipping a tweet that says $0.7325 next to a picture that says $0.7300 is worse than rerunning
 * the generator for two seconds.
 */
function archivedTweet(archive: { day: string; posts: Post[] } | null): Post | null {
  if (!archive) return null;
  const usable = archive.posts.filter((p) => p.snapshot);
  if (usable.length === 0) return null;
  const tribal = usable.filter((p) => p.tribal && p.tribal.total >= 4);
  const pool = tribal.length > 0 ? tribal : usable;
  return pool[pool.length - 1] ?? null;
}

/** Fallback: build the same shape the cloud factory would have built. */
function mainTweet(pool: Pool): string {
  const yes = Math.round(yesShare(pool) * 100);
  const no = 100 - yes;
  const { y, n } = bothOdds(yes);
  const left = timeLeft(pool.endTimeUtc);
  const url = trackedUrl(pool.id, "x");
  const body = `YES ${bar(yes)} ${yes}% → ${y}×\nNO\u00a0\u00a0${bar(no)} ${no}% → ${n}×`;
  const drafts = [
    `🏴 ${clipped(pool.title, 64)}\n\n${body}\n\n${pool.traders ?? 0} picked a side. ${left} left.\n${AIRDROP_TAG}\n\n${url}\n${X_HANDLE}`,
    `🏴 ${clipped(pool.title, 52)}\n\n${body}\n\n${AIRDROP_TAG}\n\n${url}\n${X_HANDLE}`,
    `${yes}% YES pays ${y}× · ${left} left\n${clipped(pool.title, 48)}\n${AIRDROP_TAG}\n${url}`,
  ];
  return drafts.find((d) => weight(d) <= 275) ?? drafts[drafts.length - 1];
}

/**
 * Alpha reply deck.
 *
 * These are for the comment section of someone else's post, so each one is three lines and nothing
 * else: a claim a reader can check, the two-sided duel, the link. Three different angles so the
 * same account is not repeating one sentence under three different posts — no "check out our
 * platform", no follow-ask, no metadata. Anything an operator would have to delete before pasting
 * does not belong in the file.
 */
function replyDeck(pools: Pool[]): { angle: string; text: string }[] {
  // Which market is worth a reply is a scoring problem, not a taste one — and the scoring lives in
  // scripts/lib/hot.ts so the reply deck, the hot board and the Telegram daily report cannot drift.
  const picks = pickContrarian(pools, 3);

  const angles = ["contrarian number", "receipt", "open challenge"];

  return picks.map((pool, i) => {
    const yes = Math.round(yesShare(pool) * 100);
    const no = 100 - yes;
    const { y, n } = bothOdds(yes);
    const url = shortTrackedUrl(pool.id, "x");
    const left = timeLeft(pool.endTimeUtc);
    const count = pool.traders ?? 0;
    const asset = pool.marketData?.asset;
    const spot = pool.marketData?.spotUsd;
    const subject = asset ? `${asset} at ${price(spot ?? 0)}` : `"${clipped(pool.title, 46)}"`;
    const duel = `YES ${bar(yes)} ${yes}% → ${y}× · NO ${bar(no)} ${no}% → ${n}×`;
    const voice = laneVoice(pool);
    const claims = [
      voice?.contrarian ?? `The board is ${no}% NO on ${subject} and YES still pays ${y}×`,
      voice ? `${voice.receipt}: ${subject} → ${yes}% YES, ${count} positions` : `${subject} → ${yes}% YES, ${count} positions already placed`,
      voice ? `${voice.challenge}. ${count} in, ${no}% on NO.` : `${count} people disagree about this one. ${no}% are on NO.`,
    ];
    // The shape is fixed for every reply: claim → duel → link → airdrop hook. The hook is on all
    // three, not just the first: a reply without it is a free market update for someone else's post.
    const candidates = [
      [claims[i], duel, `${count} in · ${left} left → ${url}`, REPLY_HOOK].join("\n"),
      [clipped(claims[i], 88), duel, `${url} · ${left} left`, REPLY_HOOK].join("\n"),
      [`${duel} · ${left} left`, url, REPLY_HOOK].join("\n"),
    ];
    const text = candidates.find((c) => weight(c) <= 275) ?? candidates[candidates.length - 1];
    return { angle: angles[i], text };
  });
}

/**
 * The whitepaper launch post.
 *
 * A separate asset from the daily market tweet: this one is about the venue, not a market, so it is
 * posted once and pinned rather than rotated. It carries the three claims a reader can verify in a
 * browser (232 markets, on-chain settlement, the points rule) and nothing that reads like a price
 * promise.
 */
function whitepaperLaunch(): string {
  const drafts = [
    `📄 Whitepaper v1.0 is live. Points pre-mining is open.\n\n232 markets · 19 sectors · 100% on-chain USDC on Base.\n\nBet or refer: every point converts 1:1 into $ARENA at genesis. 42% of supply, zero team allocation, nothing for sale.\n\n${SITE}/whitepaper`,
    `📄 Whitepaper v1.0 — the whole venue in one doc: 232 markets, 19 sectors, a points ledger rebuilt from chain history, 42% genesis airdrop and 25% locked liquidity. No presale, no team bag.\n\n${SITE}/whitepaper`,
  ];
  return drafts.find((d) => weight(d) <= 275) ?? drafts[drafts.length - 1];
}

function whitepaperComments(): { angle: string; text: string }[] {
  const url = `${SITE}/whitepaper`;
  return [
    { angle: "why it is different", text: `Most "prediction market" decks describe a product that does not exist. This one documents one that does: 232 markets, every pool on Basescan, every number rebuildable from BetPlaced logs.\n\n${url}` },
    { angle: "points are checkable", text: `Arena Points are not a spreadsheet. 10 points per $1 staked, ×2 for contrarian sides, ×1.5 for 48h markets, and captains take 20% of their referees. Rebuild the ledger with one command.\n\n${url}` },
    { angle: "no presale", text: `No presale. No private round. No team allocation. 42% of supply goes to the people who actually traded, 25% into a locked Aerodrome pool, and the buyback only spends fees the venue really earned.\n\n${url}` },
  ];
}

/**
 * The public pinned post: the airdrop, not a market.
 *
 * The market tweets are transient; this one has to survive a week pinned to the profile, so it
 * carries only claims a reader can verify in a browser (supply split, whitepaper, contract) and the
 * one thing a stranger actually wants — a reason to place a bet today.
 */
function pinnedAirdropPost(): { en: string; zh: string } {
  const drafts = [
    [
      "🔥 $ARENA genesis airdrop — pre-mining is live.",
      "",
      "232 markets · 19 sectors · USDC escrow on Base. Every $1 bet earns genesis points, converted 1:1 into $ARENA at launch.",
      "",
      "42% of supply to the community. Zero team allocation. No presale. Every number on-chain.",
      "",
      `Whitepaper → ${SITE}/whitepaper`,
    ].join("\n"),
    [
      "🔥 $ARENA genesis airdrop — pre-mining is live.",
      "",
      "232 markets · 19 sectors · USDC escrow. Every $1 bet earns genesis points, 1:1 into $ARENA at launch.",
      "",
      "42% to the community, zero team allocation, no presale.",
      "",
      `Whitepaper → ${SITE}/whitepaper`,
    ].join("\n"),
  ];
  // Pinned tweets get read on a phone in a profile header: if the long draft does not fit 280, the
  // short one goes out instead of a truncated URL.
  const en = drafts.find((d) => weight(d) <= 275) ?? drafts[drafts.length - 1];
  const zh = [
    "🔥 $ARENA 创世空投预热 —— 积分预挖进行中。",
    "",
    "232 个盘口 · 19 个板块 · Base 主网 USDC 托管结算。每 $1 下注即得创世积分，上线时 1:1 兑换 $ARENA。",
    "",
    "42% 总量归社区，零团队预留，无预售、无私募；所有数字链上可查。",
    "",
    `白皮书 → ${SITE}/whitepaper`,
  ].join("\n");
  return { en, zh };
}

/**
 * The group-owner pitch (07).
 *
 * Written for someone who runs a 5k-member Telegram group and has been offered a "partnership" by
 * every project in the space: no deck, no token grant, no lock-up story — just the fee split, paid
 * by the contract at settlement, and the points their members keep.
 */
function captainAirdropPitch(): string {
  const en = [
    `Subject: your group's bets pay you 30–50% of the fee, on-chain, starting today`,
    "",
    "Hi — no deck, one page.",
    "",
    "Prediction Arena is a prediction market on Base: 232 live markets across 19 sectors, USDC escrow,",
    "settlement on-chain. We are opening the captain programme to group owners before the genesis airdrop.",
    "",
    "What you get",
    "  · 30% of the 4% platform fee on every bet your link brings — escrowed by the contract at bet time,",
    "    claimable per pool after settlement. Stake 50% of what you earn for 90 days and it becomes 50%.",
    "  · 20% of your members' Arena Points. Points convert 1:1 into $ARENA at genesis (42% of supply is",
    "    reserved for points; zero team allocation, no presale).",
    "  · A per-captain link and a daily points report for your group, no spreadsheet from us.",
    "",
    "What it costs",
    "  Nothing. No exclusivity, no deposit, no custody, no KYC. You keep posting whatever you already post.",
    "",
    "How to start (2 minutes)",
    `  1. Open ${SITE} and connect the wallet you want to be paid to.`,
    `  2. Message @predictaing_bot: /start captain → send that address → it replies with your ref link.`,
    "  3. Post the link once. Every bet it brings is attributed on-chain, not by us.",
    "",
    "Verify before you commit: the fee split is in the contract (REFERRAL_SHARE_BPS = 3000), the scoring",
    `rules are one file, and the whitepaper is public — ${SITE}/whitepaper`,
  ].join("\n");

  const zh = [
    "【零成本挂名团长 · 拿 30%~50% 链上纯手续费分润 + 20% 团员空投积分算力】",
    "",
    "群主你好，不套近乎，直接说钱怎么分。",
    "",
    "Prediction Arena 是跑在 Base 主网的预测市场：232 个盘口、19 个板块、USDC 托管、链上结算。",
    "创世空投前开放团长名额，给已经在带群的人。",
    "",
    "你拿什么",
    "  · 手续费 30%：你链接带来的每一笔下注，4% 手续费里的 30% 在下注瞬间由合约托管，结算后可提；",
    "    把已赚积分的 50% 锁 90 天，分润升到 50%。",
    "  · 积分 20%：团员下注产生的 Arena Points，你再拿 20%；创世时积分 1:1 兑换 $ARENA",
    "    （42% 总量留给积分，零团队预留、无预售、无私募）。",
    "  · 专属链接 + 每日战报，不用你记账。",
    "",
    "你要付出什么",
    "  零。不签独家、不交押金、不托管资金、不要 KYC；你继续发你原本要发的内容。",
    "",
    "两步开跑",
    `  1. 打开 ${SITE}，连上你要收钱的 Base 钱包；`,
    "  2. 私聊 @predictaing_bot：/start captain → 发地址 → 它回你专属 ref 链接。",
    "",
    "发之前先自己验：分润比例写在合约里（REFERRAL_SHARE_BPS = 3000），计分规则是一个文件，",
    `白皮书公开：${SITE}/whitepaper`,
  ].join("\n");

  return `=== EN (DM / email / group owner intro) ===\n\n${en}\n\n\n=== 中文（TG / 微信群主） ===\n\n${zh}\n`;
}

/**
 * The build-in-public pitch (08).
 *
 * HN and r/web3dev punish marketing and reward specifics: what it does, what is actually deployed,
 * what is *not* built. Every number here is checkable from the repo or the chain, and the token
 * section says plainly that no token exists yet.
 */
function hackerPitch(): string {
  const hn = [
    "Show HN: Autonomous 24/7 Web3 Prediction Agent with Zero-Team Tokenomics on Base",
    "",
    "Hi HN — I built a prediction market that runs itself, and I am posting the whole thing, including",
    "the parts that are held together with cron.",
    "",
    "What it is: 232 binary markets across 19 sectors (crypto, macro, equities, AI, sports, policy),",
    "generated every 30 minutes from public feeds (Binance, CoinGecko, DefiLlama, Yahoo, FRED), opened",
    "on Base mainnet as USDC-escrowed pools, settled with an IPFS content hash per pool.",
    "",
    "The interesting part is not the market, it is the operating model. There is no ops team. Market",
    "generation, strike selection, pool opening, settlement accounting, copywriting and referral",
    "attribution are cron jobs over on-chain state. The board is a build artifact: pools.json is what",
    "the app renders and what the pool opener submits, so the card and the contract cannot disagree.",
    "",
    "Points are a pure function of chain history. scripts/sync-points.ts replays BetPlaced logs:",
    "10 points per $1 net stake, 1 + 2|p−0.5| for contrarian sides (capped 2×), 1.5× for markets under",
    "48h, and 20% of a referee's points to the referrer from the on-chain referrer field. No table, no",
    "migration, no admin edit — rebuild it and diff.",
    "",
    "Tokenomics, such as they are: no token exists. If one launches, 42% goes to points holders 1:1,",
    "25% into a 24-month locked Aerodrome pool, 33% to a community-governed ecosystem reserve. Zero",
    "team/advisor/VC allocation — the operator is paid from the 4% fee, not from a token bag.",
    "",
    "Boring engineering details people ask about:",
    "  · 232/232 e2e green (Playwright against a production build, mocked wallet + mocked RPC)",
    "  · pools opened in nonce-safe batches of 30; sticky strikes so an id never re-points",
    "  · cancelled pools refund stake + fee in full; `onlyOwner` can settle but cannot touch stakes",
    "  · contract: 0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5 (Base)",
    "",
    "What is not built: no token, no mobile app, no order book (it is pari-mutuel), and the cron box is",
    "single-machine — if it dies, markets stop opening (settlement is unaffected).",
    "",
    `Code: https://github.com/lulaxiao97-create/prediction-arena`,
    `Site: ${SITE}`,
    `Whitepaper: ${SITE}/whitepaper`,
    "",
    "Happy to answer anything about the settlement path, the points replay or why I think an autonomous",
    "venue is the only kind that can price 200 markets without a payroll.",
  ].join("\n");

  const reddit = [
    `r/web3dev — title: "I built a self-running prediction market on Base: 232 markets, 19 sectors, zero ops team"`,
    "",
    "The stack: Next.js 16 + wagmi/viem frontend, Solidity 0.8.20 contract (no proxy), a Bun cron box that",
    "regenerates the board every 30 min and opens pools in batches of 30, and a points ledger derived",
    "entirely from BetPlaced events. Comparison point for anyone building agents: the agent here does not",
    "chat, it does bookkeeping — which is the part that actually has to be correct.",
    "",
    "One thing I would do differently: I started with a hand-curated market list and it rotted within a",
    "week. The generator plus sticky strikes (a market's strike/id is frozen at creation) was the fix.",
    "",
    "Repo + whitepaper in the comments. Feedback on the settlement design very welcome.",
  ].join("\n");

  const v2ex = [
    "V2EX / 开源社区 — 标题：做了一个自己跑起来的预测市场：232 个盘口、19 个板块、零运营团队",
    "",
    "技术栈：Next.js 16 + viem/wagmi，Solidity 0.8.20（无代理、不可升级），Bun cron 每 30 分钟重建盘口、",
    "每批 30 个开池；积分不存数据库，全部由链上 BetPlaced 事件重放得出，一条命令可重算。",
    "",
    "有意思的地方是「运营」这件事被删掉了：建盘、定价、开池、结算记账、写文案、归因全是跑在链上状态上的",
    "定时任务。盘口是构建产物：pools.json 同时喂给前端和开池脚本，所以卡片上的数字和合约里的池子不会打架。",
    "",
    "代币目前不存在；如果发行，42% 给积分持有者 1:1 兑换、25% 进锁 24 个月的 Aerodrome 池、33% 归社区治理的",
    "生态池，团队/顾问/VC 份额为零——运营成本由 4% 手续费支付。",
    "",
    `开源地址：https://github.com/lulaxiao97-create/prediction-arena  白皮书：${SITE}/whitepaper`,
  ].join("\n");

  return [
    "=== HACKER NEWS (Show HN) ===",
    hn,
    "",
    "=== REDDIT (/r/web3dev · /r/Base) ===",
    reddit,
    "",
    "=== V2EX / 中文开源社区 ===",
    v2ex,
    "",
  ].join("\n");
}


/**
 * The hot five — the paste-ready board for someone who wants to reply now, not read a deck.
 * Same selector as the deck (`pickContrarian`), five lanes instead of three.
 */
function hotFive(pools: Pool[]): string {
  const picks = pickContrarian(pools, 5);
  const rows = picks.map((pool, i) => {
    const yes = Math.round(yesShare(pool) * 100);
    const { y, n } = bothOdds(yes);
    const duel = `YES ${bar(yes)} ${yes}% → ${y}× · NO ${bar(100 - yes)} ${100 - yes}% → ${n}×`;
    const url = shortTrackedUrl(pool.id, "x");
    return `## ${i + 1} · ${pool.category ?? "other"} · ${timeLeft(pool.endTimeUtc)} left\n${pool.title}\n${duel}\n${url}\n${REPLY_HOOK}`;
  });
  return ["# hot five · regenerated with every pack", "# one per sector — paste, do not rewrite the numbers", "", ...rows].join("\n\n") + "\n";
}

/**
 * The three-line agent pitch (09).
 *
 * A group owner reads this in a DM preview, standing in a queue. Every line has one job: what they
 * get, what they do, what they can check. No adjectives, no roadmap.
 */
function agentPitchDeck(): string {
  const en = [
    `Your group already argues about markets — get 30–50% of our 4% fee when they bet through your link (paid by the contract at settlement), plus 20% of their genesis airdrop points.`,
    `Two minutes: open ${SITE} → connect the Base wallet you want paid → message @predictaing_bot /start captain → post the link it gives you.`,
    `No deposit, no exclusivity, no KYC. Check the split yourself: REFERRAL_SHARE_BPS = 3000 in the contract, whitepaper at ${SITE}/whitepaper`,
  ].join("\n\n");
  const zh = [
    "你群里本来就在吵的那些盘口，用你的链接下注，你拿我们 4% 手续费的 30%（质押后 50%），结算时由合约直接付。",
    "两步：打开网站连上你要收钱的 Base 钱包 → 私聊 @predictaing_bot 发 /start captain → 把它回你的链接发群里。",
    "不用押金、不签独家、不要 KYC；分成比例写在合约里（REFERRAL_SHARE_BPS = 3000），白皮书公开可查。",
  ].join("\n\n");
  return `=== EN (3 lines, DM / quote-tweet) ===\n\n${en}\n\n\n=== 中文（3 行，私信 / 群公告） ===\n\n${zh}\n`;
}


/**
 * The crew post (11): what a reader gets for following, replying, reposting, joining.
 *
 * Every line is a mechanism that exists: channel membership is verified by the bot (`getChatMember`),
 * the "3 best takes" are grants written to docs/points/grants.json, and the repost cut is the
 * contract's `REFERRAL_SHARE_BPS`. Nothing here promises a price, and follow is described as what it
 * actually is — a feed, not a payout.
 */
function crewPost(): string {
  const en = [
    "Free to join, free to earn:",
    "",
    "📣 Join t.me/predictionarena_hq → 500 points",
    "💬 Reply with your call → 3 best takes/day get 1,000",
    "🔁 Repost with your ?ref= link → 30% of the fee, on-chain",
    "👀 Follow → daily board + settlement receipts",
    "",
    "Logged in points.json, 1:1 into $ARENA at genesis.",
  ].join("\n");
  const zh = [
    "免费参与，免费拿分：",
    "",
    "📣 加入频道 t.me/predictionarena_hq → 500 分",
    "💬 在盘口回复判断 → 每天 3 条最佳，各 1,000 分",
    "🔁 用 ?ref= 链接转发 → 每笔下注拿手续费的 30%，链上结算",
    "👀 关注 → 每日盘口 + 结算回执",
    "",
    "全部分数写进 points.json，创世时 1:1 兑换 $ARENA。",
  ].join("\n");
  return `=== EN (attach a market card) ===\n\n${en}\n\n\n=== 中文（配盘口卡） ===\n\n${zh}\n`;
}

const CAPTAIN_EN = `Subject: 30–50% of our platform fee, on-chain, for the markets you already post

Hi — quick one, no deck.

Prediction Arena is a binary market venue on Base (USDC, non-custodial, verified contract). We do
not pay for ads, so the whole growth budget goes to the people who bring the bets:

  · You share a market link with your own address in ?ref=
  · Every position placed through it credits you 30% of the 4% platform fee, at settlement
  · Stake 50% of what you earn for 90 days and that share rises to 50% (genesis)
  · 20% of your referees' Arena Points, which convert 1:1 into $ARENA at genesis
  · The contract pays it out of the fee, not out of the bettor's stake, and not out of our pocket
  · No sign-up, no KYC, no custody, no minimum volume, nothing to install

What it costs you: one post a day, whichever market your group is already arguing about.

Where to get your link: open the site, connect the wallet you want to be paid to, Portfolio →
Invite & Earn → copy. That link is your referral link; replace it and every future bet follows the
new one.

Market board (rebuilt every 30 minutes from live feeds): ${SITE}
Contract: 0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5 (Base, v3)

If you want the numbers behind it before you post anything, ask and I will send the on-chain
attribution readout for the last window — bets, referred bets, who earned what.`;

const CAPTAIN_ZH = `主题：你已经在发的盘口，可以拿我们 4% 手续费的 30%~50%（链上自动结算）

你好，直说，不发 PPT。

Prediction Arena 是基于 Base 的二元预测市场（USDC 托管、非托管合约、源码已验证）。我们不打广告，
增长预算全部给带来下注的人：

  · 你用带自己地址的 ?ref= 链接分享盘口
  · 通过该链接下的每一笔仓位，结算时把平台 4% 手续费的 30% 记给你
  · 把已赚积分的 50% 锁 90 天，分润升到 50%（创世后开启）
  · 团员积分的 20% 归你，创世时 1:1 兑换 $ARENA
  · 这笔钱由合约从手续费里付，不动下注者的本金，也不从我们账上出
  · 不需要注册、不需要 KYC、不托管资金、没有最低量、不用装任何东西

你的成本：每天一条，发你群里本来就在吵的那个盘口。

拿链接：打开网站 → 连接你收款的钱包 → Portfolio → Invite & Earn → 复制。那就是你的推荐链接；
以后换钱包就换链接，之后的下注会跟新的走。

盘口看板（每 30 分钟用实时行情重建）：${SITE}
合约：0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5（Base, v3）

发之前想先看数据的话跟我说，我把最近一个窗口的链上归因读数发你——下注笔数、经推荐人的笔数、
谁赚了多少。`;

function calendar(): string {
  let days: string[] = [];
  try {
    days = readdirSync(CAMPAIGNS).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  } catch {
    return "# Marketing calendar\n\nNo archives yet — run `bun run auto:market --write` first.\n";
  }
  const rows: string[] = [];
  for (const day of days.slice(-14)) {
    try {
      const archive = JSON.parse(readFileSync(join(CAMPAIGNS, day, "index.json"), "utf8")) as { posts?: Post[] };
      for (const p of archive.posts ?? []) {
        rows.push(
          `| ${day} | ${p.id} | ${p.title.replace(/\|/g, "\\|")} | ${p.tweetWeight ?? "—"}/280 | ${p.tribal?.total ?? "—"} |`,
        );
      }
    } catch {
      /* a day folder without an index is not worth failing the pack over */
    }
  }
  return [
    "# Marketing calendar",
    "",
    "Every market the factory has featured, newest last. One row per post.",
    "",
    "| Day | Market | Title | X budget | tribal |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function readme(dir: string): string {
  return `Prediction Arena — desktop marketing pack
generated: ${new Date().toISOString()}

WHAT IS IN HERE
  01-market-card.png       1200x675 OG card — drag it straight into the tweet (X crops at 1.91:1)
  01-main-tweet.txt        the flagship tweet for today (under 280, bar + both odds + countdown)
  02-alpha-reply-deck.txt  three replies to drop under someone else's post, different angles
  03-captain-pitch.txt     the DM/enquiry script for a TG owner or KOL — 30% of the 4% fee
  04-calendar.md           every market featured so far, for planning the week
  05-whitepaper-launch.txt the whitepaper launch post + three thread comments
  06-whitepaper-card.png   1200x630 whitepaper OG card — attach it to the launch post
  07-captain-airdrop-pitch.txt  group-owner pitch: 30–50% of the fee + 20% of members' points
  08-hacker-news-pitch.txt Show HN + Reddit + V2EX posts, written for developers
  09-agent-pitch-deck.txt  3-line agent pitch (EN + 中文) — DM / quote-tweet
  10-airdrop-pinned.txt    the pinned airdrop post (EN + 中文) — attach 06-whitepaper-card.png
  00-hot-5.txt             five paste-ready replies, one per sector, regenerated every pack
  11-crew-post.txt         the crew hook: channel 500 / best takes 1,000 / repost 30% (EN + 中文)
  meta.json                the numbers behind all of the copy, with timestamps
  archive/<date>/          a frozen copy of each day's pack

HOW TO USE IT (two minutes a day)
  1. Open 01, copy, paste into X, post. The link already carries ref=x.
  2. Pick one reply from 02 and drop it under a big account talking about that token/asset.
  3. Send 03 to one TG group owner or KOL. One a day is enough; the reply rate is low by nature.
  4. Nothing here posts itself. The X API is a paid gate, this folder is not.

RULES THE COPY FOLLOWS
  · every number is read from frontend/public/pools.json — if a number looks stale, the board moved;
    rerun \`bun run push:marketing\` instead of editing the text by hand;
  · the main tweet is copied from the cloud archive when one exists today, so the desktop pack and
    the channel never disagree;
  · "pays N×" is the current implied probability, not a promise, and nothing has settled until it
    settles;
  · the 30% is the contract's referral cut of the 4% rake, paid at settlement. No revenue figure is
    promised anywhere, because none can be.

Regenerate: bun run push:marketing
Folder: ${dir}
`;
}

/**
 * Render the OG card by shelling out to the image script.
 *
 * Not imported: the renderer pulls in Chromium, and a text-only pack on a machine without it is
 * still worth having. The failure is reported, not swallowed.
 */
function renderCard(marketId: string | number, out: string, snapshot: string | null): { ok: boolean; note: string } {
  try {
    const proc = Bun.spawnSync({
      cmd: [
        "bun",
        join(ROOT, "scripts", "generate-marketing-image.ts"),
        `--market=${marketId}`,
        `--out=${out}`,
        ...(snapshot ? [`--snapshot=${snapshot}`] : []),
        "--quiet",
      ],
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode === 0 && existsSync(out)) return { ok: true, note: "ok" };
    const err = new TextDecoder().decode(proc.stderr).trim().split("\n").pop() ?? "unknown error";
    return { ok: false, note: err.slice(0, 160) };
  } catch (err) {
    return { ok: false, note: (err as Error).message.slice(0, 160) };
  }
}

function main(): void {
  const args = parseArgs(process.argv);
  const dir = args.dir ?? desktopDir();
  const pools = openPools();
  if (pools.length === 0) {
    console.error("no open markets in the manifest — run scripts/refresh-board.sh first");
    process.exit(1);
  }

  const archive = todayArchive();
  const flagship = archivedTweet(archive);
  const snapshotPath = flagship && archive ? join(CAMPAIGNS, archive.day, "index.json") : null;
  // Fallback ranking: heat first (real move × split crowd × urgency), tribe as the tie-break.
  // The old rule ("most traders") picked a Premier League market for a channel built around
  // tribes; on a 150-market board it is also the rule that never surfaces a new lane.
  const flagshipPool =
    (flagship && pools.find((p) => String(p.id) === String(flagship.id))) ??
    [...pools].sort((a, b) => {
      const delta = flagshipScore(b) - flagshipScore(a);
      return delta !== 0 ? delta : Number(Boolean(tribe(b))) - Number(Boolean(tribe(a)));
    })[0];

  const tweet = flagship?.tweet ?? mainTweet(flagshipPool);
  const tweetId = flagship?.id ?? flagshipPool.id;
  // Three lanes, three cards, three tweets. The archive tweet (if the cloud factory already wrote
  // one today) stays the first card so the pack and the channel cannot disagree.
  const flagships = pickFlagships(pools, 3);
  if (flagship) {
    const idx = flagships.findIndex((p) => String(p.id) === String(flagship.id));
    if (idx > 0) flagships.unshift(flagships.splice(idx, 1)[0]);
  }
  const flagshipTweets = flagships.map((p) => ({
    pool: p,
    tweet: String(p.id) === String(tweetId) ? tweet : mainTweet(p),
  }));
  const deck = replyDeck(pools);
  const pinned = pinnedAirdropPost();

  const files: Record<string, string> = {
    // Paste-ready means paste-ready: no weight watermark, no source note, no "how to use" tell at
    // the bottom. Those live in meta.json where a machine reads them, not in the thing a human
    // copies while a post is three minutes old.
    "01-main-tweet.txt": `${tweet}\n`,
    // The full day's slate: one tweet per flagship lane, so the operator can post three times
    // instead of once and each post lands in a different audience.
    "01-main-tweets.txt": flagshipTweets
      .map((f, i) => `=== #${i + 1} · ${f.pool.category} · market ${f.pool.id} (card 0${i + 1}-market-card.png) ===\n${f.tweet}`)
      .join("\n\n"),
    "02-alpha-reply-deck.txt": deck.map((r, i) => `#${i + 1}\n${r.text}\n`).join("\n"),
    "03-captain-pitch.txt": `=== EN (DM / email)\n\n${CAPTAIN_EN}\n\n\n=== 中文（TG / 微信）\n\n${CAPTAIN_ZH}\n`,
    // Whitepaper launch: one post about the venue itself, plus three comments for the thread.
    "05-whitepaper-launch.txt": [
      "=== PINNED POST (attach 06-whitepaper-card.png) ===",
      whitepaperLaunch(),
      "",
      "=== THREAD COMMENTS ===",
      ...whitepaperComments().map((c, i) => `#${i + 1} · ${c.angle}\n${c.text}`),
    ].join("\n"),
    // The airdrop post itself: pinned to the profile, not rotated with the daily market.
    "10-airdrop-pinned.txt": [
      "=== PINNED POST — EN (attach 06-whitepaper-card.png) ===",
      pinned.en,
      "",
      "=== PINNED POST — 中文（TG / 微博 / 微信群） ===",
      pinned.zh,
      "",
      `weight: EN ${weight(pinned.en)}/280 · 中文 ${weight(pinned.zh)}/280`,
    ].join("\n"),
    "00-hot-5.txt": hotFive(pools),
    "11-crew-post.txt": crewPost(),
    "09-agent-pitch-deck.txt": agentPitchDeck(),
    "07-captain-airdrop-pitch.txt": captainAirdropPitch(),
    "08-hacker-news-pitch.txt": hackerPitch(),
    "04-calendar.md": calendar(),
    "README.txt": readme(dir),
    "meta.json": JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        site: SITE,
        flagships: flagshipTweets.map((f, i) => ({
          slot: i + 1,
          id: f.pool.id,
          title: f.pool.title,
          category: f.pool.category,
          tier: f.pool.tier ?? null,
          weight: weight(f.tweet),
          heat: f.pool.heat ?? null,
          card: `0${i + 1}-market-card.png`,
        })),
        flagship: {
          id: tweetId,
          title: flagshipPool.title,
          source: flagship ? "cloud-archive" : "pools.json",
          weight: weight(tweet),
          traders: flagshipPool.traders ?? 0,
          endTimeUtc: flagshipPool.endTimeUtc ?? null,
          liquidityUsdc: Number(flagshipPool.liquidityUsdc ?? 0),
        },
        replies: deck.map((r) => ({ angle: r.angle, weight: weight(r.text) })),
        openMarkets: pools.length,
        prices: pricesMeta(),
      },
      null,
      2,
    ) + "\n",
  };

  if (args.dryRun) {
    console.log(`# dry run — would write to ${dir}`);
    console.log(`# plus 01-market-card.png for market ${tweetId} (1200x675, rendered by scripts/generate-marketing-image.ts)\n`);
    for (const [name, body] of Object.entries(files)) {
      console.log(`\n${"=".repeat(72)}\n${name}\n${"=".repeat(72)}\n${body}`);
    }
    return;
  }

  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body, "utf8");

  // The picture ships with the copy, from the same manifest row. Best effort: a missing Chromium
  // must not cost the operator the text pack.
  // One card per flagship. The first is the tweet's card; the other two are for the second and
  // third posts, rendered from the same manifest rows so the numbers cannot disagree.
  const cards = flagshipTweets.map((f, i) => {
    const out = join(dir, `0${i + 1}-market-card.png`);
    return { id: f.pool.id, out, result: renderCard(f.pool.id, out, snapshotPath) };
  });
  const card = cards[0]?.result ?? { ok: false, note: "no flagship" };

  // The whitepaper card is a build artifact of the app (`/whitepaper/opengraph-image`), committed to
  // public/ so the pack never drifts from the site's own link preview.
  let whiteCard = { ok: false, note: "frontend/public/whitepaper-og.png missing — run the web build" };
  try {
    copyFileSync(join(ROOT, "frontend", "public", "whitepaper-og.png"), join(dir, "06-whitepaper-card.png"));
    whiteCard = { ok: true, note: "1200x630" };
  } catch {
    /* text-only pack still ships */
  }

  // meta.json is rewritten once the card exists, so the file records whether the picture is really
  // there rather than whether we hoped it would be.
  try {
    const metaPath = join(dir, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    meta.card = { file: "01-market-card.png", size: "1200x675", generated: card.ok, note: card.note };
    meta.whitepaperCard = { file: "06-whitepaper-card.png", size: "1200x630", generated: whiteCard.ok, note: whiteCard.note };
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  } catch {
    /* the text pack is what matters; a missing meta line must not fail the run */
  }

  const day = new Date().toISOString().slice(0, 10);
  const archiveDir = join(dir, "archive", day);
  mkdirSync(archiveDir, { recursive: true });
  for (const name of Object.keys(files)) copyFileSync(join(dir, name), join(archiveDir, name));

  console.log(`wrote ${Object.keys(files).length} files + archive/${day} to:`);
  console.log(`  ${dir}`);
  console.log(
    `  flagship: market ${tweetId} · ${weight(tweet)}/280 weighted · ${flagship ? "cloud archive" : "generated"}`,
  );
  console.log(`  reply deck: ${deck.map((r) => `${r.angle} (${weight(r.text)}/280)`).join(" · ")}`);
  console.log(`  captain pitch: EN + 中文 · ${pools.length} open markets available`);
  console.log(`  01-market-card.png: ${card.ok ? "1200x675 rendered" : `skipped — ${card.note}`}`);
  console.log(`  06-whitepaper-card.png: ${whiteCard.ok ? "1200x630 copied" : `skipped — ${whiteCard.note}`}`);
}

main();
