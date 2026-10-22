/**
 * Market manifest → view models.
 *
 * `public/pools.json` is the single source the UI reads for "which markets exist":
 *   • source: "demo"  — fully described in the manifest (sample/seed markets)
 *   • source: "chain" — only the id is authoritative; status/liquidity are read from the contract
 *
 * Everything here is deterministic: the same manifest always renders the same numbers, so the
 * prerendered HTML and the hydrated client agree.
 */
import type { AiStances, ArenaPool } from "@/lib/types";
import { defaultStancesFor } from "@/lib/mock-data";
import { AGENTS } from "@/lib/mock-data";

export type ManifestPool = {
  id: string;
  title: string;
  category: string;
  tags?: string[];
  source?: "demo" | "chain";
  status?: number;
  winningOption?: number;
  settlementHash?: string;
  endTimeOffsetHours?: number;
  liquidityUsdc?: string;
  yesShare?: number;
  volume24hUsdc?: string;
  traders?: number;
  description?: string;
  resolution?: string;
};

export type Manifest = {
  version?: number;
  address: string;
  chainId: number;
  deployBlock?: number;
  updatedAt?: string;
  featured?: string;
  stats?: {
    tvlUsdc?: string;
    volume24hUsdc?: string | null;
    activeMarkets?: number;
    settledMarkets?: number;
  };
  pools: ManifestPool[];
};

const u = (n: number) => BigInt(Math.round(n * 1_000_000));

/** Deterministic PRNG so every render (server + client) produces the same curve. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A believable 30-point probability history that ends exactly at `finalShare`. */
export function probabilitySeries(id: string, finalShare: number, points = 30): number[] {
  const rand = mulberry32(hashString(id));
  const start = clamp(finalShare + (rand() - 0.5) * 0.36, 0.06, 0.94);
  const raw: number[] = [start];
  for (let i = 1; i < points; i++) {
    const drift = (finalShare - raw[i - 1]) / (points - i);
    const noise = (rand() - 0.5) * 0.055;
    raw.push(clamp(raw[i - 1] + drift + noise, 0.03, 0.97));
  }
  raw[raw.length - 1] = finalShare;
  return raw;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export type ActivityRow = {
  id: string;
  kind: "buy" | "sell";
  outcome: 0 | 1;
  amount: number;
  minutesAgo: number;
  wallet: string;
};

/** Deterministic mock activity feed (there is no indexer in this build). */
export function activityFor(id: string, count = 8): ActivityRow[] {
  const rand = mulberry32(hashString(`activity:${id}`));
  const rows: ActivityRow[] = [];
  let minutes = Math.floor(rand() * 4) + 1;
  for (let i = 0; i < count; i++) {
    const amount = Math.round((5 + rand() * 45) * 100) / 100;
    const hex = Math.floor(rand() * 0xffffffff)
      .toString(16)
      .padStart(8, "0");
    rows.push({
      id: `${id}-${i}`,
      kind: rand() > 0.82 ? "sell" : "buy",
      outcome: rand() > 0.45 ? 0 : 1,
      amount,
      minutesAgo: minutes,
      wallet: `0x${hex}${hex.slice(0, 4)}`,
    });
    minutes += Math.floor(2 + rand() * 55);
  }
  return rows;
}

function stancesFor(pool: ManifestPool): AiStances {
  return defaultStancesFor(pool.category);
}

/** Build the card model for a demo market. `nowSeconds` keeps countdowns honest. */
export function demoPoolToArena(pool: ManifestPool, nowSeconds: number): ArenaPool {
  const liquidity = u(Number(pool.liquidityUsdc ?? "0"));
  const share = pool.yesShare ?? 0.5;
  const option0 = BigInt(Math.round(Number(liquidity) * share));
  const option1 = liquidity - option0;
  return {
    id: BigInt(pool.id),
    title: pool.title,
    category: pool.category,
    tags: pool.tags ?? [],
    endTime: nowSeconds + Math.round((pool.endTimeOffsetHours ?? 24) * 3_600),
    status: pool.status ?? 1,
    winningOption: pool.winningOption ?? 0,
    totalNetPool: liquidity,
    option0Pool: option0,
    option1Pool: option1,
    settlementHash: pool.settlementHash ?? "",
    optionLabels: ["Yes", "No"],
    aiStances: stancesFor(pool),
    source: "demo",
    traders: pool.traders ?? 0,
    volume24h: u(Number(pool.volume24hUsdc ?? "0")),
  };
}

export function findManifestPool(manifest: Manifest | null, id: string): ManifestPool | undefined {
  return manifest?.pools.find((p) => p.id === id);
}

/** Market metadata that only the manifest knows (title/category/description). */
export function metaFor(manifest: Manifest | null, id: string) {
  const pool = findManifestPool(manifest, id);
  return {
    title: pool?.title ?? "",
    category: pool?.category ?? "",
    tags: pool?.tags ?? [],
    description: pool?.description ?? "",
    resolution: pool?.resolution ?? "",
  };
}

/** Agent names are used in the detail page's debate block. */
export function agentName(id: "hawk" | "detective" | "meme"): string {
  return AGENTS.find((a) => a.id === id)?.name ?? id;
}
