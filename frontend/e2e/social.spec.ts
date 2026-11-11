import { expect, test } from "@playwright/test";

/**
 * The official-channel wiring, asserted on the production build.
 *
 * A placeholder here is not cosmetic: `x.com/PredictionArena` is an unrelated account, so a link that
 * drifts back to a guessable handle sends our visitors to a stranger. These assertions pin the exact
 * URLs, the new-tab behaviour, and the absence of the bare `x.com` / `telegram.org` placeholders.
 *
 * Bluesky replaced X as the primary channel on 2026-11-09: the X account is behind a liveness check
 * that needs a camera. The assertions moved with it — a footer that still advertises a locked account
 * is worse than one that advertises nothing.
 */
const BSKY_URL = "https://bsky.app/profile/predictionarena.bsky.social";
const BSKY_HANDLE = "@predictionarena.bsky.social";
const TG_URL = "https://t.me/predictionarena_hq";

test("footer links to the official accounts, safely", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("footer").scrollIntoViewIfNeeded();

  for (const url of [BSKY_URL, TG_URL]) {
    const link = page.locator(`a[href="${url}"]`).first();
    await expect(link, `${url} must be mounted`).toBeVisible();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("rel", /noreferrer/);
  }

  // placeholders are gone, and the impostor handle never appears
  expect(await page.locator('a[href="https://x.com"]').count()).toBe(0);
  expect(await page.locator('a[href="https://telegram.org"]').count()).toBe(0);
  expect(await page.locator('a[href*="x.com/PredictionArena"]').count()).toBe(0);

  // the footer prints the handle, not just an icon
  await expect(page.locator("footer").getByText(BSKY_HANDLE, { exact: false }).first()).toBeVisible();
  await expect(page.locator("footer").getByText("@predictionarena_hq", { exact: false }).first()).toBeVisible();
});

test("docs page names the official channels and the v3 contract", async ({ page }) => {
  await page.goto("/docs/security", { waitUntil: "domcontentloaded" });

  const body = await page.locator("body").innerText();
  expect(body).toContain("@predictionarena.bsky.social");
  expect(body).toContain("@predictionarena_hq");
  expect(body.toLowerCase()).toContain("0xdfaf86cf3b53c14f7ef60d032e6c501161682a3a");
  expect(body.toLowerCase()).not.toContain("0x108d5cdc23123fa97929cf197151fb9dc29a5d93");
  expect(body.toLowerCase()).toContain("impostor");
});

test("page metadata credits the official channels", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const html = await page.content();
  // structured data links the site to the channels that actually publish
  expect(html).toContain('"@type":"Organization"');
  expect(html).toContain("bsky.app/profile/predictionarena.bsky.social");
  expect(html).toContain("t.me/predictionarena_hq");
});

