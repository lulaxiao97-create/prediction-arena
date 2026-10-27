import { NextResponse, type NextRequest } from "next/server";
import { checkAdmin } from "@/lib/admin-auth";
import { markCashoutSent, opsSnapshot } from "@/lib/ops-metrics";

/**
 * Admin telemetry. Read-only apart from marking a cashout as paid, which only flips a label in the
 * in-memory buffer — the actual USDC transfer happens in the admin's wallet.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const who = await checkAdmin(q.get("address"), q.get("ts"), q.get("sig"));
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });

  return NextResponse.json(
    { ...opsSnapshot(), admin: who.address },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  let body: { address?: string; ts?: string; sig?: string; ref?: string } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const who = await checkAdmin(body?.address, body?.ts, body?.sig);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  if (!body?.ref) return NextResponse.json({ error: "ref required" }, { status: 400 });

  const marked = markCashoutSent(body.ref);
  return NextResponse.json({ ok: marked }, { headers: { "cache-control": "no-store" } });
}
