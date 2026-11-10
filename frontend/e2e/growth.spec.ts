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

  // both offers. The second card used to sell "100 points = a $1 trial ticket"; the points system
  // was withdrawn on 2026-11-10 (the ad venue never onboarded, so nothing funded the ledger) and the
  // card now sells the free pick. Assert the replacement AND the absence of the withdrawn claim —
  // a copy edit that quietly brings the ticket back is the regression this pins.
  await expect(strip.getByText("Launch special: your fee is escrowed, not spent")).toBeVisible();
  await expect(strip.getByText("Say yes or no — one tap, no money")).toBeVisible();
  await expect(strip.getByText(/trial ticket|Arena Points|points/i)).toHaveCount(0);

  // the three objections
  await expect(strip.getByText("Audited v3 contract")).toBeVisible();
  await expect(strip.getByText("Non-custodial")).toBeVisible();
  await expect(strip.getByText("Instant USDC settlement")).toBeVisible();
});

test("hot-trends rail lists real markets with numbers", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const rail = page.getByLabel("Trending markets");
  await expect(rail).toBeVisible();

  // A line carries the side's share and the deadline — both facts. It used to carry "N traders ·
  // $X liquidity · M× on YES", where every number came from displayStatsFor()'s hash. Those are gone
  // from the rail, so this asserts the real line and the absence of the invented one.
  const line = rail.getByText(/YES \d+% · settles in/).first();
  await expect(line).toBeVisible();
  await expect(rail.getByText(/traders · \$/)).toHaveCount(0);
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


/**
 * The free pick has to be a real count, not a rendering.
 *
 * /api/guess is the only number on the landing page that a visitor produces, and the whole point of
 * adding it was to stop showing an aggregate that nothing measured. These assertions pin the three
 * things that make it honest: it starts at zero, a tap moves it by exactly one, and the same client
 * tapping twice does not move it again.
 */
test("a wallet-less pick is counted server-side, once per client", async ({ request }) => {
  // A synthetic id: the counter does not require the market to exist, and using a real id would make
  // the assertions depend on other tests' traffic.
  const id = String(9_000_000_000 + Math.floor(Math.random() * 89_999));
  const read = async () => (await (await request.get(`/api/guess?id=${id}`)).json()) as { total: number; yes: number; no: number };

  expect((await read()).total).toBe(0);

  const first = await request.post("/api/guess", { data: { id, side: "yes" } });
  expect(first.ok()).toBeTruthy();
  const afterFirst = (await first.json()) as { total: number; yes: number; duplicate?: boolean };
  expect(afterFirst.duplicate).toBeUndefined();
  expect(afterFirst.total).toBe(1);
  expect(afterFirst.yes).toBe(1);

  const second = await request.post("/api/guess", { data: { id, side: "no" } });
  const afterSecond = (await second.json()) as { total: number; duplicate?: boolean };
  expect(afterSecond.duplicate).toBe(true);
  expect(afterSecond.total).toBe(1);

  expect((await read()).total).toBe(1);
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

test("market share metadata leads with the payout multiple", async ({ page, request }) => {
  // Ids are hashed from the title, so resolve one from the shipped manifest instead of pinning a
  // positional id that stopped existing when the board went past 38 markets.
  const board = await request.get("/pools.json");
  const body = (await board.json()) as { pools?: { id: string | number; status?: number }[] };
  const id = String((body.pools ?? []).find((p) => (p.status ?? 1) === 1)?.id ?? "");
  expect(id).not.toBe("");
  await page.goto(`/market/${id}`, { waitUntil: "domcontentloaded" });
  const html = await page.content();
  // The preview used to claim a crowd size (`pool.traders`, generated as 40 + p·260). It now names
  // the settlement date, which the manifest actually carries.
  expect(html).toMatch(/\d+% YES · pays \d+\.\d× · settles \d{4}-\d{2}-\d{2}/);
  expect(html).not.toMatch(/\d+ traders/);
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
