import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import {
  POINTS_PER_TICKET,
  TICKET_CENTS,
  WITHDRAW_MIN_CENTS,
  clampInt,
  emptyLedger,
  toView,
  type Ledger,
} from "@/lib/rewards";
import {
  REWARDS_COOKIE as COOKIE,
  REWARDS_MAX_AGE as MAX_AGE,
  adsLeft,
  creditAd,
  decodeLedger,
  encodeLedger,
  poolIndex,
  readPools,
  rollDay,
  signAdReceipt,
  verifyAdReceipt,
} from "@/lib/rewards-server";

/**
 * The rewards ledger API.
 *
 * One route, five actions, because every action needs the same three things: the signed cookie,
 * the shipped manifest, and the same view builder. Splitting it into five files would have
 * duplicated the cookie handling five times for no isolation benefit.
 *
 * Nothing here trusts the client for a number that matters:
 *   • points are only credited against a receipt this server signed at ad-start, ≥14s ago,
 *     unused, and under the daily cap;
 *   • a ticket's entry probability is derived from the manifest, not from the request;
 *   • a cashout is only recorded when realised profit (settled markets only) clears $10.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadLedger(): Promise<Ledger> {
  const jar = await cookies();
  return decodeLedger(jar.get(COOKIE)?.value) ?? emptyLedger();
}

async function respond(ledger: Ledger, extra: Record<string, unknown> = {}) {
  const jar = await cookies();
  const next = rollDay(ledger);
  jar.set(COOKIE, encodeLedger(next), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  const poolsFile = await readPools();
  const view = toView(next, poolIndex(poolsFile), adsLeft(next));
  return NextResponse.json({ ok: true, view, ...extra }, { headers: { "cache-control": "no-store" } });
}

export async function GET() {
  // Mint the signed ledger on first read, so the browser owns one stable book from the first
  // paint instead of getting a different empty ledger each time it asks.
  return respond(await loadLedger());
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad-json" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const ledger = await loadLedger();
  const now = Date.now();

  switch (action) {
    /* ── watch-to-earn ─────────────────────────────────────────────── */
    case "ad-start": {
      if (adsLeft(ledger, now) <= 0) {
        return NextResponse.json({ ok: false, error: "daily-cap" }, { status: 429 });
      }
      const token = signAdReceipt(crypto.randomUUID(), now);
      return NextResponse.json({ ok: true, token });
    }
    case "ad-complete": {
      const check = verifyAdReceipt(String(body.token ?? ""), now);
      if (!check.ok || !check.id) {
        return NextResponse.json({ ok: false, error: check.reason ?? "invalid-receipt" }, { status: 400 });
      }
      const next = creditAd(ledger, check.id, now);
      if (next.points === ledger.points) {
        return NextResponse.json({ ok: false, error: "already-credited" }, { status: 409 });
      }
      return respond(next, { awarded: next.points - ledger.points });
    }

    /* ── points → ticket ───────────────────────────────────────────── */
    case "redeem": {
      const affordable = Math.floor(ledger.points / POINTS_PER_TICKET);
      const count = clampInt(body.count ?? 1, 1, Math.min(20, affordable));
      if (affordable < 1) return NextResponse.json({ ok: false, error: "not-enough-points" }, { status: 400 });
      const next: Ledger = {
        ...ledger,
        points: ledger.points - count * POINTS_PER_TICKET,
        tickets: ledger.tickets + count,
        updatedAt: now,
      };
      return respond(next, { redeemed: count });
    }

    /* ── ticket → virtual position ─────────────────────────────────── */
    case "stake": {
      const poolId = String(body.poolId ?? "");
      const option = Number(body.option) === 1 ? 1 : 0;
      if (ledger.tickets < 1) return NextResponse.json({ ok: false, error: "no-tickets" }, { status: 400 });

      const poolsFile = await readPools();
      const pool = poolsFile?.pools?.find((p) => String(p.id) === poolId);
      if (!pool) return NextResponse.json({ ok: false, error: "unknown-market" }, { status: 404 });
      if ((pool.status ?? 1) !== 1) return NextResponse.json({ ok: false, error: "market-closed" }, { status: 400 });

      const yes = typeof pool.yesShare === "number" ? Math.min(0.99, Math.max(0.01, pool.yesShare)) : 0.5;
      const prob = option === 0 ? yes : 1 - yes;
      const entryBps = clampInt(Math.round(prob * 10_000), 100, 9_900);

      const next: Ledger = {
        ...ledger,
        tickets: ledger.tickets - 1,
        stakes: [
          ...ledger.stakes,
          {
            id: crypto.randomUUID().slice(0, 8),
            poolId,
            title: String(pool.title ?? `Market #${poolId}`).slice(0, 140),
            option: option as 0 | 1,
            cents: TICKET_CENTS,
            entryBps,
            at: now,
          },
        ].slice(-40),
        updatedAt: now,
      };
      return respond(next, { staked: entryBps });
    }

    /* ── payout request (only realised profit counts) ──────────────── */
    case "cashout": {
      const poolsFile = await readPools();
      const view = toView(ledger, poolIndex(poolsFile), adsLeft(ledger));
      if (view.settledProfitCents < WITHDRAW_MIN_CENTS) {
        return NextResponse.json({ ok: false, error: "below-threshold" }, { status: 400 });
      }
      if (ledger.cashout) return NextResponse.json({ ok: false, error: "already-requested" }, { status: 409 });
      const next: Ledger = {
        ...ledger,
        cashout: { at: now, cents: view.settledProfitCents, status: "queued" },
        updatedAt: now,
      };
      return respond(next, { requestedCents: view.settledProfitCents });
    }

    default:
      return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 });
  }
}
