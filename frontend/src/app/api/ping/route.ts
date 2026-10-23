import { NextResponse } from "next/server";

// A deliberately trivial endpoint: one JSON object, no data access, no chain call.
// Its whole job is to be cheap enough to hit on a timer, so the host's worker stays
// warm between real visits (Render's free plan spins down after ~15 minutes idle).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return NextResponse.json(
    { ok: true, service: "prediction-arena", ts: Date.now() },
    { headers: { "cache-control": "no-store, max-age=0" } }
  );
}
