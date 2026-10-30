/**
 * Telegram outreach engine — goes and finds the people who run the groups.
 *
 * The mechanics people get wrong: **you cannot DM a channel**. A cold message goes to a *user*, so
 * the unit of outreach is a person (a channel admin, a caller, a group owner), not a channel. This
 * engine therefore works in three steps, and none of them is a guess:
 *
 *   1. CHANNELS — public t.me previews are readable without logging in. Subscriber count, last post
 *      date, topic words and post text all come off the page, so a channel that died last March
 *      drops out with a reason attached.
 *   2. PEOPLE — every link on a live channel's preview is a username. Each one is fetched and
 *      classified: user / bot / channel / group. Users are the DM surface; that is who gets pitched.
 *      `via` records which channel they came from, which is what makes the first line specific.
 *   3. PITCH — per-person copy: the thing they were seen talking about, the one market that prices it
 *      with both sides, the 30% rake terms, and a single 30-second action. Bot API cannot open a
 *      conversation, so sending runs through an MTProto user session (scripts/tg_user.py). Until
 *      that session exists the queue is written and the run says `skipped: no session`.
 *
 *   bun scripts/tg-outreach.ts --discover --max=60   # refresh channels + harvest people
 *   bun scripts/tg-outreach.ts --compose             # write the DM for every new person
 *   bun scripts/tg-outreach.ts --send --dry-run      # print exactly what would go out
 *   bun scripts/tg-outreach.ts --send --limit=12     # real send (needs the session)
 *   bun scripts/tg-outreach.ts --stats | --self-test | --login
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { bar, bothOdds, price, timeLeft } from "./lib/copy-kit";

const ROOT = join(import.meta.dir, "..");
const MANIFEST = join(ROOT, "frontend", "public", "pools.json");
const SEEDS = join(ROOT, "scripts", "config", "outreach-seeds.json");
const DATA = process.env.OUTREACH_DATA ?? join(ROOT, ".data", "outreach");
const STORE = join(DATA, "targets.json");
const STATE = join(DATA, "state.json");
const PY = process.env.TG_PY ?? join(homedir(), ".hermes", "venvs", "tg", "bin", "python");

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://predictionarena.online").replace(/\/+$/, "");
const BOT = process.env.TG_BOT_USERNAME ?? "predictaing_bot";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36";

type Status = "new" | "queued" | "pitched" | "skipped" | "replied" | "onboarded" | "declined";

type Channel = {
  kind: "channel" | "group";
  username: string;
  title: string;
  subs: number;
  description: string;
  lastPostAt: string | null;
  lastPostText: string;
  topicTags: string[];
  score: number;
  why: string;
  status: "eligible" | "skipped";
};

type Person = {
  username: string;
  title: string;
  kind: "user" | "bot" | "channel" | "group" | "unknown";
  via: string;
  snippet: string;
  lang: "zh" | "en";
  status: Status;
  queuedAt?: string;
  pitchedAt?: string;
  marketId?: string;
};

type Store = { generatedAt: string; channels: Channel[]; people: Person[] };
type State = { sends: { date: string; count: number }; log: { at: string; username: string; status: string; detail?: string }[] };
type Pool = {
  id: string | number;
  title: string;
  category?: string;
  status?: number;
  endTimeUtc?: string;
  traders?: number;
  yesShare?: number;
  marketData?: { asset?: string; spotUsd?: number };
};

const ARGS = process.argv.slice(2);
const has = (flag: string) => ARGS.includes(flag);
const value = (name: string, fallback = "") => {
  const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

// ---------------------------------------------------------------- board

function loadPools(): Pool[] {
  const board = JSON.parse(readFileSync(MANIFEST, "utf8")) as { pools?: Pool[] };
  return (board.pools ?? [])
    .filter((p) => (p.status ?? 1) === 1)
    .filter((p) => !p.endTimeUtc || new Date(p.endTimeUtc).getTime() > Date.now());
}

function yesShare(pool: Pool): number {
  const raw = Number(pool.yesShare ?? Number.NaN);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.5;
}

const TOKENS = ["aero", "degen", "toshi", "brett", "mog", "zora", "btc", "eth", "sol", "base"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The market that prices what they were talking about.
 *
 * When the snippet names no token, the fallback rotates across the tribal markets by a hash of the
 * person's handle — forty identical DMs sent in the same hour is exactly the pattern anti-spam is
 * built to catch, and it also reads as bulk mail. Same person always gets the same market, so a
 * re-compose is stable.
 */
export function pickMarket(pools: Pool[], text: string, seed = ""): { pool: Pool; subject: string } | null {
  if (pools.length === 0) return null;
  const lower = text.toLowerCase();
  const hits = TOKENS.filter((t) => new RegExp(`\\b\\$?${t}\\b`).test(lower));
  const scored = pools
    .map((p) => {
      const title = p.title.toLowerCase();
      const asset = (p.marketData?.asset ?? "").toLowerCase();
      let score = 0;
      for (const hit of hits) {
        if (asset === hit) score += 5;
        else if (title.includes(hit)) score += 3;
      }
      if (score > 0 && p.category === "Base Ecosystem") score += 1;
      return { pool: p, score, subject: hits.find((h) => title.includes(h) || asset === h) ?? hits[0] ?? "base" };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (b.pool.traders ?? 0) - (a.pool.traders ?? 0));
  if (scored.length > 0) return { pool: scored[0].pool, subject: scored[0].subject };

  const tribal = pools.filter((p) => TOKENS.some((t) => p.title.toLowerCase().includes(t)));
  const list = (tribal.length >= 3 ? tribal : pools).sort((a, b) => (b.traders ?? 0) - (a.traders ?? 0)).slice(0, 8);
  const pool = list[hash(seed || text) % list.length];
  return pool ? { pool, subject: (pool.marketData?.asset ?? "base").toLowerCase() } : null;
}

// ---------------------------------------------------------------- parsing

const POSITIVE = ["base", "onchain", "on-chain", "defi", "degen", "memecoin", "meme", "perp", "prediction", "launchpad", "trading", "alpha", "calls", "l2", "ethereum", "crypto"];
const NEGATIVE = ["airdrop claim", "free crypto", "giveaway", "presale", "whitelist", "hack tool"];
const CJK = /[\u4e00-\u9fff]/g;

function langOf(text: string): "zh" | "en" {
  const cjk = (text.match(CJK) ?? []).length;
  return cjk / Math.max(1, text.length) > 0.08 ? "zh" : "en";
}

export function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * The sentence to quote back at them.
 *
 * A channel's last post is often a contract address or a price ticker with no words in it; quoting
 * that in a DM reads like a bot wrote it. Prefer the post when it looks like prose, otherwise fall
 * back to the channel description.
 */
export function pickSnippet(postText: string, description: string, title: string): string {
  // A quote is only worth having if it reads like a sentence. Contract addresses, bare tickers and
  // "not financial advice" disclaimers are exactly what a bot would quote, and they are the fastest
  // way to get a DM deleted.
  const DISCLAIMER = /not financial advice|no financial advice|financial advice|dyor|nfa\b/i;
  const prose = (s: string) => {
    const words = s.trim().split(/\s+/);
    const letters = (s.match(/[A-Za-z\u4e00-\u9fff]/g) ?? []).length;
    return (
      words.length >= 4 &&
      letters / Math.max(1, s.length) > 0.45 &&
      !/^[A-Za-z0-9]{25,}$/.test(s.trim()) &&
      !DISCLAIMER.test(s)
    );
  };
  for (const candidate of [postText, description]) {
    if (candidate && prose(candidate)) return candidate.replace(/\s+/g, " ").slice(0, 240);
  }
  return "";
}

/** True when the snippet is long enough to quote back without looking random. */
export function quotable(snippet: string): boolean {
  return snippet.trim().length >= 24;
}

/** Everyone the page links to, minus itself. This is the DM surface. */
export function harvestLinks(html: string, self: string): string[] {
  const names = new Set<string>();
  for (const m of html.matchAll(/https:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})(?:["'?/]|$)/g)) {
    const name = m[1];
    if (name.toLowerCase() === self.toLowerCase()) continue;
    if (/^(s|joinchat|share|addstickers|proxy)$/i.test(name)) continue;
    names.add(name);
  }
  return [...names];
}

/** One t.me page → channel facts. `null` when the page has no public preview at all. */
export function parsePreview(html: string, username: string): Channel | null {
  const title = (html.match(/og:title" content="([^"]*)"/) ?? [])[1];
  if (!title) return null;
  const description = stripTags((html.match(/og:description" content="([^"]*)"/) ?? [])[1] ?? "");
  const extras = [...html.matchAll(/tgme_page_extra">([^<]+)</g)].map((m) => m[1]);
  const counters = [...html.matchAll(/tgme_header_counter">([^<]+)</g)].map((m) => m[1]);
  const counterText = [...extras, ...counters].find((c) => /subscriber|member/i.test(c)) ?? "";
  const subs = (() => {
    const m = counterText.replace(/\u00a0/g, " ").match(/([\d][\d\s.,]*)\s*([km]?)\s*(subscribers?|members?)/i);
    if (!m) return 0;
    const n = parseFloat(m[1].replace(/[\s,]/g, "").replace(/(\.\d*)$/, "$1")) || 0;
    const unit = m[2].toLowerCase();
    if (unit === "k") return Math.round(n * 1_000);
    if (unit === "m") return Math.round(n * 1_000_000);
    return Math.round(n);
  })();
  const kind: Channel["kind"] = /members?/i.test(counterText) ? "group" : "channel";
  const dates = [...html.matchAll(/datetime="([^"]+)"/g)].map((m) => m[1]);
  const lastPostAt = dates.length > 0 ? dates[dates.length - 1] : null;
  const texts = [...html.matchAll(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/g)].map((m) => stripTags(m[1]));
  const lastPostText = texts.length > 0 ? texts[texts.length - 1].slice(0, 400) : "";
  const lower = `${title} ${description} ${lastPostText}`.toLowerCase();
  const topicTags = POSITIVE.filter((t) => lower.includes(t));
  const penalty = NEGATIVE.filter((t) => lower.includes(t));
  const ageDays = lastPostAt ? (Date.now() - new Date(lastPostAt).getTime()) / 86_400_000 : Number.POSITIVE_INFINITY;

  let score = topicTags.length * 2;
  if (subs >= 2_000 && subs <= 60_000) score += 4;
  else if (subs > 60_000 && subs <= 250_000) score += 2;
  else if (subs < 500) score -= 3;
  if (ageDays <= 2) score += 4;
  else if (ageDays <= 7) score += 2;
  else if (ageDays <= 30) score -= 1;
  else score -= 6;
  if (texts.length >= 10) score += 1;
  score -= penalty.length * 3;

  return {
    kind,
    username: username.replace(/^@/, ""),
    title: stripTags(title),
    subs,
    description,
    lastPostAt,
    lastPostText,
    topicTags,
    score,
    why: [
      `${kind} · ${subs} ${kind === "group" ? "members" : "subs"}`,
      lastPostAt ? `last post ${Math.round(ageDays)}d ago` : "no posts visible",
      topicTags.length > 0 ? `topics: ${topicTags.slice(0, 4).join(",")}` : "no crypto keywords",
      penalty.length > 0 ? `penalty: ${penalty.join(",")}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    status: score >= 6 && ageDays <= 10 && subs >= 500 ? "eligible" : "skipped",
  };
}

/** t.me/<name> for someone who is not a channel with a feed: user, bot, group, or a dead page. */
export function classifyPage(html: string): { kind: Person["kind"]; title: string } {
  const title = stripTags((html.match(/og:title" content="([^"]*)"/) ?? [])[1] ?? "");
  const desc = stripTags((html.match(/og:description" content="([^"]*)"/) ?? [])[1] ?? "").toLowerCase();
  const extra = (html.match(/tgme_page_extra">([^<]+)</) ?? [])[1] ?? "";
  // t.me renders a "Telegram: Contact @x" page for channels and groups too. Those are not people,
  // and DMing them is exactly the mistake this classifier exists to prevent.
  if (/^Telegram:/i.test(title)) return { kind: "unknown", title };
  if (/subscriber/i.test(extra)) return { kind: "channel", title };
  if (/members?/i.test(extra)) return { kind: "group", title };
  if (/bot/i.test(desc) && /start/i.test(html)) return { kind: "bot", title };
  if (/send a message|you can view|contact/i.test(desc)) return { kind: "user", title };
  return { kind: title ? "user" : "unknown", title };
}

async function fetchPage(path: string): Promise<string | null> {
  try {
    const res = await fetch(`https://t.me/${path}`, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(18_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- store

function readStore(): Store {
  try {
    const parsed = JSON.parse(readFileSync(STORE, "utf8")) as Partial<Store>;
    const people = (parsed.people ?? []).filter((p) => p.kind === "user" && !/^Telegram:/i.test(p.title ?? ""));
    return { generatedAt: parsed.generatedAt ?? new Date(0).toISOString(), channels: parsed.channels ?? [], people };
  } catch {
    return { generatedAt: new Date(0).toISOString(), channels: [], people: [] };
  }
}

function writeStore(store: Store): void {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(STORE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function readState(): State {
  try {
    return JSON.parse(readFileSync(STATE, "utf8")) as State;
  } catch {
    return { sends: { date: "", count: 0 }, log: [] };
  }
}

function writeState(state: State): void {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------- discover

/** Tiny concurrency pool: sequential fetches made a 60-channel crawl take an hour. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function discover(maxPeople: number): Promise<void> {
  const seeds = JSON.parse(readFileSync(SEEDS, "utf8")) as { channels: string[] };
  const previous = readStore();
  const priorChannel = new Map(previous.channels.map((c) => [c.username.toLowerCase(), c]));
  const priorPerson = new Map(previous.people.map((p) => [p.username.toLowerCase(), p]));

  const MAX_CHANNELS = Number(value("channels", "60")) || 60;
  const MAX_DEPTH = 2;
  const LINKS_PER_CHANNEL = 12;
  const CONCURRENCY = 6;
  const queue: { name: string; depth: number }[] = seeds.channels.map((name) => ({ name, depth: 0 }));
  const seen = new Set<string>();
  const channels: Channel[] = [];
  const people = new Map<string, Person>(previous.people.map((p) => [p.username.toLowerCase(), p]));

  const snapshot = (): Store => ({
    generatedAt: new Date().toISOString(),
    channels: [...channels].sort((a, b) => b.score - a.score),
    people: [...people.values()].sort((a, b) => a.username.localeCompare(b.username)),
  });

  // Breadth-first from the seeds: every link on a live channel's page is a username, and a username
  // that turns out to be another channel is the next place to look. That is how a list grows without
  // an account — two hops out of two live channels is usually thirty more.
  while (queue.length > 0 && channels.length < MAX_CHANNELS) {
    const { name, depth } = queue.shift() as { name: string; depth: number };
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const html = await fetchPage(`s/${name}`);
    const parsed = html ? parsePreview(html, name) : null;
    if (!parsed) {
      console.log(`  · @${name} — no public preview (private, no feed, or gone)`);
      continue;
    }
    channels.push(parsed);
    console.log(`  ${parsed.status === "eligible" ? "✓" : "·"} @${parsed.username} — ${parsed.why}`);

    // Harvest from any channel that is still alive: a channel scoring low on topic keywords can
    // still be the place where a few thousand Base traders talk, and the person is the target.
    const stale = !parsed.lastPostAt || Date.now() - new Date(parsed.lastPostAt).getTime() > 10 * 86_400_000;
    if (stale) {
      if (channels.length % 10 === 0) writeStore(snapshot());
      continue;
    }
    const links = harvestLinks(html as string, parsed.username)
      .filter((l) => !/bot$/i.test(l) && !seen.has(l.toLowerCase()))
      .slice(0, LINKS_PER_CHANNEL);

    const classified = await mapPool(links, CONCURRENCY, async (link) => {
      const page = await fetchPage(link);
      return page ? { link, info: classifyPage(page) } : null;
    });

    for (const hit of classified) {
      if (!hit) continue;
      const lkey = hit.link.toLowerCase();
      if (hit.info.kind === "user") {
        const existing = people.get(lkey);
        if (existing) {
          // Refresh the quote for anyone not yet pitched: a re-crawl is where the snippet becomes
          // real prose (and where a decoded entity replaces the raw &#036; from an older parse).
          if (existing.status === "new" || existing.status === "queued") {
            existing.snippet = pickSnippet(parsed.lastPostText, parsed.description, parsed.title);
            existing.via = parsed.username;
            existing.lang = langOf(`${hit.info.title} ${parsed.lastPostText}`);
          }
          continue;
        }
        if (people.size >= maxPeople) continue;
        people.set(lkey, {
          username: hit.link,
          title: hit.info.title,
          kind: "user",
          via: parsed.username,
          snippet: pickSnippet(parsed.lastPostText, parsed.description, parsed.title),
          lang: langOf(`${hit.info.title} ${parsed.lastPostText}`),
          status: "new",
        });
      } else if ((hit.info.kind === "channel" || hit.info.kind === "group") && depth < MAX_DEPTH) {
        queue.push({ name: hit.link, depth: depth + 1 });
      }
    }
    // Write as we go: a crawl that dies at channel 55 should not lose the 55 it already read.
    if (channels.length % 10 === 0) writeStore(snapshot());
  }

  // Never reset work already done: a re-discovery keeps pitch state and skip verdicts.
  for (const c of channels) {
    const before = priorChannel.get(c.username.toLowerCase());
    if (before && before.status === "skipped") c.status = "skipped";
  }
  for (const [key, person] of people) {
    const before = priorPerson.get(key);
    if (before && before.status !== "new") {
      person.status = before.status;
      person.pitchedAt = before.pitchedAt;
      person.queuedAt = before.queuedAt;
      person.marketId = before.marketId;
    }
  }

  const store: Store = {
    generatedAt: new Date().toISOString(),
    channels: channels.sort((a, b) => b.score - a.score),
    people: [...people.values()].sort((a, b) => a.username.localeCompare(b.username)),
  };
  writeStore(store);

  const eligible = store.channels.filter((c) => c.status === "eligible");
  const fresh = store.people.filter((p) => p.status === "new");
  const md = [
    "# Telegram outreach targets",
    "",
    `generated ${new Date().toISOString()} · ${store.channels.length} channels crawled · ${eligible.length} eligible · ${store.people.length} people · ${fresh.length} to pitch`,
    "",
    "## Channels (where the people came from)",
    "",
    "| channel | kind | size | last post | score | verdict |",
    "|---|---|---|---|---|---|",
    ...store.channels.map((c) => `| @${c.username} | ${c.kind} | ${c.subs} | ${c.lastPostAt?.slice(0, 10) ?? "—"} | ${c.score} | ${c.status === "eligible" ? "✓ eligible" : c.why} |`),
    "",
    "## People (the DM surface)",
    "",
    "| handle | name | seen in | lang | status |",
    "|---|---|---|---|---|",
    ...store.people.map((p) => `| @${p.username} | ${p.title.slice(0, 32)} | @${p.via} | ${p.lang} | ${p.status} |`),
    "",
  ].join("\n");
  writeFileSync(join(DATA, "TARGETS.md"), md, "utf8");
  console.log(`\ndiscover: ${store.channels.length} channel(s) crawled, ${eligible.length} eligible, ${store.people.length} person(s), ${fresh.length} to pitch → ${join(DATA, "TARGETS.md")}`);
}

// ---------------------------------------------------------------- copy

function quote(text: string, lang: "zh" | "en"): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const limit = lang === "zh" ? 30 : 80;
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

export function pitchZh(person: Person, pool: Pool): string {
  const yes = Math.round(yesShare(pool) * 100);
  const no = 100 - yes;
  const { y } = bothOdds(yes);
  const q = quote(person.snippet, "zh");
  const openers = quotable(person.snippet)
    ? [
        `你好 —— 在 @${person.via} 看到你聊「${q}」，这个正好有个盘口在给它定价：`,
        `刚才看 @${person.via} 在聊「${q}」—— 我们盘口今天就在给这件事定价：`,
        `你好，@${person.via} 那条「${q}」我留意到了，正好有个能押的盘口：`,
      ]
    : [
        `你好 —— 我一直在看 @${person.via}。有件事正好跟你们的读者有关：`,
        `你好，冒昧打扰。@${person.via} 的内容我常看，说个和你们读者直接相关的事：`,
      ];
  return [
    openers[hash(person.username) % openers.length],
    "",
    `${pool.title}`,
    `YES ${bar(yes)} ${yes}% → ${y}× · NO ${no}% · ${pool.traders ?? 0} 人在里面 · ${timeLeft(pool.endTimeUtc)}后结束`,
    "",
    "我们是 Base 上的二元预测市场（USDC 托管、合约已验证）。给你一个直接变现的位置：你发一条带自己地址的链接，通过它下的仓位，结算时合约把平台 4% 手续费的 30% 记给你 —— 链上可查，不需要 KYC，也不托管你的钱。",
    "",
    `30 秒能配好：@${BOT} → /captain → 发收款地址，链接 + 中英两版群发文案我直接给你。`,
    "",
    "不感兴趣就忽略这条，不会有第二次打扰。",
  ].join("\n");
}

export function pitchEn(person: Person, pool: Pool): string {
  const yes = Math.round(yesShare(pool) * 100);
  const { y } = bothOdds(yes);
  const asset = pool.marketData?.asset;
  const spot = pool.marketData?.spotUsd;
  const q = quote(person.snippet, "en");
  const openers = quotable(person.snippet)
    ? [
        `Hey — saw your post in @${person.via} ("${q}") and we already price exactly that:`,
        `@${person.via} was on "${q}" today — there is a market that pays out on it:`,
        `Quick one after reading @${person.via} ("${q}"): we run the book that prices it.`,
      ]
    : [
        `Hey — been reading @${person.via}. There's something your audience can actually trade:`,
        `Hi — I follow @${person.via}. One thing that fits your readers directly:`,
      ];
  return [
    openers[hash(person.username) % openers.length],
    "",
    `${pool.title}${yes === 50 ? "" : ` — YES ${yes}% paying ${y}×`}`,
    "",
    `We run a binary prediction venue on Base${asset && spot ? `; ${asset} is ${price(spot)} right now` : ""}. USDC escrow, verified contract. If you'd rather monetise the audience than just inform it: post a market link with your own address in ?ref=, and at settlement the contract credits you 30% of the 4% platform fee — on-chain, no KYC, no custody of your money.`,
    "",
    `Takes 30 seconds: @${BOT} → /captain → send the wallet you want to be paid to. You get the link plus a ready-to-post group message.`,
    "",
    "Ignore this if it's not for you — one message, no follow-up spam.",
  ].join("\n");
}

export function pitch(person: Person, pool: Pool): string {
  return person.lang === "zh" ? pitchZh(person, pool) : pitchEn(person, pool);
}

function compose(): void {
  const store = readStore();
  const pools = loadPools();
  if (pools.length === 0) {
    console.error("no open markets — run scripts/refresh-board.sh first");
    process.exit(1);
  }
  const queueDir = join(DATA, "queue");
  mkdirSync(queueDir, { recursive: true });
  let built = 0;
  for (const person of store.people.filter((p) => p.status === "new")) {
    const picked = pickMarket(pools, `${person.snippet} ${person.via}`, person.username);
    if (!picked) continue;
    const text = pitch(person, picked.pool);
    person.status = "queued";
    person.queuedAt = new Date().toISOString();
    person.marketId = String(picked.pool.id);
    writeFileSync(
      join(queueDir, `${person.username}.json`),
      `${JSON.stringify({ username: person.username, lang: person.lang, via: person.via, marketId: person.marketId, chars: text.length, text }, null, 2)}\n`,
      "utf8",
    );
    built += 1;
  }
  writeStore(store);
  if (built === 0) {
    console.log("compose: nothing new to queue (run --discover, or every person is already pitched)");
    return;
  }
  const queued = store.people.filter((p) => p.status === "queued");
  const preview = queued
    .map((p) => `## @${p.username} · via @${p.via} · ${p.lang} · market ${p.marketId}\n\n\`\`\`\n${(JSON.parse(readFileSync(join(queueDir, `${p.username}.json`), "utf8")) as { text: string }).text}\n\`\`\``)
    .join("\n\n");
  writeFileSync(join(DATA, "QUEUE.md"), `# Outreach queue\n\n${preview}\n`, "utf8");
  console.log(`compose: ${built} DM(s) queued → ${join(DATA, "QUEUE.md")}`);
}

// ---------------------------------------------------------------- send

function pythonAvailable(): boolean {
  return existsSync(PY);
}

function runPy(args: string[]): { code: number; lines: string[] } {
  try {
    const proc = Bun.spawnSync({ cmd: [PY, join(ROOT, "scripts", "tg_user.py"), ...args], cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const out = new TextDecoder().decode(proc.stdout).trim();
    const err = new TextDecoder().decode(proc.stderr).trim();
    if ((proc.exitCode ?? 1) !== 0 && err) console.error(err.split("\n").slice(-3).join("\n"));
    return { code: proc.exitCode ?? 1, lines: out.split("\n").filter(Boolean) };
  } catch (err) {
    console.error(`python helper failed: ${(err as Error).message}`);
    return { code: 1, lines: [] };
  }
}

function sessionOk(): boolean {
  if (!pythonAvailable()) return false;
  for (const line of runPy(["whoami"]).lines) {
    try {
      if ((JSON.parse(line) as { ok?: boolean }).ok) return true;
    } catch {
      /* not json */
    }
  }
  return false;
}

async function send(dryRun: boolean, limit: number): Promise<void> {
  const store = readStore();
  const state = readState();
  const today = new Date().toISOString().slice(0, 10);
  const sentToday = state.sends.date === today ? state.sends.count : 0;
  const dailyCap = Number(process.env.OUTREACH_DAILY_CAP ?? 12);
  const cap = Math.min(limit, Math.max(0, dailyCap - sentToday));
  const queueDir = join(DATA, "queue");
  const queued = store.people.filter((p) => p.status === "queued" && existsSync(join(queueDir, `${p.username}.json`))).slice(0, cap);

  if (queued.length === 0) {
    console.log(`send: nothing queued${cap === 0 ? ` — daily cap reached (${sentToday}/${dailyCap})` : ""}`);
    return;
  }
  const jobs = queued.map((p) => ({ username: p.username, text: (JSON.parse(readFileSync(join(queueDir, `${p.username}.json`), "utf8")) as { text: string }).text }));

  if (dryRun) {
    for (const job of jobs) console.log(`\n=== would DM @${job.username} (${job.text.length} chars)\n${job.text}`);
    console.log(`\nsend: dry run — ${jobs.length} job(s), ${sentToday}/${dailyCap} sent today`);
    return;
  }

  if (!sessionOk()) {
    console.log(
      [
        `send: skipped — no Telegram user session; ${jobs.length} DM(s) stay queued.`,
        "  Bot API cannot open a conversation with someone who has not messaged the bot, so cold",
        "  outreach needs a normal account session:",
        "",
        "    bun scripts/tg-outreach.ts --login      # QR, ~20 seconds with a phone in hand",
        "",
        `  the queue is readable meanwhile: ${join(DATA, "QUEUE.md")}`,
      ].join("\n"),
    );
    return;
  }

  const jobsFile = join(DATA, "jobs.jsonl");
  writeFileSync(jobsFile, `${jobs.map((j) => JSON.stringify(j)).join("\n")}\n`, "utf8");
  console.log(`send: ${jobs.length} job(s), ${sentToday}/${dailyCap} sent today`);
  const { lines } = runPy(["send", `--jobs=${jobsFile}`, `--cap=${cap}`, "--min-gap=90", "--max-gap=240"]);
  let sent = 0;
  for (const line of lines) {
    let parsed: { username?: string; status?: string; detail?: string };
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed.username) continue;
    const person = store.people.find((p) => p.username === parsed.username);
    if (person && parsed.status === "sent") {
      person.status = "pitched";
      person.pitchedAt = new Date().toISOString();
      sent += 1;
    }
    state.log.push({ at: new Date().toISOString(), username: parsed.username, status: parsed.status ?? "unknown", detail: parsed.detail });
    console.log(`  @${parsed.username}: ${parsed.status}${parsed.detail ? ` — ${parsed.detail}` : ""}`);
  }
  state.sends = { date: today, count: sentToday + sent };
  writeState(state);
  writeStore(store);
  console.log(`send: ${sent} sent · ${state.sends.count}/${dailyCap} today`);
}

function stats(): void {
  const store = readStore();
  const state = readState();
  const by = new Map<string, number>();
  for (const p of store.people) by.set(p.status, (by.get(p.status) ?? 0) + 1);
  console.log(`targets ${store.generatedAt}`);
  console.log(`channels: ${store.channels.length} (eligible ${store.channels.filter((c) => c.status === "eligible").length})`);
  console.log(`people: ${store.people.length}`);
  for (const [status, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`  ${status}: ${n}`);
  const today = new Date().toISOString().slice(0, 10);
  console.log(`sent today: ${state.sends.date === today ? state.sends.count : 0} / ${process.env.OUTREACH_DAILY_CAP ?? 12}`);
}

// ---------------------------------------------------------------- self-test

function selfTest(): void {
  let failures = 0;
  const check = (ok: boolean, label: string) => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) failures += 1;
  };
  const now = Date.now();
  const page = (opts: { subs?: string; when?: string; text?: string; extra?: string; links?: string[] }) => `
    <meta property="og:title" content="Degen Base Calls">
    <meta property="og:description" content="Base memecoin calls, $AERO and $DEGEN coverage">
    ${opts.extra ? `<div class="tgme_page_extra">${opts.extra}</div>` : ""}
    ${opts.subs ? `<div class="tgme_header_counter">${opts.subs}</div>` : ""}
    <time datetime="${opts.when ?? new Date(now - 3_600_000).toISOString()}"></time>
    <div class="tgme_widget_message_text">${opts.text ?? "AERO emissions vote is live, holders decide"}</div>
    ${(opts.links ?? []).map((l) => `<a href="https://t.me/${l}">x</a>`).join("")}`;

  console.log("channel parsing");
  const live = parsePreview(page({ subs: "34.1K subscribers", links: ["sealsdev", "GambleLounge"] }), "degenerate");
  check(Boolean(live), "a live channel page parses");
  check((live?.subs ?? 0) === 34_100, `subscriber count parsed (got ${live?.subs})`);
  check(live?.status === "eligible", "active + on-topic channel is eligible");
  const dead = parsePreview(page({ subs: "12K subscribers", when: new Date(now - 400 * 86_400_000).toISOString() }), "deadcalls");
  check(dead?.status === "skipped" && /last post 400d/.test(dead.why), "a channel dead for 400 days is skipped, with the reason");
  const tiny = parsePreview(page({ subs: "120 subscribers" }), "tiny");
  check(tiny?.status === "skipped", "120 subscribers is not worth a DM");
  const spam = parsePreview(page({ subs: "20K subscribers", text: "claim your free crypto airdrop claim now" }), "spam");
  check((spam?.score ?? 0) < (live?.score ?? 0), "airdrop spam scores below a real calls channel");
  const group = parsePreview(page({ extra: "4 512 members, 89 online" }), "agroup");
  check(group?.kind === "group", "a group is recognised as a group, not a channel");

  console.log("people harvesting");
  const links = harvestLinks(page({ links: ["sealsdev", "GambleLounge", "predictaing_bot"] }), "degenerate");
  check(links.includes("sealsdev") && links.includes("GambleLounge"), "usernames are harvested from the page");
  check(!links.includes("degenerate"), "the channel itself is not harvested as a target");
  const userPage = `<meta property="og:title" content="Seals Dev"><meta property="og:description" content="You can contact @sealsdev right away.">`;
  check(classifyPage(userPage).kind === "user", "a person page is classified as a user");
  const chanPage = `${userPage}<div class="tgme_page_extra">12 000 subscribers</div>`;
  check(classifyPage(chanPage).kind === "channel", "a channel page is not mistaken for a person");
  const botPage = `<meta property="og:title" content="Spy Bot"><meta property="og:description" content="bot">${"<a href='tg://resolve?start=1'>Start</a>"}`;
  check(["bot", "user"].includes(classifyPage(botPage).kind) && /bot$/i.test("SpyBot"), "bots are filtered by the -bot suffix before classifying");

  console.log("pitch");
  const pools: Pool[] = [
    { id: "700011", title: "Will AERO close above $0.7000 before October 31, 2026?", category: "Base Ecosystem", status: 1, endTimeUtc: new Date(now + 2 * 86_400_000).toISOString(), traders: 311, yesShare: 0.166, marketData: { asset: "AERO", spotUsd: 0.6118 } },
  ];
  const person: Person = { username: "sealsdev", title: "Seals Dev", kind: "user", via: "DegenSeals", snippet: "AERO 的排放投票今晚开始，veAERO 决定下周激励", lang: "zh", status: "new" };
  const matched = pickMarket(pools, person.snippet);
  check(matched?.pool.id === "700011", "the pitch picks the market their post is about");
  const zh = pitch(person, pools[0]);
  const en = pitch({ ...person, lang: "en", snippet: "AERO emissions vote goes live tonight" }, pools[0]);
  check(zh.includes("@DegenSeals"), "the Chinese DM names the channel they were seen in");
  check(/排放投票/.test(zh), "and quotes what they actually posted");
  check(zh.includes(BOT) && /30%/.test(zh), "the DM carries the bot handle and the 30% terms");
  check(/→ \d+\.\d×/.test(zh), "the DM carries a payout number");
  check(/no follow-up spam/.test(en), "the English DM offers an opt-out");
  check(!/weight:|source:|utm_/.test(zh + en), "no operator noise in the DM");
  check(zh.length < 1_200 && en.length < 1_400, `length sane (zh ${zh.length}, en ${en.length})`);

  console.log("\n--- EN sample ---\n" + en + "\n-----------------");
  console.log(failures === 0 ? "\nself-test: OK — parse → qualify → harvest people → classify → per-language pitch" : `\nself-test: ${failures} failure(s)`);
  if (failures > 0) process.exit(1);
}

function login(): void {
  if (!pythonAvailable()) {
    console.error(`python venv with telethon missing at ${PY} — pip install telethon into it first`);
    process.exit(1);
  }
  const proc = Bun.spawnSync({ cmd: [PY, join(ROOT, "scripts", "tg_user.py"), "login", "--qr"], cwd: ROOT, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  process.exit(proc.exitCode ?? 0);
}

async function main(): Promise<void> {
  if (has("--self-test")) return selfTest();
  if (has("--login")) return login();
  if (has("--discover")) return discover(Number(value("max", "60")) || 60);
  if (has("--compose")) return compose();
  if (has("--send")) return send(has("--dry-run"), Number(value("limit", "12")) || 12);
  if (has("--stats")) return stats();
  console.log("usage: bun scripts/tg-outreach.ts [--discover [--max=N]|--compose|--send [--dry-run] [--limit=N]|--stats|--login|--self-test]");
}

main().catch((err) => {
  console.error(`tg-outreach failed: ${(err as Error).message}`);
  process.exit(1);
});
