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
  const drafts = [
    `🏴 ${clipped(pool.title, 64)}\n\nYES ${bar(yes)} ${yes}% → ${y}×\nNO\u00a0\u00a0${bar(no)} ${no}% → ${n}×\n\n${pool.traders ?? 0} already picked a side. ${left} left. The wrong side pays the right side.\n\n${url}\n${X_HANDLE}`,
    `${yes}% YES pays ${y}× — ${pool.traders ?? 0} already picked a side, ${left} left.\n\n${clipped(pool.title, 58)}\n\n${url}\n${X_HANDLE}`,
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
  // Tribe first, then crowd. A reply under a Base-native post has to be about a token that account's
  // readers already hold; the biggest market on the board last week was a Premier League match, and
  // nobody in a DeFi comment section cares how many people took the over.
  const ranked = [...pools].sort(
    (a, b) => Number(Boolean(tribe(b))) - Number(Boolean(tribe(a))) || flagshipScore(b) - flagshipScore(a),
  );
  // One market per tribe first (three AERO replies is a broken deck), then one per lane, then
  // fill from the ranking. On a 150-market board the deck should not be three crypto cards when
  // the board also carries the Fed, NVIDIA and the Champions League.
  const picks: Pool[] = [];
  const usedTribes = new Set<string>();
  const usedCategories = new Set<string>();
  for (const pass of [0, 1] as const) {
    for (const pool of ranked) {
      if (picks.length >= 3) break;
      if (picks.includes(pool)) continue;
      const t = tribe(pool);
      if (pass === 0 && (!t || usedTribes.has(t))) continue;
      if (pass === 1) {
        const c = String(pool.category ?? "");
        if (c && usedCategories.has(c)) continue;
        usedCategories.add(c);
      }
      if (t) usedTribes.add(t);
      picks.push(pool);
    }
  }
  for (const pool of ranked) {
    if (picks.length >= 3) break;
    if (!picks.includes(pool)) picks.push(pool);
  }

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
    const footer = `${count} in · ${left} left → ${url}`;
    // Lane voice: a macro reply under a rates account and a meme reply under a CT account cannot
    // be the same sentence with a different ticker in it.
    const voice = laneVoice(pool);
    const byAngle = [
      [voice?.contrarian ?? `The board is ${no}% NO on ${subject} and YES still pays ${y}×`, duel, footer],
      [voice ? `${voice.receipt}: ${subject} → ${yes}% YES, ${count} positions` : `${subject} → ${yes}% YES, ${count} positions already placed`, duel, `${left} left → ${url}`],
      [voice ? `${voice.challenge}. ${count} in, ${no}% on NO.` : `${count} people disagree about this one. ${no}% are on NO.`, `${duel} · ${left} left`, url],
    ];
    // Long subjects degrade to a shorter sentence, they never get cut mid-word.
    const candidates = [
      byAngle[i].join("\n"),
      [byAngle[i][0].slice(0, 90), `${yes}% YES → ${y}× · ${no}% NO → ${n}×`, url].join("\n"),
    ];
    const text = candidates.find((c) => weight(c) <= 275) ?? candidates[candidates.length - 1];
    return { angle: angles[i], text };
  });
}

const CAPTAIN_EN = `Subject: 30% of our platform fee, on-chain, for the markets you already post

Hi — quick one, no deck.

Prediction Arena is a binary market venue on Base (USDC, non-custodial, verified contract). We do
not pay for ads, so the whole growth budget goes to the people who bring the bets:

  · You share a market link with your own address in ?ref=
  · Every position placed through it credits you 30% of the 4% platform fee, at settlement
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

const CAPTAIN_ZH = `主题：你已经在发的盘口，可以拿我们 4% 手续费的 30%（链上自动结算）

你好，直说，不发 PPT。

Prediction Arena 是基于 Base 的二元预测市场（USDC 托管、非托管合约、源码已验证）。我们不打广告，
增长预算全部给带来下注的人：

  · 你用带自己地址的 ?ref= 链接分享盘口
  · 通过该链接下的每一笔仓位，结算时把平台 4% 手续费的 30% 记给你
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

  // meta.json is rewritten once the card exists, so the file records whether the picture is really
  // there rather than whether we hoped it would be.
  try {
    const metaPath = join(dir, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    meta.card = { file: "01-market-card.png", size: "1200x675", generated: card.ok, note: card.note };
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
}

main();
