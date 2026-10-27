import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The board manifest, served at runtime instead of build time.
 *
 * `/pools.json` is baked into the image, so every data tick used to require a rebuild and a new
 * deploy to reach the browser. This route reads the same file from the branch the ops daemon
 * commits to, caches it for 60s at the edge, and falls back to the bundled snapshot whenever the
 * upstream is slow or unreachable — a stale board is acceptable, an empty one is not, and a
 * hanging upstream must never hold a visitor's request open.
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

/** Upstream budget. A data file is small; anything slower than this is treated as down. */
const UPSTREAM_TIMEOUT_MS = 4_000;
/** Serve the in-process copy without touching the network inside this window. */
const MEMO_MS = 60_000;
/** Past this age the in-process copy is still served, but only as an explicit `stale`. */
const STALE_MS = 15 * 60_000;

type Board = { pools?: unknown[]; updatedAt?: string };

function looksLikeBoard(value: unknown): value is Board {
  const v = value as Board | null;
  return Boolean(v && Array.isArray(v.pools) && v.pools.length > 0);
}

let memo: { board: Board; at: number } | null = null;

async function fromUpstream(minute: number): Promise<Board | null> {
  try {
    const res = await fetch(`${UPSTREAM}?v=${minute}`, {
      next: { revalidate: 60 },
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return looksLikeBoard(json) ? json : null;
  } catch {
    return null;
  }
}

async function fromBundle(): Promise<Board | null> {
  try {
    const raw = await readFile(path.join(process.cwd(), "public", "pools.json"), "utf8");
    const json = JSON.parse(raw) as unknown;
    return looksLikeBoard(json) ? json : null;
  } catch {
    return null;
  }
}

function serve(board: Board, source: string) {
  return NextResponse.json(board, { headers: { ...CACHE_HEADERS, "x-board-source": source } });
}

export async function GET() {
  const now = Date.now();

  if (memo && now - memo.at < MEMO_MS) return serve(memo.board, "memo");

  const fresh = await fromUpstream(Math.floor(now / MEMO_MS));
  if (fresh) {
    memo = { board: fresh, at: now };
    return serve(fresh, "origin");
  }

  if (memo && now - memo.at < STALE_MS) return serve(memo.board, "stale");

  const bundled = await fromBundle();
  if (bundled) {
    memo = { board: bundled, at: now };
    return serve(bundled, "bundled");
  }

  return NextResponse.json(
    { pools: [], error: "board unavailable" },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}
