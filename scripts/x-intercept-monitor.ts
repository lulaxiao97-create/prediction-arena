/**
 * Public cold-start interceptor — find a target account's newest tweet, draft the reply.
 *
 * X answers 403 to this host (datacenter IP, no API credits), so reading goes through a Nitter
 * mirror reached via twiiit.com (`/rss` is the cheap, cache-friendly endpoint). That path is chosen
 * because it is the only one that actually returns data here — `active-x-interceptor.ts --probe`
 * documents the other three and why each one is dead right now.
 *
 * Output is a queue, not a post: one JSON job per (handle, tweet), under `.data/intercept/reply-queue/`.
 * `x-intercept-daemon.sh` is what decides when a job is allowed to be typed into the signed-in
 * browser — this script never touches the desktop.
 *
 *   bun scripts/x-intercept-monitor.ts                # one sweep, write jobs for fresh tweets
 *   bun scripts/x-intercept-monitor.ts --dry          # print what it would queue, touch nothing
 *   bun scripts/x-intercept-monitor.ts --handle=base  # single account
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildReply, type Market } from "./lib/genesis-copy";

const ROOT = join(import.meta.dir, "..");
const CONFIG = join(ROOT, "scripts", "config", "intercept-targets.json");
const STATE = join(ROOT, ".data", "intercept", "reply-state.json");
const QUEUE = join(ROOT, ".data", "intercept", "reply-queue");
const HOT = join(ROOT, ".data", "hot.json");

/** A reply that lands after the thread is cold is just noise — 45 minutes is the useful window. */
const FRESH_MS = Number(process.env.INTERCEPT_FRESH_MIN ?? 45) * 60_000;
const MAX_PER_SWEEP = Number(process.env.INTERCEPT_MAX_PER_SWEEP ?? 3);
const X_LIMIT = 280;

const dry = process.argv.includes("--dry");
const onlyHandle = process.argv.find((a) => a.startsWith("--handle="))?.split("=")[1];

type State = Record<string, { lastId: string; seenAt: string; replied?: string[] }>;
type Job = {
  handle: string;
  tweetId: string;
  url: string;
  text: string;
  createdAt: string;
  queuedAt: string;
  variant: string;
  /** The pool the copy is about, so the TTL collector can kill a job whose market has ended. */
  marketId: string | null;
};

const SITE = "https://predictionarena.online";
const HANDLE = "@Predict065"; // the account we own; @PredictionArena is somebody else's
const TG = "t.me/predictaing_bot";

/** X counts a URL as 23 chars and non-Latin as 2 — budget against that, not `.length`. */
function weighted(s: string): number {
  let n = 0;
  for (const ch of s.replace(/https?:\/\/\S+/g, "\u0001")) {
    n += ch === "\u0001" ? 23 : (ch.codePointAt(0) ?? 0) > 0x2000 ? 2 : 1;
  }
  return n;
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** curl, not fetch: it honours HTTPS_PROXY, which is how this box reaches the mirror at all. */
function curl(url: string): string | null {
  try {
    const p = Bun.spawnSync(
      ["curl", "-sL", "-m", "30", "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", url],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env } },
    );
    if (p.exitCode !== 0) return null;
    return p.stdout.toString();
  } catch {
    return null;
  }
}

type RssItem = { title: string; link: string; pubDate: string; id: string; retweet: boolean; reply: boolean };

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  for (const raw of xml.split("<item>").slice(1)) {
    const block = raw.split("</item>")[0] ?? "";
    const pick = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "") : "";
    };
    const link = pick("link");
    const id = link.match(/status\/(\d+)/)?.[1];
    if (!id) continue;
    const title = pick("title")
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .trim();
    // Nitter prefixes retweets with "RT by @x:" (replying under a retweet talks to the wrong author)
    // and replies with "R to @x:" (replying under somebody's reply buries the comment two levels
    // deep and usually answers a person, not the account). Both are skipped.
    const retweet = /^RT by @/i.test(title);
    const reply = /^R to @/i.test(title);
    items.push({ title, link, pubDate: pick("pubDate"), id, retweet, reply });
  }
  return items;
}

/** The market the reply hangs off: the hottest live pool, with the numbers the copy needs. */
function hottest(): Market | null {
  try {
    const hot = JSON.parse(readFileSync(HOT, "utf8")) as {
      hot?: { id: string | number; title: string; yes?: number; oddsYes?: string; oddsNo?: string; endsIn?: string }[];
    };
    const p = hot.hot?.[0];
    if (!p) return null;
    return {
      id: String(p.id),
      title: String(p.title),
      yes: typeof p.yes === "number" ? Math.round(p.yes) : 0,
      oddsYes: p.oddsYes ?? "",
      oddsNo: p.oddsNo ?? "",
      endsIn: p.endsIn ?? "",
    };
  } catch {
    return null;
  }
}

/** Mirrors in preference order. twiiit rotates instances and 403s under load, so the fixed instance
 *  is tried first and twiiit is the fallback, not the other way round. */
const MIRRORS = (process.env.INTERCEPT_MIRRORS ?? "https://nitter.kareem.one,https://twiiit.com")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

function fetchFeed(handle: string): string | null {
  for (const base of MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const xml = curl(`${base}/${handle}/rss`);
      if (xml && xml.includes("<item>")) return xml;
      Bun.sleepSync(3_000);
    }
  }
  return null;
}

function main() {
  const cfg = readJson<{ accounts?: string[] }>(CONFIG, { accounts: [] });
  const handles = (onlyHandle ? [onlyHandle] : cfg.accounts ?? []).filter(Boolean);
  if (!handles.length) {
    console.log("no targets configured");
    process.exit(1);
  }

  const state = readJson<State>(STATE, {});
  if (!dry) mkdirSync(QUEUE, { recursive: true });
  const now = Date.now();
  const queued: Job[] = [];
  const report: string[] = [];

  for (const handle of handles) {
    const xml = fetchFeed(handle);
    if (!xml) {
      report.push(`  ${handle}: no feed (every mirror refused)`);
      continue;
    }
    const items = parseRss(xml).filter((i) => !i.retweet && !i.reply);
    if (!items.length) {
      report.push(`  ${handle}: only retweets/replies in feed`);
      continue;
    }
    // Newest first: nitter RSS is already descending, but do not trust it across mirrors.
    items.sort((x, y) => Number(y.id) - Number(x.id));
    const newest = items[0];
    const age = now - Date.parse(newest.pubDate);
    const prev = state[handle];

    if (prev && BigInt(newest.id) <= BigInt(prev.lastId)) {
      report.push(`  ${handle}: no new tweet (last ${prev.lastId})`);
      continue;
    }
    if (Number.isFinite(age) && age > FRESH_MS) {
      state[handle] = { ...prev, lastId: newest.id, seenAt: new Date().toISOString() };
      report.push(`  ${handle}: newest is ${Math.round(age / 60000)}m old — stale, skipped`);
      continue;
    }
    if (prev?.replied?.includes(newest.id)) {
      report.push(`  ${handle}: already replied to ${newest.id}`);
      continue;
    }
    if (queued.length >= MAX_PER_SWEEP) {
      report.push(`  ${handle}: sweep cap reached, leaving ${newest.id} for next tick`);
      continue;
    }

    const variant: "a" | "b" = queued.length % 2 === 0 ? "a" : "b";
    const market = hottest();
    const text = buildReply(market, variant);
    if (weighted(text) > X_LIMIT) {
      report.push(`  ${handle}: copy is ${weighted(text)} weighted chars — over ${X_LIMIT}, not queued`);
      continue;
    }
    const job: Job = {
      handle,
      tweetId: newest.id,
      url: `https://x.com/${handle}/status/${newest.id}`,
      text,
      createdAt: newest.pubDate,
      queuedAt: new Date().toISOString(),
      variant,
      marketId: market?.id ?? null,
    };
    queued.push(job);
    state[handle] = { ...prev, lastId: newest.id, seenAt: new Date().toISOString() };
    report.push(`  ${handle}: QUEUED ${newest.id} (${weighted(text)}/280) “${newest.title.slice(0, 60)}”`);
  }

  console.log(`sweep · ${handles.length} handles · ${queued.length} job(s)`);
  for (const line of report) console.log(line);

  if (dry) return;

  for (const job of queued) {
    writeFileSync(join(QUEUE, `${job.handle}-${job.tweetId}.json`), `${JSON.stringify(job, null, 2)}\n`);
  }
  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);

  // Drop jobs whose tweet is no longer worth replying to, so the queue cannot grow forever.
  for (const name of readdirSync(QUEUE)) {
    if (!name.endsWith(".json")) continue;
    const p = join(QUEUE, name);
    const job = readJson<Job | null>(p, null);
    if (!job) continue;
    if (Date.now() - Date.parse(job.queuedAt) > 6 * 60 * 60_000) {
      try {
        Bun.spawnSync(["rm", "-f", p]);
      } catch {
        /* ignore */
      }
    }
  }
}

main();
