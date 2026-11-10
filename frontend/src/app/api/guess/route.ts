import { NextResponse, type NextRequest } from "next/server";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Wallet-free guesses, counted for real.
 *
 * QuickGuess is the one-tap door: a visitor who will never connect a wallet can still say "I think
 * the Fed holds". Until now that pick lived in localStorage and nothing was transmitted, so the
 * page could not honestly show a crowd. This endpoint is the crowd: every tap is appended to a
 * jsonl file next to the other ops data, and the count that comes back is the number of taps that
 * actually arrived.
 *
 * What it deliberately does not claim:
 *   · it is not a unique-person count — one IP is counted once per market, which is a cheap guard
 *     against double-submits, not identity;
 *   · it does not survive a redeploy on an ephemeral host. The UI says "counted on this server",
 *     not "3,412 traders".
 *
 * The alternative — a hash-derived number like the old card stats — is the exact thing this venue
 * removed on 2026-11-09, and it is not coming back.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = process.env.GUESS_FILE ?? join(process.cwd(), "..", ".data", "guesses.jsonl");
const MEMO_MS = 60_000;
const ID_RE = /^\d{1,12}$/;

type Side = "yes" | "no";
type Row = { id: string; side: Side; at: number; ip: string };
type Counts = Record<string, { yes: number; no: number }>;

let memo: { at: number; counts: Counts } | null = null;

function readRows(): Row[] {
  try {
    return readFileSync(FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Row;
        } catch {
          return null;
        }
      })
      .filter((r): r is Row => Boolean(r && r.id && (r.side === "yes" || r.side === "no")));
  } catch {
    return [];
  }
}

function tally(rows: Row[]): Counts {
  const out: Counts = {};
  for (const row of rows) {
    const bucket = (out[row.id] ??= { yes: 0, no: 0 });
    bucket[row.side] += 1;
  }
  return out;
}

function counts(): Counts {
  const now = Date.now();
  if (memo && now - memo.at < MEMO_MS) return memo.counts;
  const next = tally(readRows());
  memo = { at: now, counts: next };
  return next;
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  return (fwd.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim();
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const all = counts();
  if (id) {
    if (!ID_RE.test(id)) {
      return NextResponse.json({ error: "bad id" }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    const row = all[id] ?? { yes: 0, no: 0 };
    return NextResponse.json(
      { id, ...row, total: row.yes + row.no },
      { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } },
    );
  }
  return NextResponse.json(
    { counts: all },
    { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}

export async function POST(req: NextRequest) {
  let body: { id?: unknown; side?: unknown };
  try {
    body = (await req.json()) as { id?: unknown; side?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "bad-body" }, { status: 400 });
  }

  const id = String(body.id ?? "");
  const side = String(body.side ?? "");
  if (!ID_RE.test(id)) return NextResponse.json({ ok: false, error: "bad-id" }, { status: 400 });
  if (side !== "yes" && side !== "no") return NextResponse.json({ ok: false, error: "bad-side" }, { status: 400 });

  // One tap per (ip, market). Not identity — a cheap guard so a reload does not inflate the number.
  const ip = clientIp(req);
  const existing = readRows();
  if (existing.some((r) => r.id === id && r.ip === ip)) {
    const row = counts()[id] ?? { yes: 0, no: 0 };
    return NextResponse.json(
      { ok: true, duplicate: true, id, ...row, total: row.yes + row.no },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const row: Row = { id, side: side as Side, at: Date.now(), ip };
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    appendFileSync(FILE, `${JSON.stringify(row)}\n`, "utf8");
  } catch (e) {
    // A read-only host is not an error the visitor should see: the pick is already saved locally.
    return NextResponse.json(
      { ok: false, error: "not-stored", detail: (e as Error).message },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  memo = null; // next read recounts
  const after = counts()[id] ?? { yes: 0, no: 0 };
  return NextResponse.json(
    { ok: true, id, ...after, total: after.yes + after.no },
    { headers: { "cache-control": "no-store" } },
  );
}
