/**
 * Watch-to-Earn rules — shared by the client UI and the server route.
 *
 * The point of keeping this file dependency-free is the same reason as `covers.ts`: the numbers
 * that define the economy must exist in exactly one place, so a UI badge can never advertise a
 * rate the server does not honour.
 *
 * The economy, in one paragraph: watch a 15s ad → 10 points (hard cap per UTC day); 100 points →
 * one $1 Free Ticket; a ticket places a $1 virtual position at the market's *current implied
 * probability* (so it buys `1/prob` shares, exactly like a pari-mutuel stake); a position pays out
 * only when the market actually settles. Nothing here touches USDC or the arena contract — the
 * ticket ledger is a separate, server-signed book.
 */

export const POINTS_PER_AD = 10;
export const POINTS_PER_TICKET = 100;
/** face value of one ticket, in cents */
export const TICKET_CENTS = 100;
/** realised profit required before a payout can be requested, in cents */
export const WITHDRAW_MIN_CENTS = 1000;
export const AD_SECONDS = 10;
/** anti-farm cap: the ad unit is the only way to earn, so the cap *is* the economics */
export const MAX_ADS_PER_DAY = 12;

export type TicketStake = {
  id: string;
  poolId: string;
  title: string;
  option: 0 | 1;
  /** face value spent — always TICKET_CENTS today, kept explicit for future tiers */
  cents: number;
  /** implied probability of the chosen side when the ticket was placed, basis points */
  entryBps: number;
  at: number;
};

export type CashoutRequest = {
  at: number;
  cents: number;
  status: "queued";
  /** Base address the admin transfer is prepared for; null until the user supplies one */
  to?: string | null;
};

/**
 * One line in the ledger's own history. Every mutation appends exactly one, so the panel can show
 * a flow the user can audit ("10 points in → 100 → 1 ticket → stake on #700001 → $10 reached")
 * instead of a set of numbers that appear from nowhere.
 */
export type AuditEvent = {
  at: number;
  kind: "ad" | "redeem" | "stake" | "cashout";
  /** points moved (positive = earned) */
  points?: number;
  /** tickets moved (positive = minted, negative = spent) */
  tickets?: number;
  cents?: number;
  poolId?: string;
  entryBps?: number;
  /** where an admin transfer would go, for cashout rows */
  to?: string | null;
};

export type Ledger = {
  v: 1;
  points: number;
  tickets: number;
  stakes: TicketStake[];
  /** single-use ad receipts, capped so the cookie cannot grow without bound */
  seenAds: string[];
  adsDay: string;
  adsToday: number;
  cashout?: CashoutRequest;
  /** append-only trail, capped so the cookie stays small */
  events?: AuditEvent[];
  updatedAt: number;
};

export const emptyLedger = (now = Date.now()): Ledger => ({
  v: 1,
  points: 0,
  tickets: 0,
  stakes: [],
  seenAds: [],
  adsDay: new Date(now).toISOString().slice(0, 10),
  adsToday: 0,
  updatedAt: now,
});

export type StakeView = TicketStake & {
  /** current worth in cents, at the market's live implied probability */
  markCents: number;
  state: "open" | "won" | "lost";
  /** 1/prob at entry — how many $1 shares the ticket bought */
  shares: number;
};

export type RewardsView = {
  points: number;
  tickets: number;
  /** realised profit in cents — only settled markets count */
  settledProfitCents: number;
  /** mark-to-market value of open tickets, cents */
  openValueCents: number;
  stakes: StakeView[];
  canWithdraw: boolean;
  withdrawMinCents: number;
  cashout?: CashoutRequest;
  /** newest last; the panel renders the tail */
  events: AuditEvent[];
  rates: {
    pointsPerAd: number;
    pointsPerTicket: number;
    ticketCents: number;
    adSeconds: number;
    adsLeftToday: number;
    maxAdsPerDay: number;
  };
};

export type ResolvedPool = {
  status: number;
  winningOption: number;
  /** implied YES share, 0..1 */
  yesShare: number;
};

/** dollars for display */
export const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/**
 * Value one ticket position against the market's current state.
 *
 * open  → mark to the live implied probability (this is what the asset panel shows, labelled as
 *         unrealised; it is never withdrawable);
 * won   → pays `cents / entryBps` (a $1 ticket at 25% bought 4 shares of $1);
 * lost  → zero.
 */
export function valueStake(stake: TicketStake, pool: ResolvedPool | undefined): StakeView {
  const shares = stake.entryBps > 0 ? 10_000 / stake.entryBps : 1;
  // A pool that fell off the manifest (expired and not re-listed yet) holds its face value —
  // it must never silently read as a loss just because the board stopped listing it.
  if (!pool) return { ...stake, markCents: stake.cents, state: "open", shares };
  if (pool.status === 2) {
    const won = (pool.winningOption === 0 ? 0 : 1) === stake.option;
    return { ...stake, markCents: won ? Math.round(stake.cents * shares) : 0, state: won ? "won" : "lost", shares };
  }
  if (pool.status === 3) return { ...stake, markCents: stake.cents, state: "lost", shares };
  const prob = stake.option === 0 ? pool.yesShare : 1 - pool.yesShare;
  const markCents = Math.round((stake.cents * prob) / Math.max(0.01, stake.entryBps / 10_000));
  return { ...stake, markCents, state: "open", shares };
}

export function toView(ledger: Ledger, pools: Record<string, ResolvedPool>, adsLeftToday: number): RewardsView {
  const stakes = ledger.stakes.map((s) => valueStake(s, pools[s.poolId]));
  const settledProfitCents = stakes
    .filter((s) => s.state !== "open")
    .reduce((sum, s) => sum + (s.markCents - s.cents), 0);
  const openValueCents = stakes.filter((s) => s.state === "open").reduce((sum, s) => sum + s.markCents, 0);
  return {
    points: ledger.points,
    tickets: ledger.tickets,
    settledProfitCents,
    openValueCents,
    stakes: stakes.slice(-12).reverse(),
    canWithdraw: settledProfitCents >= WITHDRAW_MIN_CENTS && !ledger.cashout,
    withdrawMinCents: WITHDRAW_MIN_CENTS,
    cashout: ledger.cashout,
    events: (ledger.events ?? []).slice(-16),
    rates: {
      pointsPerAd: POINTS_PER_AD,
      pointsPerTicket: POINTS_PER_TICKET,
      ticketCents: TICKET_CENTS,
      adSeconds: AD_SECONDS,
      adsLeftToday,
      maxAdsPerDay: MAX_ADS_PER_DAY,
    },
  };
}

export function clampInt(n: unknown, min: number, max: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}
