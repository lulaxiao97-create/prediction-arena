/**
 * Server side of the rewards ledger.
 *
 * There is no database on this deployment, so the ledger lives in an **httpOnly, HMAC-signed
 * cookie**: the client can read the UI state through /api/rewards but cannot mint points, because
 * every mutation is re-signed here and an edited payload fails verification. That is the honest
 * boundary of this design — it stops forgery, it does not stop one person watching twelve ads a
 * day on three browsers, which is the same exposure any rewarded-ad unit has.
 *
 * A `REWARDS_SECRET` env var makes the signature unique to this deployment; without it the
 * fallback below is used so a fresh clone still works. Rotating the secret invalidates every
 * outstanding ledger (points reset), which is the intended "reset the season" lever.
 */
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  AD_SECONDS,
  MAX_ADS_PER_DAY,
  POINTS_PER_AD,
  type Ledger,
  type ResolvedPool,
  clampInt,
  emptyLedger,
} from "@/lib/rewards";

const SECRET = process.env.REWARDS_SECRET || "prediction-arena-rewards-v1-fallback-secret";
export const COOKIE = "pa_rewards";
const MAX_AGE = 60 * 60 * 24 * 90; // 90 days

const sign = (payload: string) => crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");

export function encodeLedger(ledger: Ledger): string {
  const payload = Buffer.from(JSON.stringify(ledger)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeLedger(raw: string | undefined): Ledger | null {
  if (!raw || !raw.includes(".")) return null;
  const [payload, mac] = raw.split(".");
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Ledger;
    if (parsed?.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** ad receipts are short-lived (2 minutes) and single-use */
export function signAdReceipt(id: string, startedAt: number): string {
  const payload = Buffer.from(JSON.stringify({ id, startedAt, kind: "ad" })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyAdReceipt(token: string, now = Date.now()): { ok: boolean; id?: string; reason?: string } {
  const [payload, mac] = String(token).split(".");
  if (!payload || !mac) return { ok: false, reason: "malformed" };
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad-signature" };
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { id?: string; startedAt?: number; kind?: string };
    if (data.kind !== "ad" || !data.id || !data.startedAt) return { ok: false, reason: "malformed" };
    if (now - data.startedAt < (AD_SECONDS - 1) * 1000) return { ok: false, reason: "too-fast" };
    if (now - data.startedAt > 120_000) return { ok: false, reason: "expired" };
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export type PoolsFile = {
  pools?: {
    id: string;
    title: string;
    status?: number;
    winningOption?: number;
    yesShare?: number;
    option0Pool?: string | null;
    option1Pool?: string | null;
    totalNetPool?: string | null;
  }[];
};

/** Read the shipped manifest at request time: the route runs on Node, so this is one file read. */
export async function readPools(): Promise<PoolsFile | null> {
  try {
    const raw = await readFile(path.join(process.cwd(), "public", "pools.json"), "utf8");
    return JSON.parse(raw) as PoolsFile;
  } catch {
    return null;
  }
}

export function impliedYes(pool: NonNullable<PoolsFile["pools"]>[number]): number {
  if (typeof pool.yesShare === "number") return Math.min(0.99, Math.max(0.01, pool.yesShare));
  const a = Number(pool.option0Pool ?? 0);
  const b = Number(pool.option1Pool ?? 0);
  if (!a && !b) return 0.5;
  return Math.min(0.99, Math.max(0.01, a / (a + b)));
}

export function poolIndex(file: PoolsFile | null): Record<string, ResolvedPool> {
  const out: Record<string, ResolvedPool> = {};
  for (const p of file?.pools ?? []) {
    out[String(p.id)] = { status: p.status ?? 1, winningOption: p.winningOption ?? 0, yesShare: impliedYes(p) };
  }
  return out;
}

/** UTC day string — the ad cap resets at 00:00 UTC, not on a rolling 24h window. */
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export function rollDay(ledger: Ledger, now = Date.now()): Ledger {
  const day = utcDay(now);
  if (ledger.adsDay === day) return ledger;
  return { ...ledger, adsDay: day, adsToday: 0 };
}

export function adsLeft(ledger: Ledger, now = Date.now()): number {
  const rolled = rollDay(ledger, now);
  return Math.max(0, MAX_ADS_PER_DAY - rolled.adsToday);
}

export function creditAd(ledger: Ledger, receiptId: string, now = Date.now()): Ledger {
  const rolled = rollDay(ledger, now);
  if (rolled.seenAds.includes(receiptId)) return rolled;
  const seenAds = [...rolled.seenAds, receiptId].slice(-60);
  return {
    ...rolled,
    points: clampInt(rolled.points + POINTS_PER_AD, 0, 100_000),
    adsToday: clampInt(rolled.adsToday + 1, 0, MAX_ADS_PER_DAY),
    seenAds,
    updatedAt: now,
  };
}

export { COOKIE as REWARDS_COOKIE, MAX_AGE as REWARDS_MAX_AGE, emptyLedger };
