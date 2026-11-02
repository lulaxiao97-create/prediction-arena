/**
 * The heat model, in one place.
 *
 * Every surface that has to answer "which market is worth posting right now" — the desktop pack's
 * reply deck, the hot board the daemon writes every 15 minutes, the Telegram daily report — imports
 * this file. Two implementations of "hot" drift within a week: the pack would promote a market the
 * bot never mentions, and nobody would notice because both look plausible.
 *
 * Signals, in the order they matter:
 *   · controversy — a split crowd argues; this is the whole point of a reply.
 *   · volatility   — a moving tape is a story ("AMD −4% today"), a flat one is a statistic.
 *   · crowd        — traders on the book, capped so one whale market cannot dominate.
 *   · urgency      — a deadline inside 48h converts better than one inside a month.
 *   · lane pull    — stocks / AI / memes / policy are the rooms where people actually reply.
 */

export type HotPool = {
  id: string | number;
  title: string;
  category?: string;
  status?: number;
  traders?: number;
  yesShare?: number;
  endTimeUtc?: string;
  heat?: { controversy?: number; volatilityPct?: number };
};

export const LANE_PULL: Record<string, number> = {
  "Global Stocks": 7,
  "AI Agents & Tech": 7,
  "Memes & Social": 6,
  "US Politics & Policy": 5,
  "Crypto Core": 4,
};

export function shareOf(pool: HotPool): number {
  const raw = Number(pool.yesShare ?? Number.NaN);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.5;
}

export function heatScore(pool: HotPool, now = Date.now()): number {
  const controversy = pool.heat?.controversy ?? 1 - Math.abs(shareOf(pool) - 0.5) * 2;
  const volatility = pool.heat?.volatilityPct ?? 0;
  const crowd = Math.min(1, (pool.traders ?? 0) / 320) * 8;
  const hoursLeft = pool.endTimeUtc ? (Date.parse(pool.endTimeUtc) - now) / 3.6e6 : 999;
  const urgency = hoursLeft <= 48 ? 8 : hoursLeft <= 24 * 7 ? 4 : 0;
  return controversy * 40 + volatility * 3 + crowd + urgency + (LANE_PULL[String(pool.category ?? "")] ?? 0);
}

/**
 * The copy-friendly market (not the whole flagship list): one per sector, highest heat first.
 * Two NVIDIA markets under two different posts read like a bot, so a pick can never repeat a lane
 * until every lane has been used.
 */
export function pickContrarian<T extends HotPool>(pools: T[], n: number): T[] {
  const ranked = [...pools].sort((a, b) => heatScore(b) - heatScore(a));
  const picks: T[] = [];
  const used = new Set<string>();
  for (const pool of ranked) {
    if (picks.length >= n) break;
    const category = String(pool.category ?? "");
    if (category && used.has(category)) continue;
    used.add(category);
    picks.push(pool);
  }
  for (const pool of ranked) {
    if (picks.length >= n) break;
    if (!picks.includes(pool)) picks.push(pool);
  }
  return picks;
}
