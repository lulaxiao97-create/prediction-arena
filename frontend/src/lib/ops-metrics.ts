/**
 * Ops metrics sink.
 *
 * The admin dashboard needs numbers the app never persisted: how often an ad auction filled, how
 * many cashouts were requested and by whom. There is no database in this deployment on purpose
 * (the board is a file, the ledger is a signed cookie), so these are kept in a module-level ring
 * buffer inside the running server process.
 *
 * Honest limits, and they are printed on the dashboard:
 *   • the buffer resets when the instance restarts or a deploy rolls the container;
 *   • it is per-instance, so a multi-instance host would show partial counts.
 *
 * That is enough to answer "is demand coming back?" and "who is waiting on a transfer today?"
 * without inventing a storage tier or a second credential.
 */

export type AdAttempt = { ts: number; filled: boolean; status: number; surface: string };
export type Grant = { ts: number; kind: "ad" | "redeem" | "stake" | "cashout"; points: number; note?: string };
export type Cashout = { ts: number; address: string; amountCents: number; status: "pending" | "sent"; ref: string };

const MAX_ROWS = 400;
const bootedAt = Date.now();

const state = {
  ads: [] as AdAttempt[],
  grants: [] as Grant[],
  cashouts: [] as Cashout[],
  adsTotals: { attempts: 0, filled: 0, empty204: 0 },
};

function push<T>(bucket: T[], row: T) {
  bucket.unshift(row);
  if (bucket.length > MAX_ROWS) bucket.length = MAX_ROWS;
}

export function recordAdAttempt(row: AdAttempt) {
  state.adsTotals.attempts += 1;
  if (row.filled) state.adsTotals.filled += 1;
  else if (row.status === 204) state.adsTotals.empty204 += 1;
  push(state.ads, row);
}

export function recordGrant(row: Grant) {
  push(state.grants, row);
}

export function recordCashout(row: Cashout) {
  push(state.cashouts, row);
}

export function markCashoutSent(ref: string) {
  const row = state.cashouts.find((c) => c.ref === ref);
  if (row) row.status = "sent";
  return Boolean(row);
}

export type OpsSnapshot = {
  bootedAt: number;
  uptimeSec: number;
  ads: { attempts: number; filled: number; empty204: number; fillRate: number; recent: AdAttempt[] };
  grants: { count: number; points: number; recent: Grant[] };
  cashouts: { count: number; pending: number; pendingCents: number; recent: Cashout[] };
};

export function opsSnapshot(): OpsSnapshot {
  const pending = state.cashouts.filter((c) => c.status === "pending");
  return {
    bootedAt,
    uptimeSec: Math.floor((Date.now() - bootedAt) / 1000),
    ads: {
      ...state.adsTotals,
      fillRate: state.adsTotals.attempts ? state.adsTotals.filled / state.adsTotals.attempts : 0,
      recent: state.ads.slice(0, 40),
    },
    grants: {
      count: state.grants.length,
      points: state.grants.reduce((sum, g) => sum + g.points, 0),
      recent: state.grants.slice(0, 60),
    },
    cashouts: {
      count: state.cashouts.length,
      pending: pending.length,
      pendingCents: pending.reduce((sum, c) => sum + c.amountCents, 0),
      recent: state.cashouts.slice(0, 60),
    },
  };
}
