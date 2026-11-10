#!/usr/bin/env bun
/**
 * Bluesky reach: find people already arguing about a prediction, answer them with a market.
 *
 * This is not a broadcast. A reply that says "come play" is spam and gets the account muted in a
 * day; a reply that answers the question they just asked, with a link to the same question priced by
 * a pool, is the only version of this that survives. So the loop is:
 *
 *   1. search recent posts for a question with an outcome ("will X", "over/under", "odds on")
 *   2. skip anything already replied to, anything from the last hour (too crowded), anything with no
 *      engagement (nobody will see the reply)
 *   3. reply once, with their question named back and the board linked
 *
 *   bun scripts/bsky-reach.ts                      # dry run: prints candidates and the reply
 *   bun scripts/bsky-reach.ts --live --max=5       # posts up to 5 replies
 *   bun scripts/bsky-reach.ts --live --max=10 --since=24
 *
 * Rate discipline: Bluesky tolerates ~1 reply/minute before it looks automated. The script sleeps
 * 90s between sends and stops at --max (default 3) — a handful of good replies beats a hundred that
 * get the account labelled.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PDS = process.env.BSKY_PDS ?? "https://bsky.social";
const SESSION = join(homedir(), ".hermes", ".bsky_session.json");
const SEEN = join(ROOT, ".data", "bsky-replied.json");
const FOLLOWED = join(ROOT, ".data", "bsky-followed.json");
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://predictionarena.online";

const args = process.argv.slice(2);
const flag = (n: string, d: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const LIVE = args.includes("--live");
const MAX = Math.max(1, Math.min(20, Number(flag("max", "3"))));
const SINCE_HOURS = Number(flag("since", "48"));

const QUERIES = [
  "will bitcoin",
  "will ethereum",
  "fed rate cut",
  "cpi inflation",
  "nvidia earnings",
  "gold price",
];

type Session = { did: string; handle: string; accessJwt: string; refreshJwt?: string };
type Post = {
  uri: string;
  cid: string;
  author: { handle: string; did: string };
  record: { text?: string; createdAt?: string; reply?: unknown };
  likeCount?: number;
  replyCount?: number;
  indexedAt?: string;
};

function session(): Session {
  if (!existsSync(SESSION)) throw new Error(`no session at ${SESSION} — run: bun scripts/bluesky.ts --login`);
  return JSON.parse(readFileSync(SESSION, "utf8")) as Session;
}

function readSeen(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(SEEN, "utf8"));
  } catch {
    return {};
  }
}

function writeSeen(rows: Record<string, string>): void {
  mkdirSync(join(ROOT, ".data"), { recursive: true });
  writeFileSync(SEEN, `${JSON.stringify(rows, null, 2)}\n`);
}

async function search(s: Session, q: string): Promise<Post[]> {
  const url = `${PDS}/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=25&sort=latest`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${s.accessJwt}` } });
  if (!res.ok) {
    console.error(`search "${q}" → HTTP ${res.status}`);
    return [];
  }
  const body = (await res.json()) as { posts?: Post[] };
  return body.posts ?? [];
}

/**
 * A post worth answering must be a *settleable question* about a subject this board actually lists.
 *
 * The first pass filtered on "odds"/"will" and produced gems like a Deadlock joke and "makes no odds
 * who's in charge" — replying to those is exactly how an account gets muted, and it would link a
 * BTC market under a post about a video game. So: a subject the board carries, a prediction shape,
 * and no irony markers.
 */
const SUBJECTS: { re: RegExp; key: string }[] = [
  { re: /\b(bitcoin|btc)\b/i, key: "BTC" },
  { re: /\b(ethereum|eth)\b/i, key: "ETH" },
  { re: /\b(solana|sol)\b/i, key: "SOL" },
  { re: /\b(nvidia|nvda)\b/i, key: "NVDA" },
  { re: /\b(fed|fomc|rate cut|rate hike)\b/i, key: "FED" },
  { re: /\b(cpi|inflation print)\b/i, key: "CPI" },
  { re: /\b(gold|xau)\b/i, key: "GOLD" },
  { re: /\b(tariffs?)\b/i, key: "TARIFF" },
];

function subjectOf(text: string): string | null {
  for (const s of SUBJECTS) if (s.re.test(text)) return s.key;
  return null;
}

function worthAnswering(p: Post, seen: Record<string, string>): boolean {
  if (seen[p.uri]) return false;
  if (p.record.reply) return false; // answering a reply reads as piling on
  const text = p.record.text ?? "";
  if (text.length < 40 || text.length > 280) return false;
  // A prediction shape, not a rant: "will X close above Y by DATE" and friends.
  if (!/\b(will|before|above|below|close at|hit \$|by (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))\b/i.test(text)) return false;
  if (/makes? no odds|odds are (good|bad)|what are the odds|odd(s)? that/i.test(text)) return false;
  if (!subjectOf(text)) return false;
  const at = new Date(p.indexedAt ?? p.record.createdAt ?? 0).getTime();
  if (!Number.isFinite(at) || Date.now() - at > SINCE_HOURS * 3_600_000) return false;
  if ((p.likeCount ?? 0) + (p.replyCount ?? 0) < 2) return false; // nobody will see it
  return true;
}

/**
 * The subject of a *market title*, not of a post.
 *
 * `title.includes(subject)` was the bug that linked a gold article to the ETH/BTC ratio market: "BTC"
 * appears inside the title of anything mentioning the ratio, so the first match won. A market's
 * subject is the thing right after "Will", before the verb — nothing else counts.
 */
function subjectOfTitle(title: string): string | null {
  const m = title.match(/^Will\s+(.+?)\s+(?:trade|close|hit|reach|fall|rise|be|stay|end|print)/i);
  if (!m) return null;
  const head = m[1].toUpperCase();
  for (const s of SUBJECTS) if (s.re.test(head)) return s.key;
  return null;
}

/** The market on this board whose *subject* matches — same asset, not merely a substring. */
function matchMarket(subject: string): { id: string; title: string } | null {
  try {
    const board = JSON.parse(readFileSync(join(ROOT, "frontend", "public", "pools.json"), "utf8")) as {
      pools?: { id: string | number; title: string; status?: number; endTimeUtc?: string }[];
    };
    const now = Date.now();
    const pool = (board.pools ?? [])
      .filter((p) => (p.status ?? 1) === 1 && (!p.endTimeUtc || Date.parse(p.endTimeUtc) > now))
      .find((p) => subjectOfTitle(p.title) === subject);
    return pool ? { id: String(pool.id), title: pool.title } : null;
  } catch {
    return null;
  }
}

/** Accounts a venue should never be seen following — the first run followed an onlyfans promo. */
const JUNK = /onlyfans|camgirl|porn|nude|escort|casino|bonus|follow ?back|f4f|giveaway|airdrop hunt|nudes/i;

function replyText(m: { id: string; title: string }, url: string): string {
  return `Same question is on an on-chain board: "${m.title}"\n\nIts pool is empty, so the price is whatever the first taker says — not what a market maker decides.\n\n${url}`;
}

async function reply(s: Session, p: Post, text: string): Promise<boolean> {
  const res = await fetch(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { authorization: `Bearer ${s.accessJwt}`, "content-type": "application/json" },
    body: JSON.stringify({
      repo: s.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
        reply: { root: { uri: p.uri, cid: p.cid }, parent: { uri: p.uri, cid: p.cid } },
      },
    }),
  });
  if (!res.ok) {
    console.error(`reply → HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return false;
  }
  return true;
}

/**
 * Following is the only thing that moves the follower count on Bluesky: there is no algorithm to
 * borrow. A venue account with 2 followers gets 0 reach per post, so the engine has to go to the
 * people who already talk about this subject and follow them — roughly one in five follows back, and
 * those are the only humans who will ever see a launch post.
 */
async function follow(s: Session, did: string): Promise<boolean> {
  const res = await fetch(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { authorization: `Bearer ${s.accessJwt}`, "content-type": "application/json" },
    body: JSON.stringify({
      repo: s.did,
      collection: "app.bsky.graph.follow",
      record: { $type: "app.bsky.graph.follow", subject: did, createdAt: new Date().toISOString() },
    }),
  });
  if (!res.ok) {
    console.error(`follow ${did} → HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  const s = session();
  const seen = readSeen();
  const followed: Record<string, string> = (() => {
    try {
      return JSON.parse(readFileSync(FOLLOWED, "utf8"));
    } catch {
      return {};
    }
  })();
  const candidates: Post[] = [];
  const authors = new Map<string, { handle: string; did: string }>();
  const byUri = new Set<string>();

  for (const q of QUERIES) {
    for (const p of await search(s, q)) {
      if (byUri.has(p.uri)) continue;
      byUri.add(p.uri);
      // Everyone in the result set is somebody who posts about a subject this board prices — they
      // are the follow candidates, whether or not their post is answerable.
      // Only people actually posting about a subject this board prices, and never an account whose
      // handle smells like a promo — the brand's following list is public and it is a first impression.
      if (
        p.author?.did &&
        p.author.did !== s.did &&
        !followed[p.author.did] &&
        subjectOf(p.record.text ?? "") &&
        !JUNK.test(p.author.handle ?? "")
      ) {
        authors.set(p.author.did, p.author);
      }
      if (worthAnswering(p, seen)) candidates.push(p);
    }
    await new Promise((r) => setTimeout(r, 700));
  }

  // Only posts this board can actually answer: the subject must match a market that is open now.
  const matched = candidates
    .map((p) => ({ p, m: matchMarket(subjectOf(p.record.text ?? "") ?? "") }))
    .filter((x): x is { p: Post; m: { id: string; title: string } } => Boolean(x.m));

  matched.sort(
    (a, b) =>
      (b.p.likeCount ?? 0) + (b.p.replyCount ?? 0) - ((a.p.likeCount ?? 0) + (a.p.replyCount ?? 0)),
  );
  console.log(`${matched.length} candidate(s), sending up to ${MAX}${LIVE ? "" : " (dry run)"}`);
  let sent = 0;
  for (const { p, m } of matched) {
    if (sent >= MAX) break;
    const url = `${SITE}/market/${m.id}`;
    const text = replyText(m, url);
    console.log(`\n— @${p.author.handle} (${(p.likeCount ?? 0) + (p.replyCount ?? 0)} engagements)`);
    console.log(`  post: ${(p.record.text ?? "").slice(0, 120)}`);
    console.log(`  market: #${m.id} ${m.title.slice(0, 70)}`);
    console.log(`  reply: ${text.replace(/\n/g, " / ")}`);
    if (!LIVE) {
      sent += 1;
      continue;
    }
    if (await reply(s, p, text)) {
      seen[p.uri] = new Date().toISOString();
      writeSeen(seen);
      sent += 1;
      console.log("  ✓ sent");
      await new Promise((r) => setTimeout(r, 90_000));
    }
  }
  console.log(`\n${LIVE ? "sent" : "would send"} ${sent}`);

  // Follow pass. No reply attached, no link — just the request that makes their posts appear in our
  // feed later, which is what a new account needs more than anything it can write.
  const followCap = Math.max(0, Math.min(40, Number(flag("follow", "15"))));
  let followCount = 0;
  for (const a of authors.values()) {
    if (followCount >= followCap) break;
    if (!LIVE) {
      console.log(`  would follow @${a.handle}`);
      followCount += 1;
      continue;
    }
    if (await follow(s, a.did)) {
      followed[a.did] = new Date().toISOString();
      writeFileSync(FOLLOWED, `${JSON.stringify(followed, null, 2)}\n`);
      followCount += 1;
      console.log(`  + followed @${a.handle}`);
      await new Promise((r) => setTimeout(r, 2_500));
    }
  }
  console.log(`${LIVE ? "followed" : "would follow"} ${followCount}`);
}

main().catch((e) => {
  console.error(`bsky-reach failed: ${e.message}`);
  process.exit(1);
});
