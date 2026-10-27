import { expect, test } from "@playwright/test";

/**
 * The official-channel wiring, asserted on the production build.
 *
 * A placeholder here is not cosmetic: `x.com/PredictionArena` is an unrelated account, so a link that
 * drifts back to a guessable handle sends our visitors to a stranger. These assertions pin the exact
 * URLs, the new-tab behaviour, and the absence of the bare `x.com` / `telegram.org` placeholders.
 */
const X_URL = "https://x.com/Pred_Arena";
const TG_URL = "https://t.me/prediction_arena";

test("footer and header link to the official accounts, safely", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("footer").scrollIntoViewIfNeeded();

  for (const url of [X_URL, TG_URL]) {
    const link = page.locator(`a[href="${url}"]`).first();
    await expect(link, `${url} must be mounted`).toBeVisible();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("rel", /noreferrer/);
  }

  // header carries the same channels
  expect(await page.locator(`header a[href="${X_URL}"]`).count()).toBeGreaterThan(0);
  expect(await page.locator(`header a[href="${TG_URL}"]`).count()).toBeGreaterThan(0);

  // placeholders are gone, and the impostor handle never appears
  expect(await page.locator('a[href="https://x.com"]').count()).toBe(0);
  expect(await page.locator('a[href="https://telegram.org"]').count()).toBe(0);
  expect(await page.locator('a[href*="x.com/PredictionArena"]').count()).toBe(0);

  // the footer prints the handles, not just an icon
  await expect(page.locator("footer").getByText("@Pred_Arena", { exact: false }).first()).toBeVisible();
  await expect(page.locator("footer").getByText("@prediction_arena", { exact: false }).first()).toBeVisible();
});

test("docs page names the official channels and the v3 contract", async ({ page }) => {
  await page.goto("/docs/security", { waitUntil: "domcontentloaded" });

  const body = await page.locator("body").innerText();
  expect(body).toContain("@Pred_Arena");
  expect(body).toContain("@prediction_arena");
  expect(body.toLowerCase()).toContain("0x961872d75ea6e7a2859b9b04c6c7b1c73cf510b5");
  expect(body.toLowerCase()).not.toContain("0x108d5cdc23123fa97929cf197151fb9dc29a5d93");
  expect(body.toLowerCase()).toContain("impostor");
});

test("page metadata credits the official handle", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const html = await page.content();
  expect(html).toContain('twitter:site');
  expect(html).toContain("@Pred_Arena");
  // structured data links the site to both profiles
  expect(html).toContain('"@type":"Organization"');
  expect(html).toContain("t.me/prediction_arena");
});
