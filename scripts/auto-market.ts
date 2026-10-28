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
  pick: "movers" | "expiry" | "tvl";
  limit: number;
  send: boolean;
  json: boolean;
  write: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { pick: "movers", limit: 1, send: false, json: false, write: false };
  for (const raw of argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "pick" && ["movers", "expiry", "tvl"].includes(value)) args.pick = value as Args["pick"];
    else if (key === "limit") args.limit = Math.max(1, Math.min(12, Number(value) || 1));
    else if (key === "send") args.send = true;
    else if (key === "json") args.json = true;
    else if (key === "write") args.write = true;
    else if (key === "help" || key === "-h") {
      console.log("usage: bun scripts/auto-market.ts [--pick=movers|expiry|tvl] [--limit=N] [--write] [--send] [--json]");
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

function rank(pools: Pool[], pick: Args["pick"]): Pool[] {
  const alive = pools.filter((p) => !poolClosed(p));
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
  const yes = Math.round(yesShare(pool) * 100);
  const no = 100 - yes;
  const mult = (1 / Math.max(0.02, yes / 100)).toFixed(1);
  const traders = pool.traders ?? 0;
  const url = trackedUrl(pool.id, "x");
  const lead = pool.marketData?.asset
    ? `${pool.marketData.asset} at ${price(pool.marketData.spotUsd ?? 0)} right now.`
    : `Closes in ${closeIn(pool)}.`;

  const options = [
    `The crowd is paying ${mult}× on one side of this market:\n\n"${clipped(pool.title, 70)}"\n\n${yes}% YES · ${no}% NO · ${traders} traders in. ${lead}`,
    `Still ${closeIn(pool)} left to take a side:\n\n"${clipped(pool.title, 70)}"\n\n${yes}% YES pays ${mult}×. ${traders} traders are already in.`,
    `Two AI agents argued this one and the crowd split ${yes}/${no}:\n\n"${clipped(pool.title, 70)}"\n\nYES pays ${mult}×. ${lead}`,
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
  const mult = (1 / Math.max(0.02, yes / 100)).toFixed(1);
  const url = trackedUrl(pool.id, "farcaster");
  const spot = pool.marketData?.asset
    ? `${pool.marketData.asset} ${price(pool.marketData.spotUsd ?? 0)} now`
    : `closes in ${closeIn(pool)}`;

  const full = `📊 ${clipped(pool.title, 74)}\n\n${yes}% YES · pays ${mult}× · ${pool.traders ?? 0} traders\n${spot}\n\n${url}`;
  if (full.length <= 320) return full;
  return `📊 ${clipped(pool.title, 56)}\n\n${yes}% YES · ${mult}×\n${url}`;
}

function telegramFor(pool: Pool): string {
  const yes = Math.round(yesShare(pool) * 100);
  const mult = (1 / Math.max(0.02, yes / 100)).toFixed(1);
  const url = trackedUrl(pool.id, "telegram");
  return [
    `📊 DAILY BOARD — ${new Date().toISOString().slice(0, 10)}`,
    "",
    `🔥 ${pool.title}`,
    `${yes}% YES · pays ${mult}× · ${pool.traders ?? 0} traders · ${money(Number(pool.liquidityUsdc ?? 0))} liquidity`,
    `Closes in ${closeIn(pool)}`,
    "",
    `Take a side → ${url}`,
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
  generatedAt: string;
};

function build(pool: Pool, pick: Args["pick"]): Post {
  const tweet = tweetFor(pool);
  const cast = castFor(pool);
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

  writeFileSync(join(dir, "index.json"), JSON.stringify({ day, posts }, null, 2), "utf8");
  written.push(join(dir, "index.json"));

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
  const token = process.env.X_BEARER_TOKEN ?? process.env.X_OAUTH2_BEARER;
  if (!token) return "skipped: X_BEARER_TOKEN unset";

  const res = await postJson("https://api.x.com/2/tweets", { Authorization: `Bearer ${token}` }, { text });

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
    return "skipped: X_BEARER_TOKEN is an app-only bearer (read-only). Posting needs OAuth 1.0a user context or an OAuth 2.0 user token — see docs/GROWTH_MILESTONE_1K_30.md §6.";
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

  const picked = rank(pools, args.pick).slice(0, args.limit);
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
    console.log(JSON.stringify({ site: SITE, posts: results, files }, null, 2));
    return;
  }

  results.forEach((r) => {
    const p = r as unknown as Post & { x?: string; telegramSend?: string };
    console.log(`\n=== market ${p.id} — ${p.title}`);
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
