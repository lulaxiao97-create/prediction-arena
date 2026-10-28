import { expect, test } from "@playwright/test";

/**
 * Farcaster Frame + referral capture.
 *
 * The frame tags are invisible in a browser, so nothing about them fails loudly when a refactor
 * drops `other:` from the metadata: the page still renders, the share card still works, and the
 * market simply stops existing inside Warpcast. These assertions are the only guard.
 */
test("market page exposes Farcaster Frame tags with attributed buttons", async ({ page }) => {
  await page.goto("/market/700001", { waitUntil: "domcontentloaded" });
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
  const res = await request.get("/api/frame?id=700001");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/html");

  const body = await res.text();
  expect(body).toContain('name="fc:frame" content="vNext"');
  expect(body).toContain("/market/700001/opengraph-image");
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
  await page.goto("/market/700001", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.localStorage.getItem("pa.ref"))).toContain(wallet);
});

test("a garbage ref is ignored rather than stored", async ({ page, context }) => {
  await page.goto("/?ref=%3Cscript%3Ealert(1)%3C%2Fscript%3E", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const cookie = (await context.cookies()).find((c) => c.name === "pa_ref");
  expect(cookie).toBeFalsy();
});
