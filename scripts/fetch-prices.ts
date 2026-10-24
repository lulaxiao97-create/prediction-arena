/**
 * Live market data — one fetch, three public sources, no API key.
 *
 *   node --experimental-strip-types scripts/fetch-prices.ts
 *
 * Writes `frontend/public/prices.json`, which the board generator and the on-chain market
 * generator both read. Nothing in this repo is allowed to invent a price again: a market that
 * needs a number takes it from this snapshot, and the snapshot records where each number came
 * from and when.
 *
 * Sources, in the order they are trusted for each row:
 *   • Binance  /api/v3/ticker/24hr   — majors (deepest book, 24h change included)
 *   • CoinGecko /simple/price        — Base-ecosystem tokens Binance does not quote
 *   • CoinGecko /global              — total market cap, 24h change, BTC dominance
 *   • DefiLlama /v2/chains           — chain TVL for Base / Ethereum / Solana
 *
 * Every request goes through `curl`, not `fetch`: this box reaches the internet through an
 * egress proxy that only curl honours (Node's fetch ignores HTTPS_PROXY unless the process is
 * started with NODE_USE_ENV_PROXY, and the cron entry does not control that). One dependency
 * fewer and the proxy behaviour is the same everywhere.
 *
 * Fail-soft by design: if a source is down the previous snapshot is kept and only the failing
 * rows are logged. A stale price is bad; a fabricated one is worse.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "frontend", "public", "prices.json");

export type Asset = {
  symbol: string;
  name: string;
  /** CoinGecko id — the cross-check for every row and the primary for Base tokens. */
  cg: string;
  /** Binance spot symbol when the pair exists. */
  binance?: string;
  /** Base-ecosystem token rather than a major. */
  base?: boolean;
};

export type AssetQuote = {
  usd: number;
  change24h: number | null;
  source: "binance" | "coingecko";
  /** ISO timestamp of the reading. */
  asOf: string;
};

export type PriceSnapshot = {
  updatedAt: string;
  sources: Record<string, "ok" | "failed">;
  assets: Record<string, AssetQuote>;
  global?: {
    totalMarketCapUsd: number;
    change24h: number | null;
    btcDominance: number | null;
  };
  chains?: Record<string, { tvlUsd: number; source: "defillama" }>;
};

export const ASSETS: Asset[] = [
  { symbol: "BTC", name: "Bitcoin", cg: "bitcoin", binance: "BTCUSDT" },
  { symbol: "ETH", name: "Ethereum", cg: "ethereum", binance: "ETHUSDT" },
  { symbol: "SOL", name: "Solana", cg: "solana", binance: "SOLUSDT" },
  // Base ecosystem — quoted on CoinGecko only.
  { symbol: "AERO", name: "Aerodrome", cg: "aerodrome-finance", base: true },
  { symbol: "DEGEN", name: "Degen", cg: "degen-base", base: true },
  { symbol: "BRETT", name: "Brett", cg: "based-brett", base: true },
  { symbol: "TOSHI", name: "Toshi", cg: "toshi", base: true },
  { symbol: "USDC", name: "USD Coin", cg: "usd-coin", base: true },
];

const CACHE_TTL_MS = 90_000;

function curlJson<T>(url: string, timeoutSec = 20): T {
  const out = execFileSync(
    "curl",
    ["-sS", "--max-time", String(timeoutSec), "-H", "accept: application/json", url],
    { encoding: "utf8", timeout: (timeoutSec + 5) * 1000, maxBuffer: 8 * 1024 * 1024 }
  );
  if (!out.trim()) throw new Error(`empty response from ${url}`);
  return JSON.parse(out) as T;
}

type BinanceRow = { symbol: string; lastPrice: string; priceChangePercent: string };

function fromBinance(assets: Asset[]): Record<string, AssetQuote> {
  const symbols = assets.filter((a) => a.binance).map((a) => a.binance!);
  if (!symbols.length) return {};
  const q = encodeURIComponent(JSON.stringify(symbols));
  const rows = curlJson<BinanceRow[]>(`https://api.binance.com/api/v3/ticker/24hr?symbols=${q}`);
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  const out: Record<string, AssetQuote> = {};
  const now = new Date().toISOString();
  for (const a of assets) {
    if (!a.binance) continue;
    const row = bySymbol.get(a.binance);
    const usd = Number(row?.lastPrice ?? 0);
    if (!usd) continue;
    out[a.symbol] = {
      usd,
      change24h: Number.isFinite(Number(row?.priceChangePercent)) ? Number(row!.priceChangePercent) : null,
      source: "binance",
      asOf: now,
    };
  }
  return out;
}

type CgSimple = Record<string, { usd?: number; usd_24h_change?: number }>;

function fromCoinGecko(assets: Asset[]): Record<string, AssetQuote> {
  if (!assets.length) return {};
  const ids = assets.map((a) => a.cg).join(",");
  const data = curlJson<CgSimple>(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
  );
  const now = new Date().toISOString();
  const out: Record<string, AssetQuote> = {};
  for (const a of assets) {
    const row = data[a.cg];
    const usd = Number(row?.usd ?? 0);
    if (!usd) continue;
    const chg = row?.usd_24h_change;
    out[a.symbol] = {
      usd,
      change24h: typeof chg === "number" && Number.isFinite(chg) ? chg : null,
      source: "coingecko",
      asOf: now,
    };
  }
  return out;
}

function globalContext(): PriceSnapshot["global"] | undefined {
  const d = curlJson<{
    data?: { total_market_cap?: Record<string, number>; market_cap_change_percentage_24h_usd?: number; market_cap_percentage?: Record<string, number> };
  }>("https://api.coingecko.com/api/v3/global");
  const g = d.data;
  if (!g?.total_market_cap?.usd) return undefined;
  return {
    totalMarketCapUsd: g.total_market_cap.usd,
    change24h: typeof g.market_cap_change_percentage_24h_usd === "number" ? g.market_cap_change_percentage_24h_usd : null,
    btcDominance: typeof g.market_cap_percentage?.btc === "number" ? g.market_cap_percentage.btc : null,
  };
}

function chainTvl(): PriceSnapshot["chains"] | undefined {
  const rows = curlJson<{ name: string; tvl: number }[]>("https://api.llama.fi/v2/chains");
  const wanted = new Set(["base", "ethereum", "solana"]);
  const out: Record<string, { tvlUsd: number; source: "defillama" }> = {};
  for (const r of rows) {
    const key = String(r.name ?? "").toLowerCase();
    if (wanted.has(key) && Number(r.tvl) > 0) out[key] = { tvlUsd: Number(r.tvl), source: "defillama" };
  }
  return Object.keys(out).length ? out : undefined;
}

export function readSnapshot(): PriceSnapshot | null {
  try {
    if (!existsSync(OUT)) return null;
    return JSON.parse(readFileSync(OUT, "utf8")) as PriceSnapshot;
  } catch {
    return null;
  }
}

export function snapshotAgeMs(snap: PriceSnapshot | null): number {
  if (!snap?.updatedAt) return Number.POSITIVE_INFINITY;
  return Date.now() - Date.parse(snap.updatedAt);
}

export async function fetchSnapshot(): Promise<PriceSnapshot> {
  const previous = readSnapshot();
  const sources: Record<string, "ok" | "failed"> = { binance: "failed", coingecko: "failed", defillama: "failed" };
  const assets: Record<string, AssetQuote> = {};

  try {
    Object.assign(assets, fromBinance(ASSETS));
    sources.binance = "ok";
  } catch (err) {
    console.warn(`[prices] binance failed: ${(err as Error).message}`);
  }

  // CoinGecko fills the Base tokens and backstops any major Binance did not return.
  const missing = ASSETS.filter((a) => !assets[a.symbol]);
  try {
    Object.assign(assets, fromCoinGecko(missing.length ? missing : ASSETS));
    if (missing.length !== ASSETS.length) sources.coingecko = "ok";
  } catch (err) {
    console.warn(`[prices] coingecko failed: ${(err as Error).message}`);
  }

  let global: PriceSnapshot["global"];
  try {
    global = globalContext();
    if (global) sources.coingecko = "ok";
  } catch (err) {
    console.warn(`[prices] coingecko global failed: ${(err as Error).message}`);
  }

  let chains: PriceSnapshot["chains"];
  try {
    chains = chainTvl();
    if (chains) sources.defillama = "ok";
  } catch (err) {
    console.warn(`[prices] defillama failed: ${(err as Error).message}`);
  }

  // Anything the sources did not return keeps its previous reading rather than disappearing.
  for (const a of ASSETS) {
    if (!assets[a.symbol] && previous?.assets?.[a.symbol]) {
      assets[a.symbol] = { ...previous.assets[a.symbol], source: previous.assets[a.symbol].source };
      console.warn(`[prices] ${a.symbol} stale — kept reading from ${previous.assets[a.symbol].asOf}`);
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    sources,
    assets,
    global: global ?? previous?.global,
    chains: chains ?? previous?.chains,
  };
}

function main() {
  const snap = fetchSnapshot();
  return snap.then((s) => {
    const rows = Object.entries(s.assets);
    if (!rows.length) {
      console.error("[prices] every source failed — keeping the previous snapshot");
      process.exit(1);
    }
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(s, null, 2) + "\n");
    console.log("── live snapshot ─────────────────────────────────────────────");
    console.log(`sources    : ${Object.entries(s.sources).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    for (const [sym, q] of rows) {
      const chg = q.change24h === null ? "—" : `${q.change24h.toFixed(2)}%`;
      console.log(`  ${sym.padEnd(6)} $${q.usd.toLocaleString("en-US", { maximumFractionDigits: q.usd < 1 ? 6 : 2 }).padStart(12)}  24h ${chg.padStart(8)}  ${q.source}`);
    }
    if (s.global) {
      console.log(`  global  mcap $${(s.global.totalMarketCapUsd / 1e12).toFixed(2)}T  24h ${s.global.change24h?.toFixed(2)}%  BTC dom ${s.global.btcDominance?.toFixed(2)}%`);
    }
    if (s.chains) {
      for (const [k, v] of Object.entries(s.chains)) console.log(`  ${k.padEnd(9)} TVL $${(v.tvlUsd / 1e9).toFixed(2)}B  (defillama)`);
    }
    console.log(`written    : ${OUT}`);
  });
}

if (process.argv[1] && process.argv[1].endsWith("fetch-prices.ts")) {
  main().catch((err) => {
    console.error(`[prices] fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}

export { CACHE_TTL_MS };
