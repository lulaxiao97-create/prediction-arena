import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Server-side view of the pool manifest.
 *
 * The browser loads `public/pools.json` over HTTP; the server needs the same facts before a
 * request is rendered — for the `<head>` of a market page and for its Open Graph card. Both
 * read it here so a share card can never disagree with the page it previews.
 */
export type ManifestPool = {
  id: string;
  title: string;
  category?: string;
  status?: number;
  /** Demo entries carry a precomputed share; chain entries carry the two side pools. */
  yesShare?: number;
  liquidityUsdc?: string;
  volume24hUsdc?: string;
  option0Pool?: string | null;
  option1Pool?: string | null;
  totalNetPool?: string | null;
  traders?: number;
  tags?: string[];
  /** Long-form copy that gen-board writes for every market — also the page's meta description. */
  description?: string;
  /** The exact condition that settles the market; rendered as the Question's accepted answer. */
  resolution?: string;
  endTimeUtc?: string;
  dataSource?: string;
  dataAsOf?: string;
  /** Resolved artwork written by gen-board; the OG card reads it as its backdrop. */
  visual?: import("@/lib/covers").CoverSpec;
  /** spot/strike/feed behind the title — drives the share card's provenance badge. */
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
  address?: string;
  chainId?: number;
  updatedAt?: string;
  pools?: ManifestPool[];
};

export async function readManifest(): Promise<Manifest | null> {
  try {
    const raw = await readFile(path.join(process.cwd(), "public", "pools.json"), "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

export async function readPool(id: string): Promise<ManifestPool | null> {
  const manifest = await readManifest();
  return manifest?.pools?.find((p) => String(p.id) === String(id)) ?? null;
}

/**
 * Implied YES share, 0..1. Demo markets publish `yesShare` directly; on-chain markets are
 * derived from the two escrowed sides. A market with neither reads as a coin flip.
 */
export function impliedYes(pool: ManifestPool | null): number {
  if (typeof pool?.yesShare === "number") return Math.min(1, Math.max(0, pool.yesShare));
  const a = Number(pool?.option0Pool ?? 0);
  const b = Number(pool?.option1Pool ?? 0);
  if (!a && !b) return 0.5;
  return a / (a + b);
}

/**
 * Escrow label for share cards: `$1.2M`, `$89.6K`, or `—`.
 *
 * Reads `totalNetPool` (the contract's net pool) and nothing else. It used to prefer
 * `pool.liquidityUsdc`, a field gen-board generated as `9_000 + p·50_000` — so a market with no
 * stake drew a card claiming $27K of depth. A market with no stake has no number to print.
 */
export function liquidityLabel(pool: ManifestPool | null): string {
  const raw = Number(pool?.totalNetPool ?? 0);
  if (!raw) return "—";
  if (raw >= 1_000_000) return `$${(raw / 1_000_000).toFixed(1)}M`;
  if (raw >= 1_000) return `$${(raw / 1_000).toFixed(1)}K`;
  return `$${Math.round(raw)}`;
}
