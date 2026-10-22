/**
 * Pre-generated debate cache.
 *
 * Written by `scripts/gen-debates.ts` (the only process allowed to call a model), shipped as
 * `public/debates.json`, and inlined at build time for the first paint. The browser reads it — it
 * never generates. That is what makes opening a market free and instant.
 */
export type CachedLine = {
  agent: "detective" | "hawk" | "meme";
  stance: "bull" | "bear";
  text: string;
};

export type DebateEntry = {
  /** probability band this argument set was written for (10-point buckets) */
  band: number;
  /** language of `lines`; absent on older caches, which were English */
  lang?: "en" | "zh-TW" | "de" | "fr" | "ja" | "ko";
  /** ISO timestamp of generation */
  at: string;
  source: "llm" | "kernel";
  model?: string;
  lines: CachedLine[];
};

export type DebateCache = {
  version: number;
  generatedAt: string;
  model: string;
  debates: Record<string, DebateEntry>;
};

export function bandOf(yesPct: number): number {
  return Math.round(yesPct / 10) * 10;
}

/**
 * Pick a cached debate for this market.
 *
 * Returns null when the entry is missing or when the market has drifted more than 20 points from
 * the band the text was written for — showing an 80%-confidence argument on a 30% market would be
 * worse than showing the neutral kernel version.
 */
export function pickDebate(
  cache: DebateCache | null,
  poolId: string,
  yesPct: number,
  lang = "en"
): DebateEntry | null {
  // keys are `"<poolId>:<lang>"`; older caches used a bare poolId and were English-only
  const entry = cache?.debates?.[`${poolId}:${lang}`] ?? (lang === "en" ? cache?.debates?.[poolId] : undefined);
  if (!entry?.lines?.length) return null;
  if ((entry.lang ?? "en") !== lang) return null;
  if (Math.abs(entry.band - bandOf(yesPct)) > 20) return null;
  return entry;
}

/** How far the market has drifted from the cached band (0 when fresh). */
export function driftOf(entry: DebateEntry | null, yesPct: number): number {
  if (!entry) return Number.POSITIVE_INFINITY;
  return Math.abs(entry.band - bandOf(yesPct));
}
