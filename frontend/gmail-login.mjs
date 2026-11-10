import { chromium } from "@playwright/test";

/** Can I read the inbox at all? Everything else (Reddit, any email-gated signup) depends on this. */
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

await page.goto("https://accounts.google.com/signin/v2/identifier?hl=en&flowName=GlifWebSignIn", {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForTimeout(3000);
console.log("step1:", page.url());
const body1 = (await page.innerText("body").catch(() => "")).slice(0, 400).replace(/\n+/g, " | ");
console.log("body1:", body1);

const email = page.locator('input[type="email"]');
if (await email.count()) {
  await email.fill(EMAIL);
  await page.locator("#identifierNext, button:has-text('Next')").first().click().catch(() => {});
  await page.waitForTimeout(6000);
}
console.log("step2:", page.url());
console.log("body2:", (await page.innerText("body").catch(() => "")).slice(0, 500).replace(/\n+/g, " | "));
await page.screenshot({ path: "/tmp/gm-step2.png" });

const pw = page.locator('input[type="password"]');
if (await pw.count()) {
  await pw.fill(PASSWORD);
  await page.locator("#passwordNext, button:has-text('Next')").first().click().catch(() => {});
  await page.waitForTimeout(9000);
}
console.log("step3:", page.url());
const body3 = (await page.innerText("body").catch(() => "")).slice(0, 700).replace(/\n+/g, " | ");
console.log("body3:", body3);
await page.screenshot({ path: "/tmp/gm-step3.png" });
await browser.close();
