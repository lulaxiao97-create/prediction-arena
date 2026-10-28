import { expect, test } from "@playwright/test";

/**
 * Phone layout — 390px, the narrowest screen the product is actually used on.
 *
 * These assertions are deliberately mechanical: a 44px hit area and a 12px card padding are the
 * two numbers that were wrong on a real device, and both regress silently. Nothing here checks
 * taste; it checks that a thumb can hit the control and that the card is the compact variant.
 */
test.describe("mobile 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("language switcher is a 44px target and its menu is tappable", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const trigger = page.getByRole("button", { name: "Language" });
    await expect(trigger).toBeVisible();

    const box = await trigger.boundingBox();
    expect(box, "language button must have a layout box").not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);

    // the trigger must sit fully inside the viewport: a control clipped by the header edge is
    // "visible" to Playwright and unreachable to a thumb
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    await trigger.click();
    const option = page.getByRole("option").first();
    await expect(option).toBeVisible();
    const optionBox = await option.boundingBox();
    expect(optionBox!.height).toBeGreaterThanOrEqual(44);
    expect(optionBox!.x + optionBox!.width).toBeLessThanOrEqual(390);

    // and switching actually switches
    await page.getByRole("option", { name: /繁體中文/ }).click();
    await expect(page.getByRole("button", { name: "語言" })).toBeVisible();
  });

  test("market cards use the compact padding on a phone", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const card = page.locator("article.market-card").first();
    await expect(card).toBeVisible();

    const body = card.locator("div.p-3").first();
    const padding = await body.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingTop));
    expect(padding).toBeLessThanOrEqual(12);

    // the cover band is the short variant below sm
    const cover = card.locator("div.relative.h-\\[96px\\]").first();
    await expect(cover).toBeVisible();
  });

  test("no horizontal overflow at 390px", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
