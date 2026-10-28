/**
 * Growth & conversion data — the promo surface, the trust hooks and the "what's hot" rail.
 *
 * Copy lives in the i18n table (`growth.*`), not here: the same campaign has to read correctly in
 * six languages, and a component that hard-codes English is the reason a German visitor suddenly
 * sees a banner in English halfway down the page.
 *
 * Rule that shapes what the copy may claim: a promotional promise must be checkable on-chain in
 * under a minute. The contract takes its fee into per-market escrow at bet time, so no banner may
 * say "0% fee"; it can say — and does say — that the fee is escrowed and refunded in full when a
 * market is cancelled.
 */

import { displayLiquidityUsdc, displayTraders, fallbackShareFor, PLATFORM_FEE_RATE } from "@/lib/display-stats";

export const FEE_PCT = Math.round(PLATFORM_FEE_RATE * 100);

export type TrustChipId = "audited" | "nonCustodial" | "instant";

/** The three objections a first-time visitor raises, answered in four words each. */
export const TRUST_CHIPS: { id: TrustChipId; i18n: string; detail: string }[] = [
  {
    id: "audited",
    i18n: "growth.trustAudited",
    detail: "Internal audit closed with three P0 fixes; bytecode matches the published source.",
  },
  {
    id: "nonCustodial",
    i18n: "growth.trustNonCustodial",
    detail: "Stake stays in the contract, never in our wallet. We cannot withdraw your position.",
  },
  {
    id: "instant",
    i18n: "growth.trustInstant",
    detail: "Settlement is one on-chain call on Base; claims are never pausable.",
  },
];

export type GrowthOffer = {
  id: "launch" | "watch";
  emoji: string;
  kicker: string;
  title: string;
  body: string;
  cta: string;
  href: string;
  tone: "gold" | "cyan";
};

/** Two live offers. Both are mechanics the product already ships. */
export const GROWTH_OFFERS: GrowthOffer[] = [
  {
    id: "launch",
    emoji: "🔥",
    kicker: "growth.launchKicker",
    title: "growth.launchTitle",
    body: "growth.launchBody",
    cta: "growth.launchCta",
    href: "#markets",
    tone: "gold",
  },
  {
    id: "watch",
    emoji: "🎁",
    kicker: "growth.watchKicker",
    title: "growth.watchTitle",
    body: "growth.watchBody",
    cta: "growth.watchCta",
    href: "#markets",
    tone: "cyan",
  },
];

export type TrendPoint = {
  href: string;
  title: string;
  traders: number;
  liquidityUsdc: number;
  yesPct: number;
  mult: number;
};

type TrendPool = {
  id: string | number | bigint;
  title: string;
  status?: number;
  traders?: number;
  liquidityUsdc?: string | number;
  totalNetPool?: bigint;
  option0Pool?: bigint;
  option1Pool?: bigint;
};

/**
 * USDC arrives in two shapes: the manifest stores human units ("18500"), while a pool hydrated
 * from the contract carries 6-decimal base units (18_500_000_000). Anything above a million units
 * is base units; reading it as dollars is how the rail once printed "$18500.0M".
 */
export function usdc(v: string | number | bigint): number {
  const n = Number(v);
  return n > 1_000_000 ? n / 1e6 : n;
}

export function money(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

export function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/** On-chain side share when the pool holds real stake, otherwise the deterministic demo share. */
function sideShare(pool: TrendPool): number {
  const a = Number(pool.option0Pool ?? 0n);
  const b = Number(pool.option1Pool ?? 0n);
  if (a + b > 0) return a / (a + b);
  return fallbackShareFor(pool.id);
}

/**
 * The rail reads the same manifest the cards do, so the numbers on the rail and the numbers in the
 * grid never disagree. Sorted by who is actually busy: traders first, turnover as tie-break — a
 * market with 300 people in it is a better hook than a bigger pool nobody is trading.
 */
export function trendPoints(pools: TrendPool[], limit = 6): TrendPoint[] {
  return pools
    .filter((p) => (p.status ?? 1) === 1)
    .map((p) => {
      const traders = p.traders ?? displayTraders(p.id);
      const liquidity = usdc(p.liquidityUsdc ?? 0) || usdc(displayLiquidityUsdc(p.id));
      return { pool: p, traders, liquidity, score: traders * 1_000 + Math.min(liquidity, 99_999) / 100 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ pool, traders, liquidity }) => {
      const yes = Math.max(2, Math.min(98, Math.round(sideShare(pool) * 100)));
      return {
        href: `/market/${pool.id}`,
        title: clip(pool.title, 64),
        traders,
        liquidityUsdc: liquidity,
        yesPct: yes,
        mult: Number((1 / (yes / 100)).toFixed(1)),
      };
    });
}
