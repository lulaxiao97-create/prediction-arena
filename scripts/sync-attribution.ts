/**
 * Turn `/api/growth/summary` (on-chain referral attribution) into the tribal weights that
 * `scripts/auto-market.ts --pick=tribal` reads.
 *
 *   bun scripts/sync-attribution.ts                 # fetch the live endpoint, write the file
 *   bun scripts/sync-attribution.ts --file=x.json   # write somewhere else (fixtures, tests)
 *   bun scripts/sync-attribution.ts --source=file:docs/.../summary.json
 *
 * Why this exists: the board's tribes (AERO / DEGEN / TOSHI / BRETT / MOG …) are the ones the copy
 * leans on, but which tribe actually *pays* was a guess. Every `BetPlaced` log carries the `ref`
 * address and the referrer's cut, so the leaderboard of "which tribe's market took the most USDC"
 * is measurable without any analytics vendor. This script measures it and writes:
 *
 *   docs/campaigns/attribution.json
 *     { generatedAt, source, bets, referredBets, volumeUsdc,
 *       byTribe: [{ token, bets, volumeUsdc }], leader }
 *
 * Facts the script will not invent:
 *   - `bets: 0` writes a real, empty file. The marketing picker treats that as "no signal" and
 *     keeps the hand-tuned prior; it does not fabricate a leader.
 *   - Volume is the gross stake (`amount`), the same number the app shows as traded volume. It is
 *     not revenue and not profit — the contract keeps a 4% fee and the rest is the pool.
 *   - A market can match more than one tribe token. It is attributed to every match, so the tribe
 *     totals can sum to more than the total volume; `volumeUsdc` at the top is the un-double-counted
 *     figure and is the one to quote.
 *
 * The window is whatever the endpoint scanned (default 6×1000 blocks ≈ 3h on Base). Pass
 * `--chunks=24` for a ~12h window; the endpoint caps at 24.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://predictionarena.online").replace(/\/+$/, "");
const ROOT = join(import.meta.dir, "..");

/** Same list as the picker's static +3, so the bonus and the prior agree on what a tribe is. */
const TRIBE_TOKENS = ["aero", "degen", "toshi", "brett", "mog", "zora", "higher"];

type Args = { file: string; source: string; chunks: number };

function parseArgs(argv: string[]): Args {
  const args: Args = { file: join(ROOT, "docs", "campaigns", "attribution.json"), source: "live", chunks: 6 };
  for (const raw of argv.slice(2)) {
    const [key, value = ""] = raw.replace(/^--/, "").split("=");
    if (key === "file") args.file = value;
    else if (key === "source") args.source = value;
    else if (key === "chunks") args.chunks = Math.max(1, Math.min(24, Number(value) || 6));
    else if (key === "help" || key === "-h") {
      console.log("usage: bun scripts/sync-attribution.ts [--file=path] [--source=live|file:path] [--chunks=6]");
      process.exit(0);
    }
  }
  return args;
}

type MarketRow = { poolId?: string; title?: string; bets?: number; referred?: number; volumeUsdc?: number };
type Summary = {
  ok?: boolean;
  totals?: { bets?: number; referredBets?: number; volumeUsdc?: number };
  perMarket?: MarketRow[];
  generatedAt?: string;
};

/**
 * The endpoint counts per pool id; the tribes live in the titles. Titles come from the published
 * manifest, which is the same file the landing cards render from — so the mapping cannot drift from
 * what a visitor actually sees on the page.
 */
function poolTitles(): Map<string, string> {
  const manifest = join(ROOT, "frontend", "public", "pools.json");
  const board = JSON.parse(readFileSync(manifest, "utf8")) as { pools?: { id: string | number; title: string }[] };
  const map = new Map<string, string>();
  for (const pool of board.pools ?? []) map.set(String(pool.id), pool.title ?? "");
  return map;
}

async function fetchSummary(source: string, chunks: number): Promise<Summary> {
  if (source.startsWith("file:")) {
    return JSON.parse(readFileSync(source.slice(5), "utf8")) as Summary;
  }
  const url = `${SITE}/api/growth/summary?chunks=${chunks}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text) as Summary;
  } catch {
    throw new Error(`${url} did not return JSON: ${text.slice(0, 200)}`);
  }
}

function main(): void {
  const args = parseArgs(process.argv);
  fetchSummary(args.source, args.chunks)
    .then((summary) => {
      if (summary.ok === false) throw new Error("endpoint returned ok:false");

      const perMarket = summary.perMarket ?? [];
      const titles = poolTitles();
      const resolved: MarketRow[] = perMarket.map((row) => ({
        ...row,
        title: row.title ?? titles.get(String(row.poolId ?? "")) ?? "",
      }));

      const byTribe = TRIBE_TOKENS.map((token) => {
        const rows = resolved.filter((row) => String(row.title ?? "").toLowerCase().includes(token));
        return {
          token,
          bets: rows.reduce((n, r) => n + Number(r.bets ?? 0), 0),
          volumeUsdc: Math.round(rows.reduce((n, r) => n + Number(r.volumeUsdc ?? 0), 0) * 100) / 100,
          markets: rows.map((r) => ({ poolId: String(r.poolId ?? ""), title: String(r.title ?? "") })),
        };
      })
        .filter((t) => t.bets > 0)
        .sort((a, b) => b.volumeUsdc - a.volumeUsdc);

      const totals = summary.totals ?? {};
      const payload = {
        generatedAt: new Date().toISOString(),
        source: args.source === "live" ? `${SITE}/api/growth/summary?chunks=${args.chunks}` : args.source,
        window: {
          endpointGeneratedAt: summary.generatedAt ?? null,
          markets: perMarket.length,
        },
        bets: Number(totals.bets ?? 0),
        referredBets: Number(totals.referredBets ?? 0),
        volumeUsdc: Math.round(Number(totals.volumeUsdc ?? 0) * 100) / 100,
        byTribe,
        leader: byTribe.length > 0 ? byTribe[0].token : null,
      };

      mkdirSync(dirname(args.file), { recursive: true });
      writeFileSync(args.file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

      if (payload.bets === 0) {
        console.log(`wrote ${args.file} — 0 on-chain bets in this window, so no tribe leads yet.`);
        console.log("the picker keeps its hand-tuned prior until the first BetPlaced lands.");
      } else {
        console.log(`wrote ${args.file} — ${payload.bets} bets · ${payload.referredBets} referred · $${payload.volumeUsdc} volume`);
        console.log(`leader: ${payload.leader}`);
        for (const t of byTribe) console.log(`  ${t.token.padEnd(7)} $${t.volumeUsdc} over ${t.bets} bets`);
      }
    })
    .catch((err) => {
      console.error(`sync-attribution failed: ${(err as Error).message}`);
      process.exit(1);
    });
}

main();
