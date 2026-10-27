import { expect, test } from "@playwright/test";
import { TEST_ACCOUNT, installMockWallet, mockBaseRpc } from "./mock-wallet";

/**
 * Smoke coverage for the two things that broke once already:
 *   1. a YES/NO button that renders without its multiplier;
 *   2. a submit path that disables itself instead of letting the wallet answer.
 *
 * Both are asserted on the real production build, so a regression fails CI instead of reaching the
 * board.
 */
let rpc: import("./mock-wallet").RpcStats;

test.beforeEach(async ({ page }) => {
  await installMockWallet(page);
  // If any of these requests escape to the real network the flow stalls on a receipt that will
  // never exist, so the stats are asserted after the walk.
  rpc = await mockBaseRpc(page);
});

/**
 * Connect the mocked wallet.
 *
 * RainbowKit auto-reconnects the last injected connector, so the flow has to tolerate three states:
 * already connected, modal showing our EIP-6963 provider, and modal showing a generic injected entry.
 */
async function connect(page: import("@playwright/test").Page) {
  // RainbowKit keeps a hidden "Connect Wallet" button in the DOM, auto-reconnects previously seen
  // injected connectors, and animates its modal — so every interaction here is marked visible-only
  // and bounded, and the whole handshake is retried rather than allowed to stall on one click.
  const chip = page.locator("text=/0x[0-9a-f]{2,4}\\s*…/i").first();
  const connected = async () => chip.isVisible({ timeout: 3_000 }).catch(() => false);

  if (await connected()) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const cta = page.locator("button:visible", { hasText: /connect (a )?wallet/i }).first();
    await cta.click({ timeout: 8_000 }).catch(() => {});

    const named = page.locator("text=/mock wallet/i").first();
    await named.click({ timeout: 8_000 }).catch(() => {});

    if (await connected()) return;

    const injected = page.locator("text=/browser wallet|injected/i").first();
    await injected.click({ timeout: 4_000 }).catch(() => {});

    if (await connected()) return;

    await page.reload({ waitUntil: "domcontentloaded" });
  }

  await expect(chip).toBeVisible({ timeout: 15_000 });
}

test("board renders every market with a multiplier on both buttons", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const cards = page.locator("article, [data-market-card]").filter({ has: page.getByRole("heading") });
  await expect.poll(async () => cards.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(30);

  const prices = page.locator("button").filter({ hasText: /(yes|no).*\d+\.\d+x/i });
  expect(await prices.count()).toBeGreaterThanOrEqual(60);

  // every quick-trade button carries a multiple, none renders a bare "—"
  const labels = await prices.allInnerTexts();
  for (const label of labels) {
    expect(label).toMatch(/\d+\.\d{2}x/i);
  }

  // the empty-state text the old build could leak
  await expect(page.getByText(/deposit usdc on base first/i)).toHaveCount(0);
});

test("a zero-balance wallet can open the drawer and walk the three stages", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await connect(page);

  // First market's YES button. A cold runner can paint the grid before hydration, so a click that
  // lands early does nothing — click until the drawer is actually on screen.
  const yes = page.locator("button").filter({ hasText: /yes.*\d+\.\d+x/i }).first();
  const dialog = page.getByRole("dialog");
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt += 1) {
    await yes.click({ timeout: 10_000 }).catch(() => {});
    opened = await dialog.isVisible({ timeout: 6_000 }).catch(() => false);
  }
  await expect(dialog).toBeVisible();

  const submit = dialog.getByRole("button", { name: /place prediction|place bet|confirm/i }).last();
  await expect(submit).toBeVisible();
  await expect(submit).toBeEnabled(); // zero balance must not disable it
  await expect(page.getByText(/deposit usdc on base first/i)).toHaveCount(0);

  // A cold CI runner can paint the drawer a beat before React attaches the submit handler, so a
  // click that lands pre-hydration does nothing. Click until the rail actually starts, bounded.
  let started = false;
  for (let attempt = 0; attempt < 3 && !started; attempt += 1) {
    await submit.click({ timeout: 10_000 }).catch(() => {});
    started = await dialog
      .getByText(/approving usdc/i)
      .first()
      .isVisible({ timeout: 8_000 })
      .catch(() => false);
  }
  expect(started, "submit must start the approve stage").toBeTruthy();

  // Stage 1 → 2 → 3 of TxProgress, in order.
  await expect(dialog.getByText(/approving usdc/i).first()).toBeVisible({ timeout: 30_000 });

  // Everything below rides on the stubbed receipt; assert the stub was actually used so a transport
  // that escapes to the real chain fails with a readable histogram instead of a bare timeout.
  await expect
    .poll(() => rpc.byMethod.eth_getTransactionReceipt ?? 0, {
      timeout: 60_000,
      message: `receipt polling never hit the stub — got ${JSON.stringify(rpc.byMethod)}`,
    })
    .toBeGreaterThan(0);

  await expect(dialog.getByText(/signing bet transaction|signing/i).first()).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByText(/confirmed/i).first()).toBeVisible({ timeout: 60_000 });
});

test("admin console is gated: foreign wallet sees the allowlist notice, API rejects unsigned calls", async ({
  page,
  request,
}) => {
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /operations console/i })).toBeVisible();

  await connect(page);
  await expect(page.getByText(/not on the operator allowlist/i)).toBeVisible({ timeout: 20_000 });

  const res = await request.get(
    `/api/admin/metrics?address=${TEST_ACCOUNT}&ts=${Date.now()}&sig=0x${"11".repeat(65)}`
  );
  expect([401, 403]).toContain(res.status());
});

test("board api serves the runtime manifest with a 60s cache header", async ({ request }) => {
  const res = await request.get("/api/board");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { pools?: unknown[] };
  expect(Array.isArray(body.pools)).toBeTruthy();
  expect((body.pools ?? []).length).toBeGreaterThan(10);
  expect(res.headers()["cache-control"] ?? "").toContain("s-maxage=60");
});
