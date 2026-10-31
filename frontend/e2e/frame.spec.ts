import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

/**
 * Market ids are hashed from the market's title (scripts/gen-board.ts), so a hardcoded id is a
 * test that breaks the moment the board rebuilds — it used to point at "market 700001", which was
 * a positional id from the 38-market board. Resolve a live id from the shipped manifest instead.
 */
async function liveMarketIds(request: APIRequestContext, n = 2): Promise<string[]> {
  const res = await request.get("/pools.json");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { pools?: { id: string | number; status?: number }[] };
  const ids = (body.pools ?? []).filter((p) => (p.status ?? 1) === 1).map((p) => String(p.id));
  expect(ids.length).toBeGreaterThanOrEqual(n);
  return ids.slice(0, n);
}

/**
 * Farcaster Frame + referral capture.
 *
 * The frame tags are invisible in a browser, so nothing about them fails loudly when a refactor
 * drops `other:` from the metadata: the page still renders, the share card still works, and the
 * market simply stops existing inside Warpcast. These assertions are the only guard.
 */
test("market page exposes Farcaster Frame tags with attributed buttons", async ({ page, request }) => {
  const [id] = await liveMarketIds(request, 1);
  await page.goto(`/market/${id}`, { waitUntil: "domcontentloaded" });
  const html = await page.content();

  expect(html).toContain('name="fc:frame" content="vNext"');
  expect(html).toContain('name="fc:frame:image"');
  expect(html).toContain("Bet YES");
  expect(html).toContain("Bet NO");
  expect(html).toContain('name="fc:frame:post_url"');

  // every frame button has to carry attribution back to the channel
  expect(html).toContain("ref=fc");
  expect(html).toContain("utm_source=farcaster");
  // …and the launched side is pre-selected on the page it opens
  expect(html).toContain("side=yes");
});

test("/api/frame answers with a frame document", async ({ request }) => {
  const [id] = await liveMarketIds(request, 1);
  const res = await request.get(`/api/frame?id=${id}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/html");

  const body = await res.text();
  expect(body).toContain('name="fc:frame" content="vNext"');
  expect(body).toContain(`/market/${id}/opengraph-image`);
  expect(body).toContain("ref=fc");
  expect(body).toContain("fc:frame:button:1");
});

test("/api/frame rejects a request without a market", async ({ request }) => {
  const res = await request.get("/api/frame");
  expect(res.status()).toBe(400);
});

test("?ref is persisted and survives navigation", async ({ page, context }) => {
  const wallet = "0x1111111111111111111111111111111111111111";
  await page.goto(`/?ref=${wallet}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);

  // capture runs in an effect after hydration, so poll instead of assuming it beat the assertion
  await expect
    .poll(
      async () => {
        const c = (await context.cookies()).find((x) => x.name === "pa_ref");
        return c ? decodeURIComponent(c.value) : "";
      },
      { timeout: 10_000, message: "first-party ref cookie must be set" },
    )
    .toContain(wallet);

  await expect
    .poll(async () => (await page.evaluate(() => window.localStorage.getItem("pa.ref"))) ?? "", {
      timeout: 10_000,
    })
    .toContain(wallet);

  // a visitor who lands on the referral link and then browses two markets still credits the ref
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.localStorage.getItem("pa.ref"))).toContain(wallet);
});

test("a garbage ref is ignored rather than stored", async ({ page, context }) => {
  await page.goto("/?ref=%3Cscript%3Ealert(1)%3C%2Fscript%3E", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const cookie = (await context.cookies()).find((c) => c.name === "pa_ref");
  expect(cookie).toBeFalsy();
});

/**
 * Frame timing — the split between "our code" and "the network".
 *
 * The frame card is measured in a feed that scrolls past in under a second, so its budget is a
 * product requirement. `x-frame-ms` is what makes that budget checkable: end-to-end latency from a
 * client says nothing about the renderer, because most of it is TLS + Render + the client's own
 * request. A missing header passes every other test in this suite, which is why this exists.
 */
test("/api/frame reports server-side render time, cache state and a <50ms budget", async ({ request }) => {
  const [, secondId] = await liveMarketIds(request, 2);
  const first = await request.get(`/api/frame?id=${secondId}`);
  expect(first.status()).toBe(200);

  const ms = Number(first.headers()["x-frame-ms"]);
  expect(Number.isFinite(ms)).toBe(true);
  // Generous ceiling: a cold render on CI hardware is a few milliseconds; anything near this means
  // the manifest is being re-read on every request.
  expect(ms).toBeLessThan(50);
  expect(first.headers()["server-timing"]).toContain("frame;dur=");
  expect(["hit", "miss"]).toContain(first.headers()["x-frame-cache"]);

  // Second hit inside the 30s memo: the cache has to save the work, not just label itself a hit.
  const second = await request.get(`/api/frame?id=${secondId}`);
  expect(second.headers()["x-frame-cache"]).toBe("hit");
  expect(Number(second.headers()["x-frame-ms"])).toBeLessThanOrEqual(ms);
});

test("a frame 404 still carries the timing header", async ({ request }) => {
  const res = await request.get("/api/frame?id=999999999");
  expect(res.status()).toBe(404);
  expect(Number.isFinite(Number(res.headers()["x-frame-ms"]))).toBe(true);
});
