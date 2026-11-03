import { NextResponse, type NextRequest } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { summarise } from "@/lib/telemetry-store";

/**
 * The secret dashboard's data endpoint.
 *
 * Access is a shared key (ADMIN_DASH_KEY), not a wallet signature: this view is for the operator
 * reading numbers on a phone, and the page it feeds can do nothing — it cannot settle, pause, move
 * funds or read a private key. The wallet-signature console at /admin remains the one that builds
 * transactions.
 *
 * Everything is read straight off disk from the same files the daemons write, so the dashboard cannot
 * drift from what the bots actually did.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA = join(process.cwd(), "..", ".data");
const DOCS = join(process.cwd(), "..", "docs");
const ROOT = join(process.cwd(), "..");

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function GET(req: NextRequest) {
  const expected = process.env.ADMIN_DASH_KEY ?? "arena-ops-2026";
  const key = req.nextUrl.searchParams.get("key") ?? req.headers.get("x-admin-key") ?? "";
  if (key !== expected) {
    return NextResponse.json({ error: "bad key" }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  const traffic = summarise();

  const captains = Object.keys(readJson<{ captains?: Record<string, unknown> }>(join(DATA, "captains.json"), {}).captains ?? {}).length;
  const grants = readJson<{ address: string; points: number; reason: string; date: string }[]>(join(DOCS, "points", "grants.json"), []);
  const refs = readJson<Record<string, { ref: string; at: string }>>(join(DATA, "refs.json"), {});
  const mults = readJson<Record<string, { multiplier: number; at: string; reason: string }>>(join(DOCS, "points", "multipliers.json"), {});
  const followback = readJson<Record<string, { count: number; seeds: Record<string, number> }>>(join(DATA, "followback.json"), {});
  // growth.jsonl only exists on the operator's box: the deployed container has no .data directory.
  // An unguarded read here is what turned this endpoint into a 500 in production while it worked
  // locally, so every optional source below is read through a guard.
  const growthRaw = (() => {
    try {
      return readFileSync(join(DATA, "growth.jsonl"), "utf8");
    } catch {
      return "";
    }
  })();
  const growth = growthRaw
    .split("\n")
    .filter(Boolean)
    .slice(-48)
    .map((l) => {
      try {
        return JSON.parse(l) as { at: string; followers: number; posts: number };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as { at: string; followers: number; posts: number }[];

  const ops = readJson<{ at?: string; pools?: { id: string; title: string; status: number; endTime: number; netPoolUsdc: string }[] }>(
    join(ROOT, "logs", "ops-refresh.json"),
    {},
  );
  const nowSec = Math.floor(Date.now() / 1000);
  const pools = ops.pools ?? [];
  const board = readJson<{ pools?: { id: string | number; title: string }[] }>(join(ROOT, "frontend", "public", "pools.json"), {});
  const titles = new Map((board.pools ?? []).map((p) => [String(p.id), p.title]));

  const chiefCount: Record<string, number> = {};
  for (const r of Object.values(refs)) chiefCount[r.ref] = (chiefCount[r.ref] ?? 0) + 1;

  return NextResponse.json(
    {
      ok: true,
      at: new Date().toISOString(),
      traffic,
      telegram: {
        captains,
        bindGrants: grants.filter((g) => g.reason.startsWith("bind:")).length,
        crewGrants: grants.filter((g) => g.reason.startsWith("crew:")).length,
        boosts: Object.keys(mults).length,
        referralEdges: Object.keys(refs).length,
        topReferrers: Object.entries(chiefCount)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([wallet, chiefs]) => ({ wallet, chiefs })),
      },
      growth: {
        followers: growth.at(-1)?.followers ?? null,
        posts: growth.at(-1)?.posts ?? null,
        series: growth.slice(-24),
        followsToday: Object.values(followback).at(-1)?.count ?? 0,
      },
      pools: {
        total: pools.length,
        open: pools.filter((p) => p.status === 1 && p.endTime > nowSec).length,
        expiredUnsettled: pools
          .filter((p) => p.status === 1 && p.endTime <= nowSec)
          .map((p) => ({ id: p.id, title: titles.get(p.id) ?? p.title, hoursLate: Math.round((nowSec - p.endTime) / 3600) })),
        tvlUsdc: pools.reduce((n, p) => n + Number(p.netPoolUsdc ?? 0), 0).toFixed(2),
        heat: traffic.marketHeat.map((m) => ({ ...m, title: titles.get(m.id) ?? "" })),
      },
      notes: [
        "Telemetry is file-backed under .data/ and does not survive a deploy on an ephemeral host.",
        "Country/city only appears when the edge supplies geo headers; no GeoIP database is bundled.",
      ],
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  // Placeholder so a stray form post cannot 500; the dashboard is read-only.
  if (!existsSync(DATA)) return NextResponse.json({ ok: false }, { status: 503 });
  return NextResponse.json({ ok: true, readOnly: true });
}
