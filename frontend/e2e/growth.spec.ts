import { expect, test } from "@playwright/test";

/**
 * Growth surface — the promo strip, the trust hooks, the hot-trends rail and the attribution the
 * share intent carries.
 *
 * These are asserted for the same reason the social links are: they are hand-written copy that a
 * refactor can silently drop. A landing page that loses its trust chips still renders, still
 * passes the trading tests, and still converts worse — which is exactly the kind of regression a
 * test has to catch, because nothing throws.
 */
test("landing page carries the growth strip and the trust hooks", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const strip = page.getByLabel("Launch offers");
  await expect(strip).toBeVisible();

  // both offers
  await expect(strip.getByText("Launch special: your fee is escrowed, not spent")).toBeVisible();
  await expect(strip.getByText("100 points = a $1 trial ticket")).toBeVisible();

  // the three objections
  await expect(strip.getByText("Audited v3 contract")).toBeVisible();
  await expect(strip.getByText("Non-custodial")).toBeVisible();
  await expect(strip.getByText("Instant USDC settlement")).toBeVisible();
});

test("hot-trends rail lists real markets with numbers", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const rail = page.getByLabel("Trending markets");
  await expect(rail).toBeVisible();

  // at least one line names a trader count and a payout multiple, i.e. the manifest reached it
  const line = rail.getByText(/traders · \$[\d.,]+[KM]? liquidity · [\d.]+× on YES/).first();
  await expect(line).toBeVisible();
});

test("market share intent carries per-market attribution", async ({ page, request }) => {
  const board = await request.get("/api/board");
  const body = (await board.json()) as { pools?: { id: string | number }[] };
  const id = body.pools?.[0]?.id;
  test.skip(id === undefined, "board manifest unavailable");

  await page.goto(`/market/${id}`, { waitUntil: "domcontentloaded" });
  // The anchor only becomes the intent after mount (see ShareActions). The pre-mount fallback is
  // now a *tracked* market link (it carries utm_* and the sharer's ref), so polling for
  // "utm_source" resolves too early — wait for the intent itself instead.
  const link = page.getByRole("link", { name: "Share to X" }).first();
  await expect(link).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(async () => decodeURIComponent((await link.getAttribute("href")) ?? ""), { timeout: 15_000 })
    .toContain("x.com/intent/tweet");

  const href = decodeURIComponent((await link.getAttribute("href")) ?? "");
  expect(href).toContain("utm_campaign=market_share");
  expect(href).toContain(`utm_content=${id}`);
  // Who gets credited: a connected wallet shares its own address (the contract pays an address,
  // so `ref=x` would earn the sharer nothing); an anonymous visitor keeps the channel tag. The
  // suite injects a wallet in some runs, so both are correct here — what is not correct is a
  // link with no ref at all.
  expect(href).toMatch(/ref=(x|0x[0-9a-fA-F]{40})/);
  expect(href).toContain("x.com/intent/tweet");
});


test("growth attribution endpoint answers with a JSON contract", async ({ request }) => {
  const res = await request.get("/api/growth/summary?chunks=1");
  // 200 when the public Base RPC allows the scan, 503 when it throttles. Both are the contract:
  // never an HTML error page, never a crash — the admin panel renders the message.
  expect([200, 503]).toContain(res.status());
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = (await res.json()) as { ok: boolean; totals?: unknown; channels?: unknown; error?: string };
  expect(typeof body.ok).toBe("boolean");
  if (body.ok) {
    expect(body.totals).toBeTruthy();
    expect(body.channels).toBeTruthy();
  } else {
    expect(typeof body.error).toBe("string");
  }
});

test("market share metadata leads with the payout multiple", async ({ page }) => {
  await page.goto("/market/700001", { waitUntil: "domcontentloaded" });
  const html = await page.content();
  expect(html).toMatch(/\d+% YES · pays \d+\.\d× · \d+ traders/);
});

/**
 * The rakeback banner.
 *
 * It is the only permanent surface that promises a payout, so it is also the one most likely to
 * rot: a copy edit can drop the "30% of the 4% rake" qualifier and leave a claim ("earn 30%")
 * that reads like a return guarantee. These assertions pin both the promise and its scope.
 */
test("the rakeback banner is permanent, qualified, and opens the portfolio", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const banner = page.getByRole("region", { name: "Rakeback" });
  await expect(banner).toBeVisible();
  await expect(banner.getByText("Earn 30% Rakeback")).toBeVisible();
  await expect(banner.getByText("Share your referral link from Portfolio", { exact: false })).toBeVisible();
  // the qualifier is what makes the claim honest — 30% *of the 4% rake*, paid by the contract
  await expect(banner.getByText("30% of the 4% rake", { exact: false })).toBeVisible();

  await banner.getByRole("button", { name: "Open Portfolio" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
