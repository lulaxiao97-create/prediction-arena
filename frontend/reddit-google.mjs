import { chromium } from "@playwright/test";

/**
 * Try to create the Reddit account through Google instead of an email code.
 *
 * Email verification needs an inbox I can read; Google sign-in needs a password I was given. If
 * Google decides this is a new device and asks for a phone confirmation, the run stops there and
 * says so — that is a human-only step.
 */
const PROXY = process.env.HTTPS_PROXY || "http://172.17.240.1:16781";
const EMAIL = process.env.GOOGLE_EMAIL || "lulaxiao97@gmail.com";
const PASSWORD = process.env.GOOGLE_PASSWORD || "ArenaBase2026!xq";

const browser = await chromium.launch({ headless: true, proxy: { server: PROXY }, args: ["--no-sandbox"] });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  locale: "en-US",
  viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();
page.setDefaultTimeout(30_000);

await page.goto("https://www.reddit.com/register/", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: "/tmp/g-step1.png" });

// "Continue with Google" lives inside an iframe on Reddit's signup card.
const frame = page.frames().find((f) => f.url().includes("accounts.google.com/gsi/button"));
if (frame) {
  const btn = frame.locator('div[role="button"], button').first();
  await btn.click().catch(() => {});
} else {
  await page.getByText("Continue with Google").click().catch(() => {});
}
await page.waitForTimeout(6000);
console.log("after google click:", page.url());
await page.screenshot({ path: "/tmp/g-step2.png" });

// Google's account chooser usually opens a popup; pick it if it did.
const pages = ctx.pages();
const gp = pages.find((p) => p.url().includes("accounts.google.com")) ?? page;
console.log("google page:", gp.url());

if (gp.url().includes("accounts.google.com")) {
  const emailInput = gp.locator('input[type="email"]');
  if (await emailInput.count()) {
    await emailInput.fill(EMAIL);
    await gp.locator("#identifierNext, button:has-text('Next')").first().click().catch(() => {});
    await gp.waitForTimeout(5000);
    const pw = gp.locator('input[type="password"]');
    if (await pw.count()) {
      await pw.fill(PASSWORD);
      await gp.locator("#passwordNext, button:has-text('Next')").first().click().catch(() => {});
      await gp.waitForTimeout(8000);
    }
  }
  console.log("after signin:", gp.url());
  const body = (await gp.innerText("body").catch(() => "")).slice(0, 600).replace(/\n+/g, " | ");
  console.log("google body:", body);
  await gp.screenshot({ path: "/tmp/g-step3.png" });
}

await page.waitForTimeout(5000);
console.log("final reddit url:", page.url());
console.log("reddit body:", (await page.innerText("body").catch(() => "")).slice(0, 400).replace(/\n+/g, " | "));
await page.screenshot({ path: "/tmp/g-final.png" });
await browser.close();
