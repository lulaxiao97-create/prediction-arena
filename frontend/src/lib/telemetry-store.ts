import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * File-backed telemetry, no database.
 *
 * Two files under `.data/`: `analytics-events.json` (append-only, capped ring of raw events) and
 * `connected-wallets.json` (one row per address, first/last seen + count). Both are plain JSON so the
 * admin dashboard can be rebuilt after a wipe, and so the operator can `cat` them without a client.
 *
 * Caveat that matters in production: the Render filesystem is ephemeral, so events survive only until
 * the next deploy. That is acceptable for an operator view ("what happened today"), and it is stated
 * in the dashboard rather than pretended away.
 */

export type TelemetryEvent = {
  at: string;
  type: "view" | "click" | "wallet" | "share";
  path: string;
  ip: string;
  country: string | null;
  city: string | null;
  source: string;
  ref: string | null;
  wallet: string | null;
  marketId: string | null;
  ua: string | null;
};

export type WalletRow = {
  address: string;
  firstSeen: string;
  lastSeen: string;
  connects: number;
  country: string | null;
  source: string;
};

const ROOT = process.cwd();
const DATA = join(ROOT, "..", ".data");
const EVENTS = join(DATA, "analytics-events.json");
const WALLETS = join(DATA, "connected-wallets.json");
const MAX_EVENTS = 5000;

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  try {
    mkdirSync(DATA, { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  } catch {
    /* read-only filesystem (some hosts) — the dashboard will show what it has */
  }
}

/** Source attribution from the URL the user landed on. */
export function classifySource(path: string, ref: string | null, referer: string | null): string {
  const p = `${path} ${ref ?? ""}`.toLowerCase();
  if (p.includes("utm_source=x") || p.includes("ref=x") || (referer ?? "").includes("x.com") || (referer ?? "").includes("twitter.com")) return "x";
  if ((referer ?? "").includes("t.me") || (referer ?? "").includes("telegram")) return "telegram";
  if (ref) return "referral";
  if (!referer) return "direct";
  try {
    return new URL(referer).hostname.replace(/^www\./, "");
  } catch {
    return "direct";
  }
}

export function record(event: TelemetryEvent): void {
  const rows = readJson<TelemetryEvent[]>(EVENTS, []);
  rows.push(event);
  writeJson(EVENTS, rows.slice(-MAX_EVENTS));

  if (event.type === "wallet" && event.wallet) {
    const key = event.wallet.toLowerCase();
    const wallets = readJson<Record<string, WalletRow>>(WALLETS, {});
    const prev = wallets[key];
    wallets[key] = {
      address: event.wallet,
      firstSeen: prev?.firstSeen ?? event.at,
      lastSeen: event.at,
      connects: (prev?.connects ?? 0) + 1,
      country: event.country ?? prev?.country ?? null,
      source: prev?.source ?? event.source,
    };
    writeJson(WALLETS, wallets);
  }
}

export function events(): TelemetryEvent[] {
  return readJson<TelemetryEvent[]>(EVENTS, []);
}

export function wallets(): WalletRow[] {
  return Object.values(readJson<Record<string, WalletRow>>(WALLETS, {}));
}

/** Aggregate for the dashboard: traffic, sources, per-market heat, recent feed. */
export function summarise(limit = 500) {
  const all = events();
  const walletsAll = wallets();
  const now = Date.now();
  const day = all.filter((e) => now - Date.parse(e.at) < 24 * 3600_000);

  const bySource: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  const byPath: Record<string, number> = {};
  const byMarket: Record<string, number> = {};
  const ips = new Map<string, { ip: string; country: string | null; city: string | null; hits: number; last: string; source: string }>();

  for (const e of day) {
    bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    if (e.country) byCountry[e.country] = (byCountry[e.country] ?? 0) + 1;
    byPath[e.path] = (byPath[e.path] ?? 0) + 1;
    if (e.marketId) byMarket[e.marketId] = (byMarket[e.marketId] ?? 0) + 1;
    const row = ips.get(e.ip) ?? { ip: e.ip, country: e.country, city: e.city, hits: 0, last: e.at, source: e.source };
    row.hits += 1;
    row.last = e.at;
    ips.set(e.ip, row);
  }

  return {
    totals: {
      events: all.length,
      events24h: day.length,
      views24h: day.filter((e) => e.type === "view").length,
      wallets: walletsAll.length,
      uniqueIps24h: ips.size,
    },
    bySource,
    byCountry,
    topPaths: Object.entries(byPath).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([path, hits]) => ({ path, hits })),
    marketHeat: Object.entries(byMarket).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, hits]) => ({ id, hits })),
    recentIps: [...ips.values()].sort((a, b) => b.last.localeCompare(a.last)).slice(0, limit),
    wallets: walletsAll.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).slice(0, 200),
  };
}
