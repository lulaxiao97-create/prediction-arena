/**
 * Community discussion seed data.
 *
 * Every market gets 3–5 pre-written posts so a fresh pool never shows an empty thread. Content is
 * picked deterministically from the pool id, so the same market always shows the same thread —
 * a reload does not reshuffle the "community". Numbers in the copy are derived from the pool's
 * live YES share where the sentence needs one, so the thread does not contradict the chart.
 */
import { generateComments } from "@/lib/auto-gen";

export type Stance = "bull" | "bear";

export type CommunityPost = {
  id: string;
  address: string;
  stance: Stance;
  body: string;
  minutesAgo: number;
  upvotes: number;
  mine?: boolean;
};

/** xorshift-ish deterministic PRNG seeded by a string. */
function rng(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13;
    h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 4294967296;
  };
}

function fakeAddress(seed: string, index: number): string {
  const r = rng(`${seed}:addr:${index}`);
  const hex = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < 6; i++) s += hex[Math.floor(r() * 16)];
  let tail = "";
  for (let i = 0; i < 4; i++) tail += hex[Math.floor(r() * 16)];
  return `${s}…${tail}`;
}

/**
 * Deterministic thread for a pool. `yesPct` is the live YES probability (0–100) used inside the
 * copy so the posters quote the same number the chart shows.
 */
export function seedPostsFor(poolId: string, category: string, yesPct: number): CommunityPost[] {
  // Generated, not curated: the bull/bear mix follows the live implied probability, so a market at
  // 78% reads bullish and a market at 22% reads bearish. Deterministic per (poolId, probability band)
  // — a reload never reshuffles the thread, and a real probability move visibly changes the mood.
  return generateComments({ poolId, category, yesPct }).map((c) => ({
    id: c.id,
    address: c.address,
    stance: c.stance,
    body: c.body,
    minutesAgo: c.minutesAgo,
    upvotes: c.upvotes,
  }));
}

export function relativeTime(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}


