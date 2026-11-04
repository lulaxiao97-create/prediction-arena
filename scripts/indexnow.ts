#!/usr/bin/env bun
/**
 * IndexNow submission — tells Bing (and Yandex/Seznam/Naver) the moment a page exists.
 *
 *   bun scripts/indexnow.ts                    # submit everything (first run / after a board rewrite)
 *   bun scripts/indexnow.ts --changed-only     # only markets whose endTimeUtc is in the future
 *   bun scripts/indexnow.ts --dry              # print the payload, send nothing
 *
 * Why this and not "just wait for the crawler": the board creates new markets every
 * 10–30 minutes and settles old ones. A crawler that visits weekly sees a site that is
 * 90% stale. IndexNow is free, needs no account, and the key file is served from
 * `frontend/public/<key>.txt`.
 *
 * Google does not consume IndexNow; its discovery path is the sitemap plus Search
 * Console (which needs the owner's login). This script covers the rest.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://predictionarena.online").replace(/\/+$/, "");
const HOST = new URL(SITE).host;
const KEY = process.env.INDEXNOW_KEY ?? readFileSync(path.join(ROOT, "frontend/public/indexnow-key.txt"), "utf8").trim();
const ENDPOINT = "https://api.indexnow.org/indexnow";
const args = new Set(process.argv.slice(2));

type Pool = { id: string; endTimeUtc?: string };
const manifest = JSON.parse(readFileSync(path.join(ROOT, "frontend/public/pools.json"), "utf8")) as { pools?: Pool[] };
const now = Date.now();

const statics = ["/", "/markets", "/docs", "/whitepaper", "/credits"].map((p) => `${SITE}${p}`);
const markets = (manifest.pools ?? [])
  .filter((p) => p?.id)
  .filter((p) => {
    if (!args.has("--changed-only")) return true;
    const end = p.endTimeUtc ? Date.parse(p.endTimeUtc) : NaN;
    // Future or unsettled markets are the ones a crawl budget should be spent on.
    return Number.isNaN(end) || end > now;
  })
  .map((p) => `${SITE}/market/${p.id}`);

const urls = [...statics, ...markets];

// The protocol caps a batch at 10,000 URLs; we batch at 500 to keep each request small.
const batches: string[][] = [];
for (let i = 0; i < urls.length; i += 500) batches.push(urls.slice(i, i + 500));

console.log(`[indexnow] host=${HOST} urls=${urls.length} batches=${batches.length} key=${KEY.slice(0, 6)}…`);

async function send(batch: string[]): Promise<void> {
  const body = { host: HOST, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: batch };
  if (args.has("--dry")) {
    console.log(JSON.stringify(body).slice(0, 300) + "…");
    return;
  }
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  // 200 = accepted, 202 = accepted/pending key validation, 4xx = key or host mismatch.
  console.log(`[indexnow] ${res.status} ${res.statusText} (${batch.length} urls)`);
  if (!res.ok && res.status !== 202) {
    console.error(await res.text().catch(() => ""));
    process.exitCode = 1;
  }
}

for (const b of batches) await send(b);
