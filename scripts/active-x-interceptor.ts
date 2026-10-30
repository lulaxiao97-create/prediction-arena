/**
 * Active X interceptor — the outbound half of distribution.
 *
 * The passive generator (scripts/push-desktop-marketing.ts) waits on a desktop folder for a human to
 * open it. This one watches the accounts a Base-native audience actually reads, and the moment one
 * of them posts something the board already prices, it produces the reply that goes underneath —
 * plain numbers, both sides of the book, one link. No brand voice, no "check us out".
 *
 * Sources, in the order they are tried (all of them are real code paths, not stubs):
 *
 *   1. x_api     — official v2 with X_BEARER_TOKEN. Works from CI where the secret lives.
 *   2. browser   — a persistent Playwright profile (`--login` once, then it is a logged-in session).
 *                  Needed because x.com answers 403 to datacenter IPs, so curl is not an option.
 *   3. nitter    — public mirrors, best effort. Most are dead in 2026; they are kept because a
 *                  working instance costs nothing and the code is the same RSS parse.
 *
 * Delivery: the draft is written to `.data/intercept/queue/` (copy only, ready to paste) plus an
 * index with the tweet URL to reply under. `--notify-chat` additionally pushes the draft to a
 * Telegram chat, which is how this reaches a phone when nobody is at the desk.
 *
 *   bun scripts/active-x-interceptor.ts --probe            # which source can actually read X right now
 *   bun scripts/active-x-interceptor.ts --once             # one sweep (cron)
 *   bun scripts/active-x-interceptor.ts --watch --minutes=350 --interval=90
 *   bun scripts/active-x-interceptor.ts --self-test        # offline proof of matching + copy rules
 *   bun scripts/active-x-interceptor.ts --login            # open the browser profile and sign in once
 *
 * Rules the generated copy obeys (asserted in --self-test):
 *   · 2–3 lines: the subject line, the two-sided duel, the link. Nothing else.
 *   · both sides always, with ASCII bars — one number is a statistic, two are a fight.
 *   · the link carries ?ref=x and is short enough to survive a phone screen.
 *   · no "weight:", "source:", "market:" or any other operator noise inside the paste-ready text.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { bar, bothOdds, clipped, price, shortTrackedUrl, timeLeft, weight } from "./lib/copy-kit";
import { oauthCreds, oauthHeader, postJson } from "./lib/x-oauth";

const ROOT = join(import.meta.dir, "..");
const MANIFEST = join(ROOT, "frontend", "public", "pools.json");
const TARGETS = join(ROOT, "scripts", "config", "intercept-targets.json");
const DATA = process.env.INTERCEPT_DATA ?? join(ROOT, ".data", "intercept");

/** A tweet is "interceptable" while the reply still lands near the top of the thread. */
const FRESH_MS = Number(process.env.INTERCEPT_FRESH_MS ?? 5 * 60_000);

type Pool = {
  id: string | number;
  title: string;
  category?: string;
  status?: number;
  endTimeUtc?: string;
  traders?: number;
  yesShare?: number;
  tags?: string[];
  marketData?: { asset?: string; spotUsd?: number; strikeUsd?: number };
};

type Tweet = {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  url: string;
  likes?: number;
};

type SourceReport = {
  source: "x_api" | "browser" | "nitter" | "fixture";
  ok: boolean;
  status: number | string;
  detail: string;
  tweets: Tweet[];
};

type Item = {
  tweetId: string;
  tweetUrl: string;
  author: string;
  tweetText: string;
  tweetAgeSec: number;
  marketId: string;
  marketTitle: string;
  reply: string;
  replyWeight: number;
  generatedAt: string;
  source: SourceReport["source"];
};

type State = { seen: Record<string, string>; lastRun?: string };

type Args = {
  once: boolean;
  watch: boolean;
  minutes: number;
  interval: number;
  dryRun: boolean;
  probe: boolean;
  selfTest: boolean;
  login: boolean;
  notifyChat: string | null;
  forceSource: SourceReport["source"] | null;
  reply: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    once: true,
    watch: false,
    minutes: 350,
    interval: 90,
    dryRun: false,
    probe: false,
    selfTest: false,
    login: false,
    notifyChat: process.env.INTERCEPT_NOTIFY_CHAT ?? null,
    forceSource: null,
    reply: process.env.INTERCEPT_AUTO_REPLY === "1",
  };
  for (const raw of argv.slice(2)) {
    const [k, v = ""] = raw.replace(/^--/, "").split("=");
    if (k === "once") args.once = true;
    else if (k === "reply") args.reply = true;
    else if (k === "watch") {
      args.watch = true;
      args.once = false;
    } else if (k === "minutes") args.minutes = Number(v) || args.minutes;
    else if (k === "interval") args.interval = Math.max(30, Number(v) || args.interval);
    else if (k === "dry-run") args.dryRun = true;
    else if (k === "probe") args.probe = true;
    else if (k === "self-test") args.selfTest = true;
    else if (k === "login") args.login = true;
    else if (k === "notify-chat") args.notifyChat = v || null;
    else if (k === "source") args.forceSource = (v || null) as Args["forceSource"];
    else if (k === "help" || k === "-h") {
      console.log("usage: bun scripts/active-x-interceptor.ts [--probe|--once|--watch|--self-test|--login] [--interval=90] [--minutes=350] [--dry-run] [--notify-chat=<id>]");
      process.exit(0);
    }
  }
  return args;
}

// ---------------------------------------------------------------- market board

function loadPools(): Pool[] {
  const board = JSON.parse(readFileSync(MANIFEST, "utf8")) as { pools?: Pool[] };
  return (board.pools ?? []).filter((p) => (p.status ?? 1) === 1).filter((p) => {
    if (!p.endTimeUtc) return true;
    return new Date(p.endTimeUtc).getTime() > Date.now();
  });
}

function yesShare(pool: Pool): number {
  const raw = Number(pool.yesShare ?? Number.NaN);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.5;
}

/** Tokens that carry a community. The same short list the content factory ranks by. */
const TRIBES = ["aero", "degen", "toshi", "brett", "mog", "zora", "base"];

const CASHTAG_RE = /\$([A-Za-z][A-Za-z0-9]{1,9})\b/g;

/** Cashtags the tweet itself used, then bare tickers the board knows. */
function subjects(text: string, pools: Pool[]): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(CASHTAG_RE)) found.add(m[1].toUpperCase());
  const upper = text.toUpperCase();
  const assets = new Set(pools.map((p) => (p.marketData?.asset ?? "").toUpperCase()).filter(Boolean));
  for (const asset of assets) {
    if (asset.length >= 3 && new RegExp(`\\b${asset}\\b`).test(upper)) found.add(asset);
  }
  for (const tribe of TRIBES) {
    if (upper.includes(tribe.toUpperCase())) found.add(tribe.toUpperCase());
  }
  return [...found];
}

/**
 * Which market this post is really about.
 *
 * The tweet decides: a cashtag in the text outranks whatever the board happens to rank first. Ties
 * go to the market with more people in it, because that is the one where a reply reads as a crowd.
 */
function matchMarket(text: string, pools: Pool[]): { pool: Pool; subject: string } | null {
  const hits = subjects(text, pools);
  if (hits.length === 0) return null;
  const scored = pools
    .map((pool) => {
      const title = pool.title.toUpperCase();
      const asset = (pool.marketData?.asset ?? "").toUpperCase();
      let score = 0;
      for (const hit of hits) {
        if (asset === hit) score += 5;
        else if (title.includes(hit)) score += 3;
      }
      // "Will Base TVL …" is a Base-ecosystem market; a Base VC's post should reach it.
      if (score > 0 && pool.category === "Base Ecosystem") score += 1;
      return { pool, score, subject: hits.find((h) => title.includes(h) || asset === h) ?? hits[0] };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (b.pool.traders ?? 0) - (a.pool.traders ?? 0));
  if (scored.length === 0) return null;
  return { pool: scored[0].pool, subject: scored[0].subject };
}

/** Short enough to survive a phone: no utm_* clutter, still attributable. */
function shortLink(id: string | number): string {
  return shortTrackedUrl(id, "x");
}

function subjectLine(pool: Pool, subject: string): string {
  const asset = pool.marketData?.asset ?? subject;
  const spot = pool.marketData?.spotUsd;
  const head = spot && spot > 0 ? `$${asset} ${price(spot)}` : `$${subject}`;
  return `${head} · ${pool.traders ?? 0} positions already in`;
}

/**
 * The reply. Three lines, in this order, always:
 *   subject + how crowded it is
 *   YES/NO duel with bars and both payouts
 *   countdown + link
 *
 * A second, shorter ladder rung exists because a title that runs long must degrade, not get cut
 * mid-word. `--self-test` asserts the shape of every rung.
 */
function replyDrafts(pool: Pool, subject: string): string[] {
  const yes = Math.round(yesShare(pool) * 100);
  const no = 100 - yes;
  const { y, n } = bothOdds(yes);
  const left = timeLeft(pool.endTimeUtc);
  const link = shortLink(pool.id);
  return [
    [subjectLine(pool, subject), `YES ${bar(yes)} ${yes}% → ${y}× · NO ${bar(no)} ${no}% → ${n}×`, `${left} left → ${link}`].join("\n"),
    [`$${subject} is ${no}% NO on the board right now`, `YES ${yes}% pays ${y}× · NO ${no}% pays ${n}×`, `${pool.traders ?? 0} in · ${left} left → ${link}`].join("\n"),
    [`${yes}% YES → ${y}× · ${no}% NO → ${n}×`, `${clipped(pool.title, 70)} → ${link}`].join("\n"),
  ];
}

function pickReply(pool: Pool, subject: string): string {
  const drafts = replyDrafts(pool, subject);
  return drafts.find((d) => weight(d) <= 275) ?? drafts[drafts.length - 1];
}

// ---------------------------------------------------------------- sources

function bearer(): string | null {
  const tok = (process.env.X_BEARER_TOKEN ?? process.env.X_OAUTH2_BEARER ?? "").trim();
  return tok || null;
}

/**
 * Mint an app-only bearer from the consumer key/secret.
 *
 * X's `POST /oauth2/token` (grant_type=client_credentials, HTTP Basic with the key and secret) is
 * the one read credential a solo operator can renew without a browser session — which matters when
 * the stored `X_BEARER_TOKEN` has been rotated or revoked and the deployment has no human in it.
 * A 401 on that call means the key/secret pair itself is dead, and that is a portal job.
 */
async function mintBearer(key: string, secret: string): Promise<{ token: string | null; detail: string }> {
  const basic = Buffer.from(`${encodeURIComponent(key)}:${encodeURIComponent(secret)}`).toString("base64");
  try {
    const res = await fetch("https://api.x.com/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.text();
    if (!res.ok) return { token: null, detail: `${res.status}: ${body.slice(0, 160)}` };
    const parsed = JSON.parse(body) as { access_token?: string };
    return parsed.access_token
      ? { token: parsed.access_token, detail: "minted" }
      : { token: null, detail: `no access_token in response: ${body.slice(0, 160)}` };
  } catch (err) {
    return { token: null, detail: `mint failed: ${(err as Error).message.slice(0, 120)}` };
  }
}

/** Every bearer this environment can produce, in the order worth trying. */
async function bearerCandidates(): Promise<{ token: string; label: string }[]> {
  const out: { token: string; label: string }[] = [];
  const direct = bearer();
  if (direct) out.push({ token: direct, label: "X_BEARER_TOKEN" });
  const key = process.env.X_CONSUMER_KEY?.trim();
  const secret = process.env.X_CONSUMER_SECRET?.trim();
  if (key && secret) {
    const minted = await mintBearer(key, secret);
    console.log(`  · bearer from X_CONSUMER_KEY/SECRET: ${minted.detail}`);
    if (minted.token) out.push({ token: minted.token, label: "minted(key+secret)" });
  }
  return out;
}

async function xApiTimeline(handle: string, token: string): Promise<SourceReport> {
  const base = "https://api.x.com/2";
  const headers = { Authorization: ["Bearer", token].join(" ") };
  const userRes = await fetch(`${base}/users/by/username/${handle}?user.fields=public_metrics`, { headers });
  const userBody = await userRes.text();
  if (!userRes.ok) return { source: "x_api", ok: false, status: userRes.status, detail: userBody.slice(0, 180), tweets: [] };
  const userId = (JSON.parse(userBody) as { data?: { id?: string } }).data?.id;
  if (!userId) return { source: "x_api", ok: false, status: "no id", detail: userBody.slice(0, 180), tweets: [] };

  const tlRes = await fetch(
    `${base}/users/${userId}/tweets?max_results=10&tweet.fields=created_at,public_metrics&exclude=retweets`,
    { headers },
  );
  const tlBody = await tlRes.text();
  if (!tlRes.ok) return { source: "x_api", ok: false, status: tlRes.status, detail: tlBody.slice(0, 180), tweets: [] };

  const parsed = JSON.parse(tlBody) as {
    data?: { id: string; text: string; created_at?: string; public_metrics?: { like_count?: number } }[];
  };
  const tweets: Tweet[] = (parsed.data ?? []).map((t) => ({
    id: t.id,
    author: handle,
    text: t.text.replace(/\s+https:\/\/t\.co\/\S+$/g, "").trim(),
    createdAt: t.created_at ?? new Date().toISOString(),
    url: `https://x.com/${handle}/status/${t.id}`,
    likes: t.public_metrics?.like_count,
  }));
  return { source: "x_api", ok: true, status: 200, detail: `${tweets.length} tweets`, tweets };
}

/** RSS from a Nitter-compatible mirror. Dead hosts are normal, not exceptional. */
const NITTER_HOSTS = (process.env.NITTER_HOSTS ?? "nitter.tiekoetter.com,bird.habedieeh.re").split(",").filter(Boolean);

async function nitterTimeline(handle: string): Promise<SourceReport> {
  let last = { status: 0, detail: "no host tried" };
  for (const host of NITTER_HOSTS) {
    try {
      const res = await fetch(`https://${host}/${handle}/rss`, {
        headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36" },
        signal: AbortSignal.timeout(12_000),
      });
      const body = await res.text();
      if (!res.ok) {
        last = { status: res.status, detail: `${host}: ${res.status}` };
        continue;
      }
      const tweets = parseRss(body, handle);
      if (tweets.length === 0) {
        last = { status: "empty", detail: `${host}: 0 items (mirror without a working guest token)` };
        continue;
      }
      return { source: "nitter", ok: true, status: 200, detail: `${host}: ${tweets.length} items`, tweets };
    } catch (err) {
      last = { status: "error", detail: `${host}: ${(err as Error).message.slice(0, 80)}` };
    }
  }
  return { source: "nitter", ok: false, status: last.status, detail: last.detail, tweets: [] };
}

export function parseRss(xml: string, handle: string): Tweet[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const unescape = (s: string) =>
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/<[^>]+>/g, "")
      .trim();
  return items
    .map((raw) => {
      const field = (tag: string) => (raw.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) ?? [])[1] ?? "";
      const link = unescape(field("link"));
      const id = (link.match(/status\/(\d+)/) ?? [])[1] ?? "";
      const date = unescape(field("pubDate"));
      return {
        id,
        author: handle,
        text: unescape(field("description")).replace(/^\s*RT by\s+\S+:?\s*/, ""),
        createdAt: date ? new Date(date).toISOString() : new Date().toISOString(),
        url: link,
      } as Tweet;
    })
    .filter((t) => t.id && t.text);
}

/**
 * Browser source: a persistent Chromium profile.
 *
 * x.com refuses datacenter IPs with 403, and a logged-out session has no timeline at all, so the
 * only way to read X for free is to reuse a human's own session. `--login` opens the profile once
 * and leaves it there; after that every sweep is just a page load.
 */
async function browserTimeline(handle: string): Promise<SourceReport> {
  const profile = process.env.X_PROFILE_DIR ?? join(homedir(), ".hermes", "x-profile");
  let chromium: any;
  try {
    const req = require("node:module").createRequire(join(ROOT, "frontend", "package.json"));
    chromium = req("playwright-core").chromium;
  } catch (err) {
    return { source: "browser", ok: false, status: "no deps", detail: "playwright-core not installed in frontend/node_modules", tweets: [] };
  }
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const res = await page.goto(`https://x.com/${handle}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!res || res.status() >= 400) {
      return { source: "browser", ok: false, status: res?.status() ?? 0, detail: "x.com refused the request (IP/geo) — run --login on a residential connection", tweets: [] };
    }
    await page.waitForTimeout(3_500);
    const scraped = await page.evaluate(() => {
      const out: { id: string; text: string; iso: string; url: string }[] = [];
      for (const art of Array.from(document.querySelectorAll("article")).slice(0, 12)) {
        const link = art.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
        const time = art.querySelector("time") as HTMLTimeElement | null;
        const textEl = art.querySelector('[data-testid="tweetText"]') ?? art.querySelector("div[lang]");
        if (!link || !textEl) continue;
        const id = (link.getAttribute("href") ?? "").match(/status\/(\d+)/)?.[1] ?? "";
        out.push({
          id,
          text: (textEl as HTMLElement).innerText.trim(),
          iso: time?.getAttribute("datetime") ?? new Date().toISOString(),
          url: `https://x.com${link.getAttribute("href")}`,
        });
      }
      return out;
    });
    const tweets: Tweet[] = scraped
      .filter((t) => t.id && t.text)
      .map((t) => ({ id: t.id, author: handle, text: t.text, createdAt: t.iso, url: t.url }));
    if (tweets.length === 0) {
      return { source: "browser", ok: false, status: "no tweets", detail: "page loaded but no timeline (not signed in, or the login wall)", tweets };
    }
    return { source: "browser", ok: true, status: 200, detail: `${tweets.length} tweets`, tweets };
  } finally {
    await ctx.close();
  }
}

/** Recent-search for the cashtags the board actually prices. Same 402 wall as the timeline today. */
async function xSearch(token: string, queries: string[]): Promise<SourceReport> {
  if (queries.length === 0) return { source: "x_api", ok: true, status: 200, detail: "no cashtags configured", tweets: [] };
  const query = `(${queries.join(" OR ")}) -is:retweet lang:en`;
  const url =
    "https://api.x.com/2/tweets/search/recent?max_results=10&sort_order=relevancy" +
    `&query=${encodeURIComponent(query)}&tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username`;
  const res = await fetch(url, { headers: { Authorization: ["Bearer", token].join(" ") } });
  const body = await res.text();
  if (!res.ok) return { source: "x_api", ok: false, status: res.status, detail: `search: ${body.slice(0, 180)}`, tweets: [] };
  const parsed = JSON.parse(body) as {
    data?: { id: string; text: string; created_at?: string; author_id?: string; public_metrics?: { like_count?: number } }[];
    includes?: { users?: { id: string; username: string }[] };
  };
  const handles = new Map((parsed.includes?.users ?? []).map((u) => [u.id, u.username]));
  const tweets: Tweet[] = (parsed.data ?? []).map((t) => ({
    id: t.id,
    author: handles.get(t.author_id ?? "") ?? "unknown",
    text: t.text.replace(/\s+https:\/\/t\.co\/\S+$/g, "").trim(),
    createdAt: t.created_at ?? new Date().toISOString(),
    url: `https://x.com/${handles.get(t.author_id ?? "") ?? "i"}/status/${t.id}`,
    likes: t.public_metrics?.like_count,
  }));
  return { source: "x_api", ok: true, status: 200, detail: `search: ${tweets.length} tweets`, tweets };
}

async function collect(args: Args): Promise<SourceReport[]> {
  const targets = JSON.parse(readFileSync(TARGETS, "utf8")) as { accounts: string[]; queries?: string[] };
  const reports: SourceReport[] = [];
  const want = (s: SourceReport["source"]) => !args.forceSource || args.forceSource === s;

  if (want("x_api")) {
    const candidates = await bearerCandidates();
    if (candidates.length === 0) {
      reports.push({ source: "x_api", ok: false, status: "no token", detail: "X_BEARER_TOKEN and X_CONSUMER_KEY/X_CONSUMER_SECRET are all unset", tweets: [] });
    } else {
      // First handle is the canary: a dead credential fails identically on all seven, and finding
      // out once is cheaper than finding out seven times.
      let chosen: { token: string; label: string } | null = null;
      for (const candidate of candidates) {
        const probeReport = await xApiTimeline(targets.accounts[0], candidate.token);
        if (probeReport.ok) {
          chosen = candidate;
          reports.push(probeReport);
          break;
        }
        reports.push({ ...probeReport, detail: `[${candidate.label}] ${probeReport.detail}` });
      }
      if (chosen) {
        for (const handle of targets.accounts.slice(1)) {
          const report = await xApiTimeline(handle, chosen.token);
          reports.push(report);
          if (!report.ok && /429|rate/i.test(String(report.status))) break;
        }
        reports.push(await xSearch(chosen.token, targets.queries ?? []));
      }
    }
  }

  const usable = reports.some((r) => r.ok);
  if (!usable && want("browser") && process.env.X_PROFILE_DIR) {
    for (const handle of targets.accounts.slice(0, 4)) {
      const r = await browserTimeline(handle);
      reports.push(r);
      if (r.ok) break;
    }
  }

  if (!reports.some((r) => r.ok) && want("nitter")) {
    for (const handle of targets.accounts.slice(0, 3)) {
      const r = await nitterTimeline(handle);
      reports.push(r);
      if (r.ok) break;
    }
  }
  return reports;
}

// ---------------------------------------------------------------- state + output

function readState(): State {
  try {
    return JSON.parse(readFileSync(join(DATA, "state.json"), "utf8")) as State;
  } catch {
    return { seen: {} };
  }
}

function writeState(state: State): void {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(join(DATA, "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function readQueue(): Item[] {
  try {
    return JSON.parse(readFileSync(join(DATA, "queue.json"), "utf8")) as Item[];
  } catch {
    return [];
  }
}

function ageSec(createdAt: string): number {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return Number.MAX_SAFE_INTEGER;
  return Math.round((Date.now() - t) / 1000);
}

function intercept(tweets: Tweet[], pools: Pool[], state: State, source: SourceReport["source"]): Item[] {
  const fresh: Item[] = [];
  for (const tweet of tweets) {
    if (!tweet.id || state.seen[tweet.id]) continue;
    const age = ageSec(tweet.createdAt);
    if (age > FRESH_MS / 1000) continue;
    const match = matchMarket(tweet.text, pools);
    if (!match) continue;
    const reply = pickReply(match.pool, match.subject);
    fresh.push({
      tweetId: tweet.id,
      tweetUrl: tweet.url,
      author: tweet.author,
      tweetText: tweet.text,
      tweetAgeSec: age,
      marketId: String(match.pool.id),
      marketTitle: match.pool.title,
      reply,
      replyWeight: weight(reply),
      generatedAt: new Date().toISOString(),
      source,
    });
    state.seen[tweet.id] = new Date().toISOString();
  }
  return fresh;
}

function persist(items: Item[]): void {
  if (items.length === 0) return;
  const dir = join(DATA, "queue");
  mkdirSync(dir, { recursive: true });
  for (const item of items) writeFileSync(join(dir, `${item.tweetId}.txt`), `${item.reply}\n`, "utf8");
  const queue = [...readQueue(), ...items];
  writeFileSync(join(DATA, "queue.json"), `${JSON.stringify(queue.slice(-500), null, 2)}\n`, "utf8");
  const md = queue
    .slice(-60)
    .map(
      (i) =>
        `## @${i.author} · ${i.generatedAt}\n\nreply under: ${i.tweetUrl}\n\n\`\`\`\n${i.reply}\n\`\`\`\n`,
    )
    .join("\n");
  writeFileSync(join(DATA, "QUEUE.md"), `# Interception queue\n\n${md}`, "utf8");
}

/**
 * Post the draft as a reply.
 *
 * This is the "no human in the loop" half: an OAuth 1.0a user context can write, and a reply is one
 * POST with `reply.in_reply_to_tweet_id`. It is off unless `--reply` / `INTERCEPT_AUTO_REPLY=1`,
 * because an account that replies to everything is an account people mute — and because X is
 * answering 402 on this deployment, which the return value says plainly instead of pretending.
 */
async function replyOnX(item: Item): Promise<string> {
  const creds = oauthCreds();
  if (!creds) return "skipped: no OAuth 1.0a keys (X_CONSUMER_KEY / X_CONSUMER_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET)";
  const url = "https://api.x.com/2/tweets";
  const res = await postJson(
    url,
    { Authorization: oauthHeader("POST", url, creds) },
    { text: item.reply, reply: { in_reply_to_tweet_id: item.tweetId } },
  );
  if (res.ok) {
    try {
      const id = (JSON.parse(res.text) as { data?: { id?: string } }).data?.id;
      return `sent${id ? `: ${id}` : ""}`;
    } catch {
      return "sent";
    }
  }
  if (res.status === 402) return "blocked 402: X credits depleted — billing, not a code path";
  if (res.status === 403 && /unsupported authentication|application-only/i.test(res.text)) {
    return "blocked 403: the configured token is app-only (read scope only)";
  }
  if (res.status === 401) return "failed 401: signature or credentials rejected";
  if (res.status === 429) return "failed 429: rate limited after 3 attempts";
  return `failed ${res.status}: ${res.text.slice(0, 160)}`;
}

async function notify(items: Item[], chat: string | null): Promise<string> {
  if (!chat) return "skipped: no --notify-chat / INTERCEPT_NOTIFY_CHAT";
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return "skipped: TELEGRAM_BOT_TOKEN unset";
  let sent = 0;
  for (const item of items) {
    const text = [`🎯 @${item.author} (${item.tweetAgeSec}s ago)`, "", item.reply, "", `reply here → ${item.tweetUrl}`].join("\n");
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    if (res.ok) sent += 1;
    else return `failed ${res.status}: ${(await res.text()).slice(0, 160)}`;
  }
  return `sent ${sent}`;
}

// ---------------------------------------------------------------- self-test

function selfTest(): void {
  let failures = 0;
  const check = (ok: boolean, label: string) => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) failures += 1;
  };

  const pools: Pool[] = [
    { id: "700011", title: "Will AERO close above $0.7000 before October 31, 2026?", category: "Base Ecosystem", status: 1, endTimeUtc: new Date(Date.now() + 4 * 86_400_000).toISOString(), traders: 311, yesShare: 0.166, marketData: { asset: "AERO", spotUsd: 0.6421 } },
    { id: "700008", title: "Will Base TVL close above $6.10B before October 31, 2026?", category: "Base Ecosystem", status: 1, endTimeUtc: new Date(Date.now() + 2 * 86_400_000).toISOString(), traders: 282, yesShare: 0.442 },
    { id: "700001", title: "Will BTC close above $81,000 before October 31, 2026?", category: "Crypto & Macro", status: 1, endTimeUtc: new Date(Date.now() + 86_400_000).toISOString(), traders: 310, yesShare: 0.191, marketData: { asset: "BTC", spotUsd: 76587 } },
  ];

  const now = Date.now();
  const tweets: Tweet[] = [
    { id: "111", author: "AerodromeFi", text: "$AERO emissions vote goes live in an hour. veAERO holders decide.", createdAt: new Date(now - 60_000).toISOString(), url: "https://x.com/AerodromeFi/status/111" },
    { id: "112", author: "jessepollak", text: "Base TVL keeps climbing, next stop is a different order of magnitude", createdAt: new Date(now - 90_000).toISOString(), url: "https://x.com/jessepollak/status/112" },
    { id: "113", author: "AerodromeFi", text: "old $AERO news from yesterday", createdAt: new Date(now - 30 * 60_000).toISOString(), url: "https://x.com/AerodromeFi/status/113" },
    { id: "114", author: "degenbot", text: "gm, coffee first", createdAt: new Date(now - 30_000).toISOString(), url: "https://x.com/degenbot/status/114" },
  ];

  console.log("matching");
  const m1 = matchMarket(tweets[0].text, pools);
  check(m1?.pool.id === "700011", `$AERO post routes to the AERO market (got ${m1?.pool.id})`);
  const m2 = matchMarket(tweets[1].text, pools);
  check(m2?.pool.id === "700008", `"Base TVL" post routes to the Base TVL market (got ${m2?.pool.id})`);
  check(matchMarket(tweets[3].text, pools) === null, "a post with no subject is not intercepted");

  console.log("freshness + dedupe");
  const state: State = { seen: {} };
  const first = intercept(tweets, pools, state, "fixture");
  check(first.length === 2, `2 fresh relevant posts intercepted (got ${first.length})`);
  check(first.every((i) => i.tweetAgeSec <= 300), "nothing older than the 5-minute window");
  const second = intercept(tweets, pools, state, "fixture");
  check(second.length === 0, "the same tweet is never drafted twice");

  console.log("copy shape");
  for (const item of first) {
    const lines = item.reply.split("\n");
    check(lines.length >= 2 && lines.length <= 3, `${item.tweetId}: 2–3 lines (got ${lines.length})`);
    check(/YES .*█|█/.test(item.reply) && /NO/.test(item.reply), `${item.tweetId}: both sides with ASCII bars`);
    check(/→ \d+\.\d×/.test(item.reply), `${item.tweetId}: implied payout on the duel line`);
    check(item.reply.includes("?ref=x"), `${item.tweetId}: link carries ?ref=x`);
    check(item.reply.includes("/market/"), `${item.tweetId}: link points at the market, not the home page`);
    check(item.replyWeight <= 275, `${item.tweetId}: ${item.replyWeight}/275 weighted`);
    check(!/weight:|source:|market:|ref:|http/.test(item.reply), `${item.tweetId}: no operator noise, no raw http`);
  }

  console.log("\n--- sample draft ---\n" + (first[0]?.reply ?? "(none)") + "\n---------------------");

  console.log(
    failures === 0
      ? "self-test: OK — match → 5-minute window → dedupe → 3-line duel with both sides and a ref link"
      : `self-test: ${failures} failure(s)`,
  );
  if (failures > 0) process.exit(1);
}

// ---------------------------------------------------------------- main

async function probe(): Promise<void> {
  const targets = JSON.parse(readFileSync(TARGETS, "utf8")) as { accounts: string[]; queries?: string[] };
  console.log(`targets: ${targets.accounts.map((a) => "@" + a).join(" ")}`);
  if (targets.queries?.length) console.log(`cashtags: ${targets.queries.join(" ")}`);
  const reports = await collect({ ...parseArgs(["--probe"]), forceSource: null });
  let ok = 0;
  for (const r of reports) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.source} ${r.ok ? "" : String(r.status)} — ${r.detail}`);
    if (r.ok) ok += 1;
  }
  if (ok === 0) {
    console.log(
      [
        "",
        "no source can read X from here. That is a credential/network fact, not a bug:",
        "  · x_api  → set X_BEARER_TOKEN (CI has it as a repo secret) and the plan must have read quota;",
        "  · browser → run `--login` once on a residential connection with X_PROFILE_DIR set;",
        "  · nitter  → public mirrors need a live guest token; none has one right now.",
      ].join("\n"),
    );
  }
}

async function sweep(args: Args): Promise<number> {
  const pools = loadPools();
  if (pools.length === 0) {
    console.error("no open markets in the manifest — run scripts/refresh-board.sh first");
    return 1;
  }
  const state = readState();
  const reports = await collect(args);
  const okReports = reports.filter((r) => r.ok);
  const tweets = okReports.flatMap((r) => r.tweets);
  const items = intercept(tweets, pools, state, okReports[0]?.source ?? "x_api");

  if (items.length === 0) {
    const why = okReports.length === 0 ? reports.map((r) => `${r.source}:${r.status} ${r.detail}`).join(" | ") : `${tweets.length} tweets, none fresh and relevant`;
    console.log(`[${new Date().toISOString()}] nothing to intercept — ${why}`);
    if (!args.dryRun) writeState(state);
    // 2 = every source failed. A watch window that cannot read X is not a watch window, and
    // burning 5.5 runner-hours to print the same 402 every 90 seconds helps nobody.
    return okReports.length === 0 ? 2 : 0;
  }

  for (const item of items) {
    console.log(`\n🎯 @${item.author} · ${item.tweetAgeSec}s old · market ${item.marketId}`);
    console.log(item.reply);
    console.log(`   → reply under ${item.tweetUrl}`);
  }
  if (!args.dryRun) {
    persist(items);
    writeState(state);
  }
  const delivery = await notify(items, args.notifyChat);
  console.log(`\nqueued ${items.length} · telegram ${delivery}`);

  // Auto-reply, when switched on. Each result is printed as the channel states it (sent / 402 /
  // 403 / skipped), so the first run on a live credential cannot be mistaken for success.
  if (args.reply) {
    for (const item of items) {
      const result = await replyOnX(item);
      console.log(`reply → ${item.tweetUrl}: ${result}`);
    }
  }
  return 0;
}

async function watch(args: Args): Promise<void> {
  const deadline = Date.now() + args.minutes * 60_000;
  console.log(`interceptor watching every ${args.interval}s for ${args.minutes}m`);
  let blind = 0;
  while (Date.now() < deadline) {
    try {
      const code = await sweep(args);
      blind = code === 2 ? blind + 1 : 0;
      if (blind >= 2) {
        console.log("stopping early: no source can read X (see --probe) — fix the credential and rerun");
        return;
      }
    } catch (err) {
      console.error(`sweep failed: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, args.interval * 1000));
  }
  console.log("watch window closed");
}

async function login(): Promise<void> {
  const profile = process.env.X_PROFILE_DIR ?? join(homedir(), ".hermes", "x-profile");
  const req = require("node:module").createRequire(join(ROOT, "frontend", "package.json"));
  const { chromium } = req("playwright-core");
  const ctx = await chromium.launchPersistentContext(profile, { headless: false, viewport: { width: 1280, height: 900 } });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://x.com/login");
  console.log(`sign in in the window that just opened; the session is stored in ${profile}`);
  console.log("press Ctrl-C here when done.");
  await new Promise(() => {});
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.selfTest) return selfTest();
  if (args.login) return login();
  if (args.probe) return probe();
  if (args.watch) return watch(args);
  process.exitCode = await sweep(args);
}

main().catch((err) => {
  console.error(`interceptor failed: ${(err as Error).message}`);
  process.exit(1);
});
