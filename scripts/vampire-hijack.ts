/**
 * Vampire lane — the aggressive version of the interceptor.
 *
 * Ordinary reply-guy work waits for a "nice" market angle. This lane does not: it watches the accounts
 * whose replies are actually read (Base, Jesse, Polymarket, Vitalik, Brian, Uniswap, Bankless) and
 * drops the same short DeGen hook under whichever one posts next. Same three-step funnel, blunter
 * opening line, tighter poll.
 *
 * What is honest about the timing, because "30 seconds" is not achievable here and pretending it is
 * would be the kind of claim this project cannot afford:
 *   · the feed is a Nitter mirror (x.com 403s this host), so the *floor* is the mirror's own cache,
 *     typically 1–4 minutes on a busy instance;
 *   · detection adds one poll cycle (~45s wall clock for 7 handles at a polite 3s spacing);
 *   · delivery is bounded by the desk being idle — the poster never types into a session somebody is
 *     using. A busy desk means the job waits, and after 45 minutes it is dropped rather than posted
 *     under a cold thread.
 *
 *   bun scripts/vampire-hijack.ts            # one sweep
 *   bun scripts/vampire-hijack.ts --once     # same, explicit (cron/daemon form)
 *   bun scripts/vampire-hijack.ts --dry      # report only
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildVampire, weighted, X_LIMIT } from "./lib/genesis-copy";
import { compose, passes } from "./reply-composer";

const ROOT = join(import.meta.dir, "..");
const CONFIG = join(ROOT, "scripts", "config", "vampire-targets.json");
const STATE = join(ROOT, ".data", "intercept", "reply-state.json");
const QUEUE = join(ROOT, ".data", "intercept", "reply-queue");
const HOT = join(ROOT, ".data", "hot.json");

/** Mirrors in preference order: the fixed instance answers, the redirector is the fallback. */
const MIRRORS = (process.env.INTERCEPT_MIRRORS ?? "https://nitter.kareem.one,https://twiiit.com")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const FRESH_MS = Number(process.env.VAMPIRE_FRESH_MIN ?? 10) * 60_000;
const MAX_PER_SWEEP = Number(process.env.VAMPIRE_MAX_PER_SWEEP ?? 2);

const dry = process.argv.includes("--dry");

type State = Record<string, { lastId: string; seenAt: string; replied?: string[] }>;
type Target = { handle: string; why?: string };

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function curl(url: string): string | null {
  try {
    const p = Bun.spawnSync(["curl", "-sL", "-m", "20", "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", url], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });
    return p.exitCode === 0 ? p.stdout.toString() : null;
  } catch {
    return null;
  }
}

function feed(handle: string): string | null {
  for (const base of MIRRORS) {
    for (let i = 0; i < 2; i++) {
      const xml = curl(`${base}/${handle}/rss`);
      if (xml && xml.includes("<item>")) return xml;
      Bun.sleepSync(2_500);
    }
  }
  return null;
}

type Item = { id: string; title: string; pubDate: string };

function parse(xml: string): Item[] {
  const out: Item[] = [];
  for (const raw of xml.split("<item>").slice(1)) {
    const block = raw.split("</item>")[0] ?? "";
    const pick = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "") : "";
    };
    const id = pick("link").match(/status\/(\d+)/)?.[1];
    if (!id) continue;
    const title = pick("title")
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .trim();
    // Retweets and replies are not the account speaking; the vampire only bites original posts.
    if (/^(RT by @|R to @)/i.test(title)) continue;
    out.push({ id, title, pubDate: pick("pubDate") });
  }
  return out;
}

function hottestId(): string | null {
  const hot = readJson<{ hot?: { id: string | number }[] }>(HOT, {});
  return hot.hot?.[0] ? String(hot.hot[0].id) : null;
}

async function main(): Promise<void> {
  const cfg = readJson<{ targets?: (string | Target)[] }>(CONFIG, { targets: [] });
  const targets: Target[] = (cfg.targets ?? []).map((t) => (typeof t === "string" ? { handle: t } : t));
  if (!targets.length) {
    console.log("no vampire targets configured");
    process.exit(1);
  }

  const state = readJson<State>(STATE, {});
  if (!dry) mkdirSync(QUEUE, { recursive: true });

  const now = Date.now();
  const startedAt = now;
  const queued: { handle: string; id: string }[] = [];
  const lines: string[] = [];

  for (const t of targets) {
    const xml = feed(t.handle);
    if (!xml) {
      lines.push(`  ${t.handle}: mirror refused`);
      continue;
    }
    const items = parse(xml).sort((a, b) => Number(b.id) - Number(a.id));
    if (!items.length) {
      lines.push(`  ${t.handle}: nothing but retweets/replies`);
      continue;
    }
    const newest = items[0];
    const age = now - Date.parse(newest.pubDate);
    const prev = state[t.handle];

    if (prev && BigInt(newest.id) <= BigInt(prev.lastId)) {
      lines.push(`  ${t.handle}: no new post`);
      continue;
    }
    if (Number.isFinite(age) && age > FRESH_MS) {
      state[t.handle] = { ...prev, lastId: newest.id, seenAt: new Date().toISOString() };
      lines.push(`  ${t.handle}: newest ${Math.round(age / 60_000)}m old — past the ${FRESH_MS / 60_000}m window`);
      continue;
    }
    if (prev?.replied?.includes(newest.id)) {
      lines.push(`  ${t.handle}: already bitten ${newest.id}`);
      continue;
    }
    if (queued.length >= MAX_PER_SWEEP) {
      lines.push(`  ${t.handle}: sweep cap, leaving ${newest.id}`);
      continue;
    }

    // Lane choice, from what the post is about rather than from a schedule:
    //   · the post is already about markets/odds/prices → the blunt funnel actually answers it;
    //   · anything else → a value reply with a number and a question, because an airdrop pitch under
    //     a post that has nothing to do with us is what gets an account muted. The funnel then lives
    //     in the profile and in our own daily post, which is where it belongs.
    const isMarketTalk = /\b(predict|market|odds|probab|bet|price|forecast|trading|liquidity)\b/i.test(newest.title);
    let text = "";
    let lane = "value";
    if (isMarketTalk) {
      text = buildVampire(hottestId());
      lane = "vampire";
    } else {
      const composed = await compose(t.handle, newest.title, null);
      text = composed.text;
      if (!passes(text).ok) {
        lines.push(`  ${t.handle}: composed reply failed rules (${passes(text).why}), skipped`);
        continue;
      }
    }
    if (weighted(text) > X_LIMIT) {
      lines.push(`  ${t.handle}: copy ${weighted(text)} > ${X_LIMIT}, skipped`);
      continue;
    }
    if (!dry) {
      const job = {
        handle: t.handle,
        tweetId: newest.id,
        url: `https://x.com/${t.handle}/status/${newest.id}`,
        text,
        createdAt: newest.pubDate,
        queuedAt: new Date().toISOString(),
        variant: lane,
        marketId: lane === "vampire" ? hottestId() : null,
        lane,
      };
      writeFileSync(join(QUEUE, `${t.handle}-${newest.id}.json`), `${JSON.stringify(job, null, 2)}\n`);
    }
    queued.push({ handle: t.handle, id: newest.id });
    state[t.handle] = { ...prev, lastId: newest.id, seenAt: new Date().toISOString() };
    lines.push(`  ${t.handle}: BIT ${lane} ${newest.id} · ${Math.round(age / 1000)}s old · ${weighted(text)}/280 · “${newest.title.slice(0, 44)}”`);
  }

  if (!dry) writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);

  // Keep the queue finite even if the desk never goes idle.
  if (!dry && existsSync(QUEUE)) {
    for (const name of readdirSync(QUEUE)) {
      if (!name.endsWith(".json")) continue;
      const p = join(QUEUE, name);
      const job = readJson<{ queuedAt?: string } | null>(p, null);
      if (job && Date.now() - Date.parse(job.queuedAt ?? "") > 6 * 3600_000) {
        try {
          Bun.spawnSync(["rm", "-f", p]);
        } catch {
          /* ignore */
        }
      }
    }
  }

  const took = Math.round((Date.now() - startedAt) / 1000);
  console.log(`vampire sweep · ${targets.length} targets · ${queued.length} bite(s) · ${took}s`);
  for (const l of lines) console.log(l);
  console.log(`  detection latency floor: poll ${took}s + mirror cache (1-4 min typical); delivery waits for an idle desk`);
}

await main();
