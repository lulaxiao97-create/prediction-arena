import { NextResponse, type NextRequest } from "next/server";
import { classifySource, record, type TelemetryEvent } from "@/lib/telemetry-store";

/**
 * Ingest endpoint for the front-end beacon. Fire-and-forget: it always answers 204 quickly, and it
 * never rejects a payload for being incomplete — a dropped event is worse than a sloppy one here.
 *
 * Real client IP comes from the proxy headers in this order, because Render sits behind its own
 * edge and the leftmost x-forwarded-for entry is the one the edge saw.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-vercel-forwarded-for") ??
    "unknown"
  );
}

/** Country/city only when the edge already told us; no GeoIP database is bundled. */
function geo(req: NextRequest): { country: string | null; city: string | null } {
  const country =
    req.headers.get("x-vercel-ip-country") ??
    req.headers.get("cf-ipcountry") ??
    req.headers.get("x-country") ??
    null;
  const city = req.headers.get("x-vercel-ip-city") ?? req.headers.get("cf-ipcity") ?? null;
  return {
    country: country && country !== "XX" ? country : null,
    city: city ? decodeURIComponent(city) : null,
  };
}

export async function POST(req: NextRequest) {
  let body: { type?: string; path?: string; ref?: string | null; wallet?: string | null; marketId?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const type = (body.type ?? "view") as TelemetryEvent["type"];
  if (!["view", "click", "wallet", "share"].includes(type)) return new NextResponse(null, { status: 204 });

  const referer = req.headers.get("referer");
  const path = (body.path ?? req.nextUrl.pathname).slice(0, 200);
  const { country, city } = geo(req);

  record({
    at: new Date().toISOString(),
    type,
    path,
    ip: clientIp(req),
    country,
    city,
    source: classifySource(path, body.ref ?? null, referer),
    ref: body.ref ?? null,
    wallet: body.wallet && /^0x[0-9a-fA-F]{40}$/.test(body.wallet) ? body.wallet : null,
    marketId: body.marketId ?? null,
    ua: (req.headers.get("user-agent") ?? "").slice(0, 180),
  });

  return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "telemetry", method: "POST a JSON event" });
}
