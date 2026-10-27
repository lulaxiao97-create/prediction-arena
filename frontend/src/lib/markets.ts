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
import { insightsFor } from "@/lib/insights";
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
  /** Absolute deadline (UTC ISO). Takes precedence over `endTimeOffsetHours` when present. */
  endTimeUtc?: string;
  /** Relative fallback used by hand-written seed rows. */
  endTimeOffsetHours?: number;
  liquidityUsdc?: string;
  yesShare?: number;
  volume24hUsdc?: string;
  traders?: number;
  description?: string;
  resolution?: string;
  /** Where the numbers in `title` came from (e.g. "Binance BTCUSDT"), for the provenance chip. */
  dataSource?: string;
  /** Snapshot timestamp of those numbers. */
  dataAsOf?: string;
  /** Resolved artwork written by gen-board (photo/accent/entity/mark). */
  visual?: import("@/lib/covers").CoverSpec;
  /** Structured spot/strike/feed for share text and cards. */
  marketData?: {
    asset: string;
    spotUsd: number;
    strikeUsd: number;
    direction: "above" | "below";
    windowDays: number;
    source: string;
    asOf: string;
  };
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

function stancesFor(pool: ManifestPool, nowSeconds: number): AiStances {
  const endTime = pool.endTimeUtc
    ? Math.floor(Date.parse(pool.endTimeUtc) / 1_000)
    : nowSeconds + Math.round((pool.endTimeOffsetHours ?? 24) * 3_600);
  const liquidity = Number(pool.liquidityUsdc ?? 0);
  const share = pool.yesShare ?? 0.5;
  // Context-aware: the take is built from this listing's own subject, strike, expiry and odds
  // (lib/insights), never from a paragraph shared by the whole category.
  return insightsFor({
    id: pool.id,
    title: pool.title,
    category: pool.category,
    tags: pool.tags,
    endTime,
    option0Pool: BigInt(Math.round(liquidity * share)),
    option1Pool: BigInt(Math.round(liquidity * (1 - share))),
    marketData: pool.marketData,
  });
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
    // Absolute deadlines come straight from the manifest so the server and the client agree to
    // the second; the offset form stays for hand-written seed rows.
    endTime: pool.endTimeUtc
      ? Math.floor(Date.parse(pool.endTimeUtc) / 1000)
      : nowSeconds + Math.round((pool.endTimeOffsetHours ?? 24) * 3_600),
    status: pool.status ?? 1,
    winningOption: pool.winningOption ?? 0,
    totalNetPool: liquidity,
    option0Pool: option0,
    option1Pool: option1,
    settlementHash: pool.settlementHash ?? "",
    optionLabels: ["Yes", "No"],
    aiStances: stancesFor(pool, nowSeconds),
    source: "demo",
    traders: pool.traders ?? 0,
    volume24h: u(Number(pool.volume24hUsdc ?? "0")),
    marketData: pool.marketData,
    visual: pool.visual,
    // Search covers everything a visitor might type: the question, the lane, the asset ticker,
    // the resolution source ("binance", "defillama") and the prose that explains the market.
    searchText: [
      pool.title,
      pool.category,
      ...(pool.tags ?? []),
      pool.description ?? "",
      pool.resolution ?? "",
      pool.dataSource ?? "",
      pool.marketData?.asset ?? "",
    ]
      .join(" ")
      .toLowerCase(),
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
    dataSource: pool?.dataSource ?? "",
    dataAsOf: pool?.dataAsOf ?? "",
    marketData: pool?.marketData,
    description: pool?.description ?? "",
    resolution: pool?.resolution ?? "",
  };
}

/** Agent names are used in the detail page's debate block. */
export function agentName(id: "hawk" | "detective" | "meme"): string {
  return AGENTS.find((a) => a.id === id)?.name ?? id;
}
