import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The board manifest, served at runtime instead of build time.
 *
 * `/pools.json` is baked into the image, so every data tick used to require a rebuild and a new
 * deploy to reach the browser. This route reads the same file from the branch the ops daemon
 * commits to, caches it for 60s at the edge, and falls back to the bundled snapshot whenever the
 * upstream is unreachable — a stale board is acceptable, an empty one is not.
 *
 * Consequence: `bun run build` no longer participates in market data at all.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM =
  process.env.BOARD_SOURCE_URL ??
  "https://raw.githubusercontent.com/lulaxiao97-create/prediction-arena/main/frontend/public/pools.json";

const CACHE_HEADERS = {
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
};

type Board = { pools?: unknown[]; updatedAt?: string };

function looksLikeBoard(value: unknown): value is Board {
  const v = value as Board | null;
  return Boolean(v && Array.isArray(v.pools) && v.pools.length > 0);
}

export async function GET() {
  const minute = Math.floor(Date.now() / 60_000);

  try {
    const res = await fetch(`${UPSTREAM}?v=${minute}`, {
      // One upstream fetch per minute per instance, no matter how many tabs are open.
      next: { revalidate: 60 },
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const json: unknown = await res.json();
      if (looksLikeBoard(json)) {
        return NextResponse.json(json, {
          headers: { ...CACHE_HEADERS, "x-board-source": "origin" },
        });
      }
    }
  } catch {
    // fall through to the bundled snapshot
  }

  try {
    const raw = await readFile(path.join(process.cwd(), "public", "pools.json"), "utf8");
    const json = JSON.parse(raw) as unknown;
    if (looksLikeBoard(json)) {
      return NextResponse.json(json, {
        headers: { ...CACHE_HEADERS, "x-board-source": "bundled" },
      });
    }
  } catch {
    // nothing to serve
  }

  return NextResponse.json(
    { pools: [], error: "board unavailable" },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}
