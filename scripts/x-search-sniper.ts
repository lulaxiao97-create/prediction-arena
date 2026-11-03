/**
 * Search sniper — reply where the conversation already is, instead of waiting for seven accounts.
 *
 * The fixed target list (Base, Polymarket, Vitalik…) only produces a handful of shots a day, and most
 * of them are about something unrelated to us. Nitter's search RSS answers the better question:
 * *who is talking about airdrops, points and prediction markets right now?* Those people are already
 * in the market for what we sell, they are mid-conversation, and a reply from us is on-topic instead
 * of an interruption.
 *
 * The reply text is composed by reply-composer (a number, a question, no link, no airdrop vocabulary)
 * and fills the same queue the daemon drains, so the rate limits and the reply-count verification all
 * still apply.
 *
 *   bun scripts/x-search-sniper.ts            # one sweep, queue what is fresh
 *   bun scripts/x-search-sniper.ts --dry      # report only
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compose, passes } from "./reply-composer";
import { weighted, X_LIMIT } from "./lib/genesis-copy";

const ROOT = join(import.meta.dir, "..");
const QUEUE = join(ROOT, ".data", "intercept", "reply-queue");
const STATE = join(ROOT, ".data", "intercept", "search-state.json");
const MIRRORS = (process.env.INTERCEPT_MIRRORS ?? "https://nitter.kareem.one,https://twiiit.com")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

/** Queries are the audience definition. Short, lowercase, no operators — the mirror strips them. */
const QUERIES = (process.env.SNIPE_QUERIES ??
  "airdrop points|points farming|prediction market|airdrop season|farming season|testnet reward")
  .split("|")
  .map((q) => q.trim())
  .filter(Boolean);

const FRESH_MS = Number(process.env.SNIPE_FRESH_MIN ?? 12) * 60_000;
const MAX_PER_SWEEP = Number(process.env.SNIPE_MAX ?? 4);
const dry = process.argv.includes("--dry");

type State = Record<string, string>; // tweetId -> queuedAt
type Item = { id: string; user: string; text: string; at: string };

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function curl(url: string): string | null {
  try {
    const p = Bun.spawnSync(["curl", "-sL", "-m", "25", "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", url], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });
    return p.exitCode === 0 ? p.stdout.toString() : null;
  } catch {
    return null;
  }
}

function search(query: string): Item[] {
  const out: Item[] = [];
  for (const base of MIRRORS) {
    const xml = curl(`${base}/search/rss?f=tweets&q=${encodeURIComponent(query)}`);
    if (!xml || !xml.includes("<item>")) continue;
    for (const raw of xml.split("<item>").slice(1)) {
      const block = raw.split("</item>")[0] ?? "";
      const pick = (tag: string) => {
        const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
        return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "") : "";
      };
      const link = pick("link");
      const m = link.match(/https?:\/\/[^/]+\/([^/]+)\/status\/(\d+)/);
      if (!m) continue;
      const text = pick("title")
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/<[^>]+>/g, "")
        .trim();
      if (!text || /^(RT by @|R to @)/i.test(text)) continue;
      out.push({ user: m[1], id: m[2], text, at: pick("pubDate") });
    }
    if (out.length) break;
  }
  return out;
}

async function main(): Promise<void> {
  const state = readJson<State>(STATE, {});
  const queued = new Set(
    existsSync(QUEUE) ? readdirSync(QUEUE).map((n) => n.replace(/\.json$/, "").split("-").pop() ?? "") : [],
  );
  if (!dry) mkdirSync(QUEUE, { recursive: true });

  const now = Date.now();
  let added = 0;
  const log: string[] = [];

  for (const q of QUERIES) {
    if (added >= MAX_PER_SWEEP) break;
    const items = search(q);
    log.push(`  "${q}": ${items.length} hit(s)`);
    items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    for (const it of items) {
      if (added >= MAX_PER_SWEEP) break;
      if (it.user.toLowerCase() === "predict065") continue;
      if (state[it.id] || queued.has(it.id)) continue;
      const age = now - Date.parse(it.at);
      if (!Number.isFinite(age) || age > FRESH_MS) continue;
      // Skip posts that are themselves asking for wallets: replying there puts us in the middle of
      // somebody else's farm, and the thread is full of bots.
      if (/0x[0-9a-f]{6}|drop (your|ur) (wallet|address)/i.test(it.text) && !/prediction|market/i.test(it.text)) continue;

      const out = await compose(it.user, it.text, null);
      if (!passes(out.text).ok) {
        log.push(`  skip @${it.user}: composed reply failed rules (${passes(out.text).why})`);
        continue;
      }
      if (weighted(out.text) > X_LIMIT) continue;

      if (!dry) {
        const job = {
          handle: it.user,
          tweetId: it.id,
          url: `https://x.com/${it.user}/status/${it.id}`,
          text: out.text,
          createdAt: it.at,
          queuedAt: new Date().toISOString(),
          variant: "search",
          marketId: null,
          lane: "search",
        };
        writeFileSync(join(QUEUE, `${it.user}-${it.id}.json`), `${JSON.stringify(job, null, 2)}\n`);
        state[it.id] = new Date().toISOString();
      }
      added += 1;
      log.push(`  QUEUED @${it.user} ${it.id} · ${Math.round(age / 60000)}m old · "${it.text.slice(0, 60)}"`);
    }
  }

  if (!dry) writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`search sniper · ${QUERIES.length} queries · ${added} queued`);
  for (const l of log) console.log(l);
}

await main();
