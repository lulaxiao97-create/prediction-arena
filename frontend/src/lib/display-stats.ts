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
