#!/usr/bin/env bun
/**
 * Build the candidate pool for the "Prediction Markets" custom feed.
 *
 * Why a static file instead of a live search inside the route: `app.bsky.feed.searchPosts` needs an
 * authenticated session, and the production route runs on Render without our credentials in its
 * environment. So this script does the authenticated search where the credentials live (this
 * machine), writes the ordered URIs into `frontend/public/feed-skeleton.json`, and the route serves
 * that file. A feed with a 20-minute lag is fine — it answers "what is being said about prediction
 * markets lately", not "what happened this second".
 *
 * Filters, all deliberate:
 *   · drop our own posts (a feed that only shows its operator is an ad, not a feed)
 *   · drop posts that are just a link with no sentence (promo spam, sportsbook affiliate codes)
 *   · drop replies (they read as fragments out of context)
 *   · keep posts whose language is English or undetermined — the venue's copy is English
 */
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";

const SESSION = `${process.env.HOME}/.hermes/.bsky_session.json`;
const OUT = new URL("../frontend/public/feed-skeleton.json", import.meta.url).pathname;
const API = "https://bsky.social/xrpc";

const QUERIES = [
  "prediction market",
  "prediction markets",
  "polymarket",
  "kalshi",
  "market odds",
  "betting odds",
  "onchain betting",
  "forecast market",
];

/** Promo patterns that make a post worthless inside a feed. */
const SPAM = [
  /promo code/i, /sign ?up bonus/i, /invite code/i, /free bet/i, /deposit bonus/i,
  /click here/i, /affiliate/i, /casino/i, /telegram\.me\/\+/i,
];

/**
 * A feed named "Prediction Markets" that shows a post about the weather because the word
 * "prediction" appeared in it is worse than an empty feed. Every kept post must name the subject.
 */
const RELEVANT =
  /prediction\s+market|polymarket|kalshi|market\s+odds|betting\s+odds|odds\s+(?:on|for|maker)|forecast\s+market|betting\s+market|event\s+contract|implied\s+probability|priced\s+(?:at|in)\s+\d+%/i;

type Post = {
  uri: string;
  cid: string;
  text: string;
  createdAt: string;
  author: { did: string; handle: string; displayName?: string };
};

function jwt(): string {
  const raw = require("node:fs").readFileSync(SESSION, "utf8");
  return JSON.parse(raw).accessJwt;
}

/**
 * Access tokens live two hours. Without this the first cron run after a restart 400s with
 * ExpiredToken and the feed silently freezes — the same stale-token failure the X daemon had.
 */
async function refreshSession(): Promise<void> {
  const fs = require("node:fs");
  const s = JSON.parse(fs.readFileSync(SESSION, "utf8"));
  const r = await fetch(`${API}/com.atproto.server.refreshSession`, {
    method: "POST",
    headers: { Authorization: `Bearer ${s.refreshJwt}` },
  });
  if (!r.ok) throw new Error(`refresh failed ${r.status}: ${await r.text()}`);
  const d = (await r.json()) as any;
  const next = { ...s, accessJwt: d.accessJwt, refreshJwt: d.refreshJwt, did: d.did };
  fs.writeFileSync(SESSION, JSON.stringify(next, null, 1));
  console.log("session refreshed");
}

async function search(q: string, limit = 40, retried = false): Promise<Post[]> {
  const url = `${API}/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=${limit}&sort=latest`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${jwt()}` } });
  if (r.status === 400 && !retried) {
    const body = await r.clone().text();
    if (body.includes("ExpiredToken")) {
      await refreshSession();
      return search(q, limit, true);
    }
  }
  if (!r.ok) {
    console.error(`search "${q}" -> ${r.status}`);
    return [];
  }
  const d = (await r.json()) as { posts?: Post[] };
  return d.posts ?? [];
}

function score(p: Post, now: number): number {
  const ageH = (now - new Date(p.createdAt).getTime()) / 3.6e6;
  const recency = Math.max(0, 36 - ageH) / 36;          // 36h half-life-ish window
  const length = Math.min(p.text.length / 220, 1);       // substance beats one-liners
  const hasNumber = /\d/.test(p.text) ? 0.15 : 0;        // odds/prices make a post useful
  return recency * 0.6 + length * 0.25 + hasNumber;
}

const now = Date.now();
const seen = new Map<string, Post>();

for (const q of QUERIES) {
  for (const p of await search(q)) {
    if (seen.has(p.uri)) continue;
    seen.set(p.uri, p);
  }
}

const me = JSON.parse(await readFile(SESSION, "utf8")).did as string;
const picked: Post[] = [];
for (const p of seen.values()) {
  const text = (p as any).record?.text ?? "";
  if (!text) continue;
  if (p.author?.did === me) continue;                    // not our own feed
  if ((p as any).record?.reply) continue;                // replies read as fragments
  if (text.length < 40) continue;                        // no substance
  if (!RELEVANT.test(text)) continue;                    // must name the subject
  if (SPAM.some((re) => re.test(text))) continue;        // promo spam
  if (/[а-яА-Я\u4e00-\u9fff]/.test(text)) continue;      // English-only venue copy
  picked.push({ ...p, text } as any);
}

picked.sort((a, b) => score(b, now) - score(a, now));

const body = {
  updatedAt: new Date().toISOString(),
  count: picked.length,
  posts: picked.slice(0, 60).map((p) => ({
    uri: p.uri,
    cid: p.cid,
    text: p.text.slice(0, 120),
    handle: p.author.handle,
    createdAt: p.createdAt,
  })),
};

writeFileSync(OUT, JSON.stringify(body, null, 1) + "\n");
console.log(`feed-skeleton: ${body.count} candidates -> ${body.posts.length} kept`);
for (const p of body.posts.slice(0, 6)) console.log(`  @${p.handle} ${p.text.slice(0, 70)}`);
