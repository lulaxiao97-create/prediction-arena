/**
 * Arena Points — the scoring rules, in one pure module.
 *
 * The ledger itself is *derived* (scripts/sync-points.ts replays on-chain BetPlaced events), so the
 * only thing that can drift is this file. Every consumer — the API route, the Telegram bot, the
 * marketing cards — imports these constants instead of re-typing a number.
 *
 * Why points exist at all: a venue with no token has no way to reward the people who show up early.
 * Points are the receipt for that early work. They are not a security, not a claim on revenue, and
 * not purchasable — see docs/TOKENOMICS.md for the honest version of that sentence.
 */

/** Base points per $1 of net stake. 10 keeps a $20 bet in the hundreds, which reads well. */
export const POINTS_PER_USD = 10;

/** Extreme odds pay a better multiple, so they earn more points. 1x at a dead-even market. */
export const RISK_MIN = 1;
export const RISK_MAX = 2;

/** Short-dated markets resolve sooner, so they earn a freshness bump. */
export const HORIZON_BONUS_SHORT = 1.5; // <= 2 days
export const HORIZON_BONUS_MID = 1.2; //   <= 10 days

/** A captain earns 20% of every point their referees generate. Paid in points, not USDC. */
export const REFERRAL_SHARE = 0.2;

/** Genesis allocation reserved for points (42% of a 1,000,000,000 supply). */
export const GENESIS_ALLOCATION = 420_000_000;
export const TOTAL_SUPPLY = 1_000_000_000;

export type BetForPoints = {
  /** USDC actually staked, 6dp normalised to dollars. */
  stakeUsd: number;
  /** Implied YES share of the market at scoring time (0.05–0.95). */
  yesShare: number;
  /** Hours between the bet and the pool's deadline. */
  hoursToExpiry: number;
};

/**
 * Multiplier for one bet: risk (how contrarian the side is) × freshness (how soon it resolves).
 * Both are bounded so a single whale cannot print an unbounded score.
 */
export function betMultiplier(bet: BetForPoints): number {
  const distance = Math.min(1, Math.abs(bet.yesShare - 0.5) * 2);
  const risk = RISK_MIN + (RISK_MAX - RISK_MIN) * distance;
  const horizon =
    bet.hoursToExpiry <= 48 ? HORIZON_BONUS_SHORT : bet.hoursToExpiry <= 240 ? HORIZON_BONUS_MID : 1;
  return Number((risk * horizon).toFixed(4));
}

/** Points for one bet, rounded down: fractions of a point are noise, not a ledger. */
export function pointsForBet(bet: BetForPoints): number {
  if (!Number.isFinite(bet.stakeUsd) || bet.stakeUsd <= 0) return 0;
  return Math.floor(bet.stakeUsd * POINTS_PER_USD * betMultiplier(bet));
}

/** What a referral is worth: 20% of the referee's points, floored. */
export function referralPoints(refereePoints: number): number {
  return Math.floor(Math.max(0, refereePoints) * REFERRAL_SHARE);
}

/** A wallet's projected slice of the genesis allocation, from its share of all points. */
export function estimatedArena(points: number, totalPoints: number): number {
  if (!totalPoints || totalPoints <= 0 || points <= 0) return 0;
  return Math.floor((points / totalPoints) * GENESIS_ALLOCATION);
}

/** Human-readable rule block, served by /api/points and printed by the bot. */
export const POINT_RULES = {
  perUsd: POINTS_PER_USD,
  riskRange: [RISK_MIN, RISK_MAX] as [number, number],
  horizonBonus: { short: HORIZON_BONUS_SHORT, mid: HORIZON_BONUS_MID },
  referralShare: REFERRAL_SHARE,
  genesisAllocation: GENESIS_ALLOCATION,
  totalSupply: TOTAL_SUPPLY,
};

export const POINTS_DISCLAIMER =
  "Points are a record of early participation. There is no token yet, nothing is purchasable, and no value is promised. If a genesis token launches, points convert 1:1 into it; if it never launches, points remain a scoreboard.";
