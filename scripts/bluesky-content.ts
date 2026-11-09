#!/usr/bin/env bun
/**
 * Bluesky copy generator.
 *
 * Bluesky is not X with a different logo, and copy that works on X dies here. Three differences
 * drive every choice below:
 *
 *   1. There is no recommendation algorithm feeding strangers your post. Reach comes from (a) your
 *      own followers, (b) custom feeds people subscribe to, (c) replies under accounts bigger than
 *      you. A "daily board" broadcast — the old X daemon's format — has none of those, so it would
 *      be posted daily into an empty room.
 *   2. The community punishes marketing voice harder than X does. A three-emoji teaser reads as spam.
 *      What travels is a specific claim someone can disagree with, or evidence someone can check.
 *   3. Links underperform images. Put the number in the text; the link is a footnote, not the post.
 *
 * So the three formats here are:
 *   --kind=mismatch   one market whose odds contradict the move it is pricing, with the number
 *   --kind=question   two markets from different sectors, asked as "which one is wrong"
 *   --kind=settled    a settled market plus its on-chain evidence hash (the thing we uniquely have)
 *
 * Everything is derived from pools.json / prices.json, so no number here is hand-typed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const POOLS = join(ROOT, "frontend", "public", "pools.json");
const PRICES = join(ROOT, "frontend", "public", "prices.json");
const SITE = "https://predictionarena.online";

type Pool = {
  id: string;
  title: string;
  category: string;
  status: number;
  yesShare: number;
  endTimeUtc?: string;
  tags?: string[];
  lastSettled?: { winningOption?: number; evidenceHash?: string; tx?: string };
};
type Price = { usd: number; change24h?: number };

const pools: Pool[] = (JSON.parse(readFileSync(POOLS, "utf8")) as { pools: Pool[] }).pools;
const prices: Record<string, Price> = (existsSync(PRICES)
  ? JSON.parse(readFileSync(PRICES, "utf8"))
  : { assets: {} }).assets ?? {};

const open = pools.filter((p) => Number(p.status) === 1 && p.endTimeUtc && Date.parse(p.endTimeUtc) > Date.now());

/** "Will X trade above $N before <date>" → the ticker and the strike, if the title encodes them. */
function parseLevel(title: string): { sym: string; strike: number } | null {
  const m = title.match(/\b(BTC|Bitcoin|ETH|Ethereum|SOL|Solana|BNB|XRP|DOGE|AVAX|LINK|ARB|OP|SUI|PEPE|WIF|BONK|TIA|INJ|SEI|APT|NEAR|ATOM|TIA)\b/i);
  const n = title.match(/\$([0-9][0-9,]*\.?[0-9]*)/);
  if (!m || !n) return null;
  const sym = m[1].toUpperCase().replace("BITCOIN", "BTC").replace("ETHEREUM", "ETH").replace("SOLANA", "SOL");
  const strike = Number(n[1].replace(/,/g, ""));
  if (!Number.isFinite(strike) || strike <= 0) return null;
  return { sym, strike };
}

function fmt(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toPrecision(4);
}

/**
 * Mismatch: a market whose YES probability points one way while the underlying moved the other way
 * today. "BTC fell 1.4% but the board still gives 62% to a higher close" is a claim someone can
 * argue with — which is the only kind of post that gets replies on a network with no algorithm.
 */
function mismatch(): string | null {
  let best: { text: string; gap: number } | null = null;
  for (const p of open) {
    const lv = parseLevel(p.title);
    if (!lv) continue;
    const px = prices[lv.sym];
    if (!px || typeof px.change24h !== "number") continue;
    const spot = px.usd;
    const up = p.title.toLowerCase().includes("above") || p.title.toLowerCase().includes("reclaim");
    const dir = up ? 1 : -1;
    // how far the market is from pricing "spot keeps moving the way it moved today"
    const moved = px.change24h;
    const odds = Number(p.yesShare ?? 0.5) * 100;
    const implied = up ? (spot > lv.strike ? 1 : 0) : spot < lv.strike ? 1 : 0;
    const gap = Math.abs(odds - (implied ? 62 : 38)) + Math.abs(moved) * 6;
    if (!best || gap > best.gap) {
      const when = p.endTimeUtc ? new Date(p.endTimeUtc).toISOString().slice(0, 10) : "";
      const text =
        `${lv.sym} is ${moved >= 0 ? "up" : "down"} ${Math.abs(moved).toFixed(1)}% today ($${fmt(spot)}). ` +
        `Our board still prices "${p.title.replace(/\?$/, "")}" at ${odds.toFixed(0)}% YES for ${when}.\n\n` +
        `Either the market is slow, or it knows something the tape doesn't.`;
      best = { text, gap };
    }
  }
  return best?.text ?? null;
}

/** Question: two live markets, different sectors, asked as a forced choice. Replies are the point. */
function question(): string | null {
  const byCat = new Map<string, Pool[]>();
  for (const p of open) {
    if (Number(p.yesShare) < 0.05 || Number(p.yesShare) > 0.95) continue;
    const arr = byCat.get(p.category) ?? [];
    arr.push(p);
    byCat.set(p.category, arr);
  }
  const cats = [...byCat.keys()].filter((c) => byCat.get(c)!.length > 0);
  if (cats.length < 2) return null;
  const pick = (seed: number) => {
    const c = cats[seed % cats.length];
    const arr = byCat.get(c)!;
    return arr[Math.floor(Date.now() / 36e5 + seed) % arr.length];
  };
  const a = pick(0);
  const b = pick(7);
  const line = (p: Pool) =>
    `· ${p.title.replace(/\?$/, "")} — ${(Number(p.yesShare) * 100).toFixed(0)}% YES`;
  return `Two markets, two very different prices. One of them is wrong.\n\n${line(a)}\n${line(b)}\n\nWhich side would you take?`;
}

/** Settled: we are the only venue that can show a settlement hash. That is the content. */
function settled(): string | null {
  const done = pools.filter((p) => Number(p.status) === 2);
  if (!done.length) return null;
  const p = done[done.length - 1];
  const hash = p.lastSettled?.evidenceHash;
  const side = p.lastSettled?.winningOption === 1 ? "NO" : "YES";
  return (
    `Settled on-chain: ${side}.\n\n"${p.title}"\n\n` +
    (hash ? `Evidence hash ${hash.slice(0, 18)}… written to Base at settlement. ` : "") +
    `Every resolution on the venue is a transaction, not a blog post.`
  );
}

const kind = (process.argv.find((a) => a.startsWith("--kind=")) ?? "--kind=mismatch").split("=")[1];
const out =
  kind === "question" ? question() : kind === "settled" ? settled() : mismatch();
if (!out) {
  console.error(`no copy for --kind=${kind} (not enough data)`);
  process.exit(1);
}
console.log(out);
