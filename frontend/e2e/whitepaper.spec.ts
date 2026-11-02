import { expect, test } from "@playwright/test";

/**
 * The whitepaper surface.
 *
 * It exists for one reason: a reader (or a captain, or an exchange listing reviewer) has to be able to
 * reach the document from the app, read it without a PDF, and download the exact same bytes. The doc
 * is generated from docs/WHITEPAPER.md at build time, so these assertions also catch the case where
 * the export step was skipped and the page silently ships a stale copy.
 */
test("whitepaper renders the six chapters and the tokenomics table", async ({ page }) => {
  await page.goto("/whitepaper", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { level: 1, name: "Prediction Arena" })).toBeVisible();

  // All six chapters, in order, as real headings — not a screenshot of a PDF.
  for (const chapter of [
    "1. Abstract & Vision",
    "2. Architecture & Multi-Sector Engine",
    "3. Arena Points System",
    "4. $ARENA Tokenomics",
    "5. Security & Trustless Execution",
    "6. Roadmap 2026–2027",
  ]) {
    await expect(page.getByRole("heading", { name: chapter, exact: true })).toBeVisible();
  }

  // Markdown tables have to survive the custom renderer: the supply split is the most-copied number.
  await expect(page.getByRole("cell", { name: "420,000,000", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "250,000,000", exact: true })).toBeVisible();
  await expect(page.getByText("50% of the fee", { exact: false }).first()).toBeVisible();

  // And the download link must point at a file that is actually served.
  const download = page.getByRole("link", { name: /Download .md/i });
  await expect(download).toHaveAttribute("href", "/WHITEPAPER.md");
  const res = await page.request.get("/WHITEPAPER.md");
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain("Whitepaper v1.0");
});

test("the whitepaper is reachable from the nav and the footer", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const navLink = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /Whitepaper/i }).first();
  await expect(navLink).toBeVisible();
  await navLink.click();
  await expect(page).toHaveURL(/\/whitepaper$/);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const footerLink = page.getByRole("contentinfo").getByRole("link", { name: /Whitepaper/i }).first();
  await expect(footerLink).toBeVisible();
});

test.describe("whitepaper on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("tables scroll inside their frame instead of widening the page", async ({ page }) => {
    await page.goto("/whitepaper", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "4. $ARENA Tokenomics", exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the whitepaper must not push the page past 390px").toBeLessThanOrEqual(1);
  });
});
