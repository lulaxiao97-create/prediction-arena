import { expect, test } from "@playwright/test";

/**
 * The no-wallet door.
 *
 * This exists because the feature's whole point is that it works for someone with no wallet — a
 * regression that quietly requires a connected account would look fine to every other test in the
 * suite (they all connect a mock wallet first).
 */
test("a visitor with no wallet can take a side and it survives a reload", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const yes = page.getByRole("button", { name: "I say yes" });
  const no = page.getByRole("button", { name: "I say no" });

  await expect(yes).toBeVisible();
  await expect(no).toBeVisible();
  await expect(page.getByText("No wallet needed")).toBeVisible();

  // nothing is connected, and the button still works
  await yes.click();
  await expect(yes).toHaveAttribute("aria-pressed", "true");
  await expect(no).toHaveAttribute("aria-pressed", "false");

  // the pick is in localStorage, not in a network call
  const stored = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith("pa.guess."));
    return key ? { key, value: window.localStorage.getItem(key) } : null;
  });
  expect(stored, "the pick must be persisted under pa.guess.<id>").not.toBeNull();
  expect(stored!.value).toContain("yes");

  // reload: the choice is still there, which is the difference between a vote and a click
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "I say yes" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Share your call" })).toBeVisible();
});

test("switching sides replaces the pick instead of stacking them", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "I say yes" }).click();
  await page.getByRole("button", { name: "I say no" }).click();

  await expect(page.getByRole("button", { name: "I say no" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "I say yes" })).toHaveAttribute("aria-pressed", "false");

  const values = await page.evaluate(() =>
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith("pa.guess."))
      .map((k) => window.localStorage.getItem(k))
  );
  expect(values).toHaveLength(1);
  expect(values[0]).toContain("no");
});
