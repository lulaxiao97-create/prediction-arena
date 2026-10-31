import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import {
  GENESIS_ALLOCATION,
  POINTS_DISCLAIMER,
  POINT_RULES,
  estimatedArena,
  referralPoints,
} from "@/lib/points";
import { REWARDS_COOKIE, decodeLedger } from "@/lib/rewards-server";

/**
 * Arena Points read API.
 *
 *   GET /api/points              → the rules + the leaderboard
 *   GET /api/points?address=0x…  → that wallet's entry, its rank and its projected genesis slice
 *
 * The ledger is a file produced by scripts/sync-points.ts from on-chain BetPlaced events. Nothing
 * here computes points from a client-supplied number: the wallet address is the only input, and an
 * unknown address honestly returns zero rather than an invented score.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Holder = {
  points: number;
  fromBets: number;
  fromReferrals: number;
  bets: number;
  volumeUsd: number;
  lastBetAt: string | null;
};
type Ledger = {
  v: number;
  generatedAt: string;
  totals: { wallets: number; points: number; bets: number; volumeUsd: number };
  holders: Record<string, Holder>;
  top: { address: string; points: number }[];
};

const EMPTY: Ledger = {
  v: 1,
  generatedAt: "",
  totals: { wallets: 0, points: 0, bets: 0, volumeUsd: 0 },
  holders: {},
  top: [],
};

async function readLedger(): Promise<Ledger> {
  try {
    const file = path.join(process.cwd(), "public", "points.json");
    const parsed = JSON.parse(await readFile(file, "utf8")) as Ledger;
    if (parsed?.v !== 1) return EMPTY;
    return parsed;
  } catch {
    return EMPTY;
  }
}

/** Watch-to-earn points live in the signed cookie; they count as "social" points for the wallet. */
async function socialPoints(): Promise<number> {
  try {
    const jar = await cookies();
    const ledger = decodeLedger(jar.get(REWARDS_COOKIE)?.value);
    return ledger ? Math.max(0, Math.floor(ledger.points)) : 0;
  } catch {
    return 0;
  }
}

export async function GET(req: NextRequest) {
  const ledger = await readLedger();
  const raw = (req.nextUrl.searchParams.get("address") ?? "").toLowerCase();
  const address = /^0x[0-9a-f]{40}$/.test(raw) ? raw : null;
  const social = await socialPoints();

  const leaderboard = ledger.top.slice(0, 20).map((row, i) => ({
    rank: i + 1,
    address: `${row.address.slice(0, 6)}…${row.address.slice(-4)}`,
    points: row.points,
  }));

  if (!address) {
    return NextResponse.json({
      ok: true,
      rules: POINT_RULES,
      disclaimer: POINTS_DISCLAIMER,
      totals: ledger.totals,
      leaderboard,
      socialPoints: social,
      generatedAt: ledger.generatedAt,
    });
  }

  const mine = ledger.holders[address];
  const fromBets = mine?.points ?? 0;
  const total = fromBets + social;
  const ranked = ledger.top.findIndex((r) => r.address.toLowerCase() === address);
  return NextResponse.json({
    ok: true,
    address,
    points: total,
    fromBets,
    socialPoints: social,
    fromReferrals: mine?.fromReferrals ?? 0,
    bets: mine?.bets ?? 0,
    volumeUsd: mine?.volumeUsd ?? 0,
    rank: ranked >= 0 ? ranked + 1 : null,
    estimatedArena: estimatedArena(total, ledger.totals.points + social),
    genesisAllocation: GENESIS_ALLOCATION,
    rules: POINT_RULES,
    disclaimer: POINTS_DISCLAIMER,
    leaderboard,
    generatedAt: ledger.generatedAt,
  });
}
