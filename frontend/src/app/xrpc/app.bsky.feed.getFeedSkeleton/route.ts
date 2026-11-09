import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Custom feed skeleton for the "Prediction Markets" feed.
 *
 * Bluesky resolves a feed URI's DID to a service, then GETs this path. The DID here is
 * `did:web:predictionarena.online` (see public/.well-known/did.json), so AppView calls us directly
 * rather than bsky.social — no PDS involvement in serving the feed.
 *
 * Ordered URIs only. AppView hydrates each one through its own index, which is why this route can
 * stay dumb and cache-friendly: it never touches the network, it reads a file that
 * `scripts/bsky-feed-refresh.ts` rewrites on a cron.
 */

const FEED_DID = "did:web:predictionarena.online";
/** The publisher: the account whose repo holds the feed record. AppView sends this URI, not the
 * service DID, so validating only `FEED_DID` rejected every real request as UnknownFeed. */
const PUBLISHER_DID = "did:plc:hn527g3nbpxkgs4c4xbwnq2y";
const PAGE = 30;

type Skeleton = {
  updatedAt: string;
  posts: { uri: string; cid: string }[];
};

function fail(error: string, status = 400) {
  return NextResponse.json({ error, message: error }, { status });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const feed = url.searchParams.get("feed") ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || PAGE, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("cursor")) || 0, 0);

  const isOurs =
    feed.startsWith(`at://${PUBLISHER_DID}/app.bsky.feed.generator/`) ||
    feed.startsWith(`at://${FEED_DID}/app.bsky.feed.generator/`);
  if (!isOurs) {
    return fail("UnknownFeed");
  }

  let data: Skeleton;
  try {
    data = JSON.parse(readFileSync(join(process.cwd(), "public", "feed-skeleton.json"), "utf8"));
  } catch {
    // An unreadable skeleton is a bug on our side, not the client's — say so instead of 400.
    return fail("InternalServerError", 500);
  }

  const slice = data.posts.slice(offset, offset + limit);
  if (slice.length === 0) return NextResponse.json({ feed: [] });

  const next = offset + slice.length;
  const body: { feed: { post: string }[]; cursor?: string } = {
    feed: slice.map((p) => ({ post: p.uri })),
  };
  if (next < data.posts.length) body.cursor = String(next);

  return NextResponse.json(body, {
    headers: {
      // Bluesky's AppView caches aggressively; a short TTL keeps the feed fresh without hammering us.
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export const dynamic = "force-dynamic";
