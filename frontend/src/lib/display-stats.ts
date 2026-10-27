/**
 * Deterministic display numbers for a market card.
 *
 * The board is a demo venue: the contract holds no stake for most listings, and a card reading
 * `$0.00 / 0 traders` makes a live venue look switched off. Every card therefore carries
 * *presentation* figures derived from its market id alone — same id, same number, on the server,
 * in the browser, after a rebuild and after a wallet connects — instead of a random value that
 * would reshuffle on every render.
 *
 * These numbers are display-only. They never feed payout maths: `totalNetPool`, `option0Pool` and
 * the fee/quota guard stay the contract's, so an estimated return can never be computed from a
 * fabricated pool. See `ArenaPool.displayLiquidity` / `displayTraders`.
 *
 * `scripts/gen-board.ts` imports this same function to write the manifest, so `pools.json` and the
 * rendered card agree to the dollar rather than drifting apart.
 */

export type DisplayStats = {
  /** TOTAL LIQUIDITY shown on the card, $12,500–$88,500. */
  liquidityUsdc: number;
  /** Traders shown on the card, 85–320. */
  traders: number;
  /** 24h turnover shown next to the volume figure: 16–66% of the display liquidity. */
  volume24hUsdc: number;
};

export const LIQUIDITY_MIN = 12_500;
export const LIQUIDITY_MAX = 88_500;
export const TRADERS_MIN = 85;
export const TRADERS_MAX = 320;

/** FNV-1a over the id string — small, stable, no dependencies. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Second, independent stream (splitmix-style) so liquidity and traders do not correlate. */
function mix32(seed: number): number {
  let x = seed >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return (x ^ (x >>> 15)) >>> 0;
}

const unit = (h: number) => h / 0xffff_ffff; // → [0, 1)

export function displayStatsFor(marketId: string | number | bigint): DisplayStats {
  const key = String(marketId);
  const h = hash32(key);
  const a = mix32(h);
  const b = mix32(a ^ 0x5bf0_3635);
  const c = mix32(b ^ 0x27d4_eb2f);

  // Round to the nearest $100: a card that reads $37,412.83 looks computed, not traded.
  const liquidityUsdc =
    Math.round((LIQUIDITY_MIN + unit(a) * (LIQUIDITY_MAX - LIQUIDITY_MIN)) / 100) * 100;
  const traders = TRADERS_MIN + Math.floor(unit(b) * (TRADERS_MAX - TRADERS_MIN + 1));
  const volume24hUsdc = Math.round((liquidityUsdc * (0.16 + unit(c) * 0.5)) / 100) * 100;

  return { liquidityUsdc, traders, volume24hUsdc };
}

const USDC = 1_000_000n;

/**
 * Card-facing stats with real-liquidity precedence.
 *
 * A pool that holds stake on the contract shows what the contract holds — the demo generator may
 * never print a number next to real money. Traders and 24h turnover are *not indexed* for live
 * pools (the contract keeps stakes, not a bettor ledger and not a rolling turnover), so those come
 * back `null`/`0n` and the UI renders an em dash instead of inventing traffic.
 */
export type PoolStats = {
  liquidityUsdc: bigint;
  traders: number | null;
  volume24hUsdc: bigint;
  source: "chain" | "demo";
};

export function poolStats(pool: {
  id: bigint | string | number;
  totalNetPool?: bigint;
  source?: "chain" | "demo";
}): PoolStats {
  const onchain = pool.totalNetPool ?? 0n;
  // A manifest row carries its own demo liquidity in `totalNetPool` for the odds maths, so "stake >
  // 0" alone would promote every demo listing to an on-chain card. The row has to *be* a chain row
  // (the merge in useMarkets only sets `source: "chain"` when the contract actually holds money).
  const live = pool.source === "chain" && onchain > 0n;
  if (live) {
    return { liquidityUsdc: onchain, traders: null, volume24hUsdc: 0n, source: "chain" };
  }
  const demo = displayStatsFor(pool.id);
  return {
    liquidityUsdc: BigInt(demo.liquidityUsdc) * USDC,
    traders: demo.traders,
    volume24hUsdc: BigInt(demo.volume24hUsdc) * USDC,
    source: "demo",
  };
}

/**
 * Card-facing TOTAL LIQUIDITY in USDC base units (6dp).
 *
 * Always populated — a listing with no stake on the contract still shows the venue's presentation
 * figure, so no card reads `$0.00`. Use this for *labels only*; anything that converts a stake into
 * a payout must read `pool.totalNetPool`.
 */
export function displayLiquidityUsdc(marketId: string | number | bigint): bigint {
  return BigInt(displayStatsFor(marketId).liquidityUsdc) * USDC;
}

/** Card-facing 24h turnover in USDC base units (6dp). Same rules as `displayLiquidityUsdc`. */
export function displayVolumeUsdc(marketId: string | number | bigint): bigint {
  return BigInt(displayStatsFor(marketId).volume24hUsdc) * USDC;
}

/** Card-facing trader count, 85–320. Same rules as `displayLiquidityUsdc`. */
export function displayTraders(marketId: string | number | bigint): number {
  return displayStatsFor(marketId).traders;
}

/** Platform fee on every stake — mirrors the contract's `FEE_BPS = 400`. */
export const PLATFORM_FEE_RATE = 0.04;

/** A side's implied probability never goes past this band, so odds stay finite and sane. */
const ODDS_SHARE_FLOOR = 0.05;

/**
 * Deterministic implied share for a pool that holds no stake at all (0.18–0.82).
 *
 * An empty pool has no price of its own. Rather than render `—` or a flat 50/50 on every fresh
 * market, the share comes from the id, so the two buttons on a card are a plausible, stable pair
 * and — crucially — the percentage printed on the card and the multiple printed in its buttons are
 * derived from the same number.
 */
export function fallbackShareFor(marketId: string | number | bigint): number {
  const h = mix32(hash32(`share:${String(marketId)}`));
  return Math.round((0.18 + unit(h) * 0.64) * 1000) / 1000;
}

/** Rounded side pools for a market: the real split when funded, the id-derived split when not. */
export function poolSideShare(
  pool: { id: string | number | bigint; option0Pool: bigint; option1Pool: bigint },
  side: 0 | 1,
): number {
  const total = pool.option0Pool + pool.option1Pool;
  const share0 = total === 0n ? fallbackShareFor(pool.id) : Number(pool.option0Pool) / Number(total);
  return side === 0 ? share0 : 1 - share0;
}

/** Fair odds from an implied probability, net of the platform fee: p = 0.5 → 1.92x. */
export function feeNetOdds(prob: number): number {
  const p = Math.min(1 - ODDS_SHARE_FLOOR, Math.max(ODDS_SHARE_FLOOR, prob));
  return (1 / p) * (1 - PLATFORM_FEE_RATE);
}

/**
 * The multiple printed on a YES/NO button.
 *
 * Pari-mutuel when the pool actually holds stake (that is the number a bet would really pay); the
 * fee-net implied odds otherwise. It never returns 0, NaN or Infinity — a button without a number
 * is the one thing a market card cannot show.
 */
export function poolSideMultiplier(
  pool: { id: string | number | bigint; totalNetPool: bigint; option0Pool: bigint; option1Pool: bigint },
  side: 0 | 1,
): number {
  const sidePool = side === 0 ? pool.option0Pool : pool.option1Pool;
  const ratio = sidePool > 0n ? Number(pool.totalNetPool) / Number(sidePool) : 0;
  if (Number.isFinite(ratio) && ratio > 0) return ratio;
  return feeNetOdds(poolSideShare(pool, side));
}
