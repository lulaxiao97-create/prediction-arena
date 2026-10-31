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

export type AssetKind = "crypto" | "equity" | "index" | "commodity" | "fx";

export type Asset = {
  symbol: string;
  name: string;
  /** CoinGecko id — the cross-check for every row and the primary for Base tokens. */
  cg?: string;
  /** Binance spot symbol when the pair exists. */
  binance?: string;
  /** Yahoo Finance symbol for anything Binance does not quote (equities, indices, metals, FX). */
  yahoo?: string;
  /** Base-ecosystem token rather than a major. */
  base?: boolean;
  kind?: AssetKind;
};

export type AssetQuote = {
  usd: number;
  change24h: number | null;
  source: "binance" | "coingecko" | "yahoo";
  /** ISO timestamp of the reading. */
  asOf: string;
};

/**
 * A macro reading from FRED. Separate from `assets` because these are not prices you can buy:
 * they are the numbers a macro market resolves against (yields, policy rate, CPI, unemployment).
 */
export type MacroSeries = {
  value: number;
  /** previous observation, so a market can be struck relative to an actual move */
  prev: number | null;
  /** observation date (not fetch time) — FRED publishes daily/monthly series */
  asOf: string;
  source: "fred";
  unit: string;
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
  /** FRED readings: US10Y, US2Y, FED_UPPER, UNRATE, CPI_YOY, CORE_CPI_YOY, CURVE_2S10S. */
  macro?: Record<string, MacroSeries>;
};

export const ASSETS: Asset[] = [
  // ── crypto majors, Binance spot ───────────────────────────────────────────
  { symbol: "BTC", name: "Bitcoin", cg: "bitcoin", binance: "BTCUSDT", kind: "crypto" },
  { symbol: "ETH", name: "Ethereum", cg: "ethereum", binance: "ETHUSDT", kind: "crypto" },
  { symbol: "SOL", name: "Solana", cg: "solana", binance: "SOLUSDT", kind: "crypto" },
  { symbol: "BNB", name: "BNB", cg: "binancecoin", binance: "BNBUSDT", kind: "crypto" },
  { symbol: "XRP", name: "XRP", cg: "ripple", binance: "XRPUSDT", kind: "crypto" },
  { symbol: "DOGE", name: "Dogecoin", cg: "dogecoin", binance: "DOGEUSDT", kind: "crypto" },
  { symbol: "AVAX", name: "Avalanche", cg: "avalanche-2", binance: "AVAXUSDT", kind: "crypto" },
  { symbol: "LINK", name: "Chainlink", cg: "chainlink", binance: "LINKUSDT", kind: "crypto" },
  { symbol: "UNI", name: "Uniswap", cg: "uniswap", binance: "UNIUSDT", kind: "crypto" },
  { symbol: "AAVE", name: "Aave", cg: "aave", binance: "AAVEUSDT", kind: "crypto" },
  { symbol: "ARB", name: "Arbitrum", cg: "arbitrum", binance: "ARBUSDT", kind: "crypto" },
  { symbol: "OP", name: "Optimism", cg: "optimism", binance: "OPUSDT", kind: "crypto" },
  { symbol: "SUI", name: "Sui", cg: "sui", binance: "SUIUSDT", kind: "crypto" },
  { symbol: "ENA", name: "Ethena", cg: "ethena", binance: "ENAUSDT", kind: "crypto" },
  { symbol: "ONDO", name: "Ondo", cg: "ondo-finance", binance: "ONDOUSDT", kind: "crypto" },
  { symbol: "TAO", name: "Bittensor", cg: "bittensor", binance: "TAOUSDT", kind: "crypto" },
  { symbol: "HYPE", name: "Hyperliquid", cg: "hyperliquid", binance: "HYPEUSDT", kind: "crypto" },
  { symbol: "PEPE", name: "Pepe", cg: "pepe", binance: "PEPEUSDT", kind: "crypto" },
  { symbol: "WIF", name: "dogwifhat", cg: "dogwifcoin", binance: "WIFUSDT", kind: "crypto" },
  // ── Base ecosystem — quoted on CoinGecko only ─────────────────────────────
  { symbol: "AERO", name: "Aerodrome", cg: "aerodrome-finance", base: true, kind: "crypto" },
  { symbol: "DEGEN", name: "Degen", cg: "degen-base", base: true, kind: "crypto" },
  { symbol: "BRETT", name: "Brett", cg: "based-brett", base: true, kind: "crypto" },
  { symbol: "TOSHI", name: "Toshi", cg: "toshi", base: true, kind: "crypto" },
  { symbol: "MOG", name: "Mog Coin", cg: "mog-coin", base: true, kind: "crypto" },
  { symbol: "ZORA", name: "Zora", cg: "zora", base: true, kind: "crypto" },
  { symbol: "USDC", name: "USD Coin", cg: "usd-coin", base: true, kind: "crypto" },
  // ── tokenised gold: the only commodity a Base venue can settle on-chain ───
  { symbol: "PAXG", name: "PAX Gold", cg: "pax-gold", binance: "PAXGUSDT", kind: "commodity" },
  // ── equities, indices, commodities, FX — Yahoo Finance ────────────────────
  { symbol: "NVDA", name: "NVIDIA", yahoo: "NVDA", kind: "equity" },
  { symbol: "AAPL", name: "Apple", yahoo: "AAPL", kind: "equity" },
  { symbol: "MSFT", name: "Microsoft", yahoo: "MSFT", kind: "equity" },
  { symbol: "GOOGL", name: "Alphabet", yahoo: "GOOGL", kind: "equity" },
  { symbol: "TSLA", name: "Tesla", yahoo: "TSLA", kind: "equity" },
  { symbol: "META", name: "Meta Platforms", yahoo: "META", kind: "equity" },
  { symbol: "AMD", name: "AMD", yahoo: "AMD", kind: "equity" },
  { symbol: "SPX", name: "S&P 500", yahoo: "^GSPC", kind: "index" },
  { symbol: "NDX", name: "Nasdaq Composite", yahoo: "^IXIC", kind: "index" },
  { symbol: "GOLD", name: "COMEX gold", yahoo: "GC=F", kind: "commodity" },
  { symbol: "SILVER", name: "COMEX silver", yahoo: "SI=F", kind: "commodity" },
  { symbol: "OIL", name: "WTI crude", yahoo: "CL=F", kind: "commodity" },
  { symbol: "DXY", name: "US dollar index", yahoo: "DX-Y.NYB", kind: "fx" },
];

/** FRED series → the key a market title is allowed to quote. */
const FRED_SERIES: { key: string; id: string; unit: string }[] = [
  { key: "US10Y", id: "DGS10", unit: "%" },
  { key: "US2Y", id: "DGS2", unit: "%" },
  { key: "FED_UPPER", id: "DFEDTARU", unit: "%" },
  { key: "UNRATE", id: "UNRATE", unit: "%" },
  { key: "CURVE_2S10S", id: "T10Y2Y", unit: "pp" },
  { key: "MORTGAGE30", id: "MORTGAGE30US", unit: "%" },
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
  const ids = assets.map((a) => a.cg).filter(Boolean).join(",");
  if (!ids) return {};
  const data = curlJson<CgSimple>(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
  );
  const now = new Date().toISOString();
  const out: Record<string, AssetQuote> = {};
  for (const a of assets) {
    if (!a.cg) continue;
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

/* ───────────────────────────── Yahoo Finance ───────────────────────────── */

/**
 * Yahoo's chart endpoint is the only free source on this box that quotes equities, indices and
 * metals without a key. `query1` rate-limits this proxy aggressively (HTTP 429 "Edge: Too Many
 * Requests"), `query2` answers — so the host is chosen once here rather than per call. curl, not
 * fetch, for the same proxy reason as every other source in this file.
 */
const YAHOO_HOST = "https://query2.finance.yahoo.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36";

type YahooChart = {
  chart?: {
    result?: {
      meta?: { regularMarketPrice?: number; regularMarketTime?: number; chartPreviousClose?: number };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
    error?: { description?: string } | null;
  };
};

function yahooQuote(sym: string): AssetQuote | null {
  const q = encodeURIComponent(sym);
  const raw = execFileSync(
    "curl",
    ["-sS", "--max-time", "20", "-A", UA, "-H", "accept: application/json",
      `${YAHOO_HOST}/v8/finance/chart/${q}?range=5d&interval=1d`],
    { encoding: "utf8", timeout: 25_000, maxBuffer: 4 * 1024 * 1024 }
  );
  if (!raw.trim()) return null;
  const d = JSON.parse(raw) as YahooChart;
  const r = d.chart?.result?.[0];
  if (!r) return null;
  const closes = (r.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => typeof c === "number" && c > 0);
  const last = r.meta?.regularMarketPrice ?? closes[closes.length - 1];
  if (!last) return null;
  // Previous *session* close: the second-to-last print when today's bar already exists, else
  // chartPreviousClose. Using chartPreviousClose with range=5d would compare across five days.
  const prev = closes.length >= 2 ? closes[closes.length - 2] : r.meta?.chartPreviousClose ?? null;
  const change = prev && prev > 0 ? ((last - prev) / prev) * 100 : null;
  return {
    usd: last,
    change24h: change === null ? null : Number(change.toFixed(3)),
    source: "yahoo",
    asOf: new Date((r.meta?.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

function fromYahoo(assets: Asset[]): { quotes: Record<string, AssetQuote>; failed: string[] } {
  const quotes: Record<string, AssetQuote> = {};
  const failed: string[] = [];
  for (const a of assets) {
    if (!a.yahoo) continue;
    try {
      const q = yahooQuote(a.yahoo);
      if (q) quotes[a.symbol] = q;
      else failed.push(a.symbol);
    } catch (err) {
      failed.push(a.symbol);
      console.warn(`[prices] yahoo ${a.symbol} failed: ${(err as Error).message.slice(0, 90)}`);
    }
  }
  return { quotes, failed };
}

/* ───────────────────────────── FRED ───────────────────────────── */

/** `/graph/fredgraph.csv?id=SERIES` is public, keyless and stable — the macro counterpart of Binance. */
function fredCsv(id: string): { date: string; value: number }[] {
  const raw = execFileSync(
    "curl",
    ["-sS", "--max-time", "30", `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`],
    { encoding: "utf8", timeout: 35_000, maxBuffer: 8 * 1024 * 1024 }
  );
  const out: { date: string; value: number }[] = [];
  for (const line of raw.trim().split("\n").slice(1)) {
    const [date, v] = line.split(",");
    const value = Number(v);
    if (date && Number.isFinite(value)) out.push({ date, value });
  }
  return out;
}

/** Year-over-year % change of a monthly index, matched on the same month one year earlier. */
function yoy(rows: { date: string; value: number }[]): { value: number; prev: number | null; asOf: string } | null {
  if (rows.length < 13) return null;
  const latest = rows[rows.length - 1];
  const yearAgo = rows.find((r) => r.date === `${Number(latest.date.slice(0, 4)) - 1}${latest.date.slice(4)}`);
  if (!yearAgo) return null;
  const value = Number((((latest.value - yearAgo.value) / yearAgo.value) * 100).toFixed(2));
  // prior print = the previous month's YoY, so a "hotter than last time" market has a real anchor
  const prevRows = rows.slice(0, -1);
  const prevLatest = prevRows[prevRows.length - 1];
  const prevYearAgo = prevRows.find((r) => r.date === `${Number(prevLatest.date.slice(0, 4)) - 1}${prevLatest.date.slice(4)}`);
  const prev = prevYearAgo ? Number((((prevLatest.value - prevYearAgo.value) / prevYearAgo.value) * 100).toFixed(2)) : null;
  return { value, prev, asOf: latest.date };
}

function fromFred(): { macro: Record<string, MacroSeries>; failed: string[] } {
  const macro: Record<string, MacroSeries> = {};
  const failed: string[] = [];
  for (const s of FRED_SERIES) {
    try {
      const rows = fredCsv(s.id);
      if (!rows.length) { failed.push(s.key); continue; }
      const last = rows[rows.length - 1];
      const prev = rows.length > 1 ? rows[rows.length - 2].value : null;
      macro[s.key] = { value: last.value, prev, asOf: last.date, source: "fred", unit: s.unit };
    } catch (err) {
      failed.push(s.key);
      console.warn(`[prices] fred ${s.key} failed: ${(err as Error).message.slice(0, 80)}`);
    }
  }
  for (const [key, id] of [["CPI_YOY", "CPIAUCSL"], ["CORE_CPI_YOY", "CPILFESL"]] as const) {
    try {
      const y = yoy(fredCsv(id));
      if (!y) { failed.push(key); continue; }
      macro[key] = { value: y.value, prev: y.prev, asOf: y.asOf, source: "fred", unit: "%" };
    } catch (err) {
      failed.push(key);
      console.warn(`[prices] fred ${key} failed: ${(err as Error).message.slice(0, 80)}`);
    }
  }
  return { macro, failed };
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
  // Base and Ethereum are the venue's own story; the rest are the comparison set a TVL market
  // needs to be a real question ("Base overtakes Arbitrum") instead of a single-number guess.
  const wanted = new Set(["base", "ethereum", "solana", "arbitrum", "optimism", "polygon", "avalanche", "unichain"]);
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
  const sources: Record<string, "ok" | "failed"> = {
    binance: "failed",
    coingecko: "failed",
    defillama: "failed",
    yahoo: "failed",
    fred: "failed",
  };
  const assets: Record<string, AssetQuote> = {};

  try {
    Object.assign(assets, fromBinance(ASSETS));
    sources.binance = "ok";
  } catch (err) {
    console.warn(`[prices] binance failed: ${(err as Error).message}`);
  }

  // CoinGecko fills the Base tokens and backstops any major Binance did not return.
  const missing = ASSETS.filter((a) => !assets[a.symbol] && a.cg);
  try {
    Object.assign(assets, fromCoinGecko(missing.length ? missing : ASSETS.filter((a) => a.cg)));
    if (missing.length !== ASSETS.filter((a) => a.cg).length) sources.coingecko = "ok";
  } catch (err) {
    console.warn(`[prices] coingecko failed: ${(err as Error).message}`);
  }

  // Equities / indices / metals. One symbol failing (a delisted ticker, a throttled edge) must not
  // take the whole board with it, so the loop is per-symbol and the source is only "ok" when at
  // least one quote landed.
  const yahoo = fromYahoo(ASSETS);
  Object.assign(assets, yahoo.quotes);
  if (Object.keys(yahoo.quotes).length) sources.yahoo = "ok";

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

  let macro: PriceSnapshot["macro"];
  try {
    const fred = fromFred();
    if (Object.keys(fred.macro).length) {
      macro = fred.macro;
      sources.fred = "ok";
    }
  } catch (err) {
    console.warn(`[prices] fred failed: ${(err as Error).message}`);
  }

  // Anything the sources did not return keeps its previous reading rather than disappearing.
  for (const a of ASSETS) {
    if (!assets[a.symbol] && previous?.assets?.[a.symbol]) {
      assets[a.symbol] = { ...previous.assets[a.symbol], source: previous.assets[a.symbol].source };
      console.warn(`[prices] ${a.symbol} stale — kept reading from ${previous.assets[a.symbol].asOf}`);
    }
  }
  // Same rule for macro: a FRED outage must not silently drop every rates market.
  if (!macro && previous?.macro) macro = previous.macro;

  return {
    updatedAt: new Date().toISOString(),
    sources,
    assets,
    global: global ?? previous?.global,
    chains: chains ?? previous?.chains,
    macro,
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
    if (s.macro) {
      for (const [k, v] of Object.entries(s.macro)) {
        console.log(`  ${k.padEnd(12)} ${String(v.value).padStart(8)}${v.unit}  prev ${v.prev ?? "—"}  (${v.asOf})`);
      }
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
