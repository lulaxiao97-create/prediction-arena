/**
 * Warm the share cards.
 *
 * The OG route renders with satori and used to answer in ~3s with `must-revalidate`; X's card
 * crawler gives up before that, and the tweet ends up with a broken image. With the cache headers in
 * place the *first* request is the expensive one — so this script pays it at a moment when nobody is
 * waiting: after a board refresh, after a deploy, and right before a tweet is posted.
 *
 *   bun scripts/warm-og.ts                 # every open market
 *   bun scripts/warm-og.ts --market=700011 # just the one about to be posted, and report its latency
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://predictionarena.online").replace(/\/+$/, "");
const MANIFEST = join(ROOT, "frontend", "public", "pools.json");
const CONCURRENCY = Number(process.env.WARM_CONCURRENCY ?? 4);

const only = process.argv.find((a) => a.startsWith("--market="))?.split("=")[1];

const board = JSON.parse(readFileSync(MANIFEST, "utf8")) as { pools?: { id: string | number; status?: number }[] };
const ids = (board.pools ?? [])
  .filter((p) => (p.status ?? 1) === 1)
  .map((p) => String(p.id))
  .filter((id) => !only || id === only);

async function warm(id: string): Promise<{ id: string; status: number; ms: number }> {
  const url = `${SITE}/market/${id}/opengraph-image`;
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { "user-agent": "PredictionArena-Warm/1.0" } });
    await res.arrayBuffer();
    return { id, status: res.status, ms: Date.now() - started };
  } catch {
    return { id, status: 0, ms: Date.now() - started };
  }
}

const queue = [...ids];
const results: { id: string; status: number; ms: number }[] = [];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const id = queue.shift();
      if (!id) return;
      results.push(await warm(id));
    }
  }),
);

const slow = results.filter((r) => r.ms > 1500);
for (const r of results) console.log(`  ${r.status === 200 ? "✓" : "✗"} market ${r.id} ${r.ms}ms`);
console.log(
  `warm: ${results.filter((r) => r.status === 200).length}/${results.length} ok, ${slow.length} slow (>1500ms)` +
    (slow.length > 0 ? " — a card that answers slower than ~2s is the one X renders as a broken image" : ""),
);
