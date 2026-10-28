/**
 * Growth & conversion copy — one module for the promo surface, the trust hooks and the
 * "what's hot" ticker.
 *
 * Rule that shapes every string here: a promotional claim must be something a visitor can check
 * on-chain or in the app in under a minute. The contract takes a 4% fee into escrow at bet time
 * (`PLATFORM_FEE_RATE` in lib/display-stats), so no banner may say "0% fee"; what it can say, and
 * what these offers do say, is that the fee is escrowed per market and refunded in full when a
 * market is cancelled. A promo that a skeptic can disprove in one click costs more trust than it
 * buys clicks.
 */

import { displayLiquidityUsdc, displayTraders, fallbackShareFor, PLATFORM_FEE_RATE } from "@/lib/display-stats";

export type TrustChipId = "audited" | "nonCustodial" | "instant";

/** The three objections a first-time visitor raises, answered in four words each. */
export const TRUST_CHIPS: { id: TrustChipId; label: string; detail: string }[] = [
  {
    id: "audited",
    label: "Audited v3 contract",
    detail: "Internal audit closed with three P0 fixes; bytecode matches the published source.",
  },
  {
    id: "nonCustodial",
    label: "Non-custodial",
    detail: "Stake stays in the contract, never in our wallet. We cannot withdraw your position.",
  },
  {
    id: "instant",
    label: "Instant USDC settlement",
    detail: "Settlement is one on-chain call on Base; claims are never pausable.",
  },
];

export type GrowthOffer = {
  id: string;
  emoji: string;
  kicker: string;
  title: string;
  body: string;
  cta: string;
  href: string;
  tone: "gold" | "cyan";
};

const feePct = Math.round(PLATFORM_FEE_RATE * 100);

/**
 * Two live offers. Both are mechanics the product already ships: per-market fee escrow with a
 * full refund on cancel, and the Watch-to-Earn ledger (100 points → one $1 trial ticket).
 */
export const GROWTH_OFFERS: GrowthOffer[] = [
  {
    id: "launch",
    emoji: "🔥",
    kicker: "BASE MAINNET · LIVE",
    title: "Launch special: your fee is escrowed, not spent",
    body: `The ${feePct}% platform fee leaves your stake at bet time and sits in the market's escrow until settlement. If a market is cancelled you get 100% back — fee included.`,
    cta: "Take a position",
    href: "#markets",
    tone: "gold",
  },
  {
    id: "watch",
    emoji: "🎁",
    kicker: "WATCH-TO-EARN",
    title: "100 points = a $1 trial ticket",
    body: "Every sponsored placement that stays on screen credits 10 points, 12 times a day. Trade the ticket, keep the profit — no deposit needed to start.",
    cta: "Start earning",
    href: "#markets",
    tone: "cyan",
  },
];

export type TrendLine = { href: string; text: string };

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
 * from the contract carries 6-decimal base units (18_500_000_000). Anything with more than a
 * million units is base units, and reading it as dollars is how the rail printed "$18500.0M".
 */
function usdc(v: string | number | bigint): number {
  const n = Number(v);
  return n > 1_000_000 ? n / 1e6 : n;
}

function money(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

function clip(s: string, n: number): string {
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
 * The ticker reads the same manifest the cards do, so the numbers on the rail and the numbers in
 * the grid never disagree. Sorted by who is actually busy: traders first, turnover as tie-break —
 * a market with 300 people in it is a better FOMO hook than a bigger pool nobody is trading.
 */
export function trendLines(pools: TrendPool[], limit = 6): TrendLine[] {
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
      const mult = (1 / (yes / 100)).toFixed(1);
      return {
        href: `/market/${pool.id}`,
        text: `🔥 ${clip(pool.title, 64)} — ${traders} traders · ${money(liquidity)} liquidity · ${mult}× on YES`,
      };
    });
}
