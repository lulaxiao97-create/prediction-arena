import { NextResponse, type NextRequest } from "next/server";
import { recordAdAttempt } from "@/lib/ops-metrics";

/**
 * Ad-auction telemetry, one row per attempted fill.
 *
 * Called by AdModal after every placement (visible mount or off-screen demand probe). Write-only
 * and value-free: it records an HTTP status and a surface label, never a wallet or a user id, so
 * it cannot become a tracking endpoint.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const b = body as { filled?: unknown; status?: unknown; surface?: unknown } | null;
  if (!b || typeof b.filled !== "boolean") {
    return NextResponse.json({ ok: false, error: "filled required" }, { status: 400 });
  }

  const status = Number.isFinite(Number(b.status)) ? Number(b.status) : b.filled ? 200 : 204;
  const surface = typeof b.surface === "string" ? b.surface.slice(0, 24) : "modal";

  recordAdAttempt({ ts: Date.now(), filled: b.filled, status, surface });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
