import { chromium } from "@playwright/test";

const PROXY = process.env.HTTPS_PROXY || "http://172.17.240.1:16781";

const browser = await chromium.launch({
  headless: true,
  proxy: { server: PROXY },
  args: ["--no-sandbox"],
});
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  locale: "en-US",
  viewport: { width: 1280, height: 900 },
});
const page = await ctx.newPage();
await page.goto("https://www.reddit.com/register/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(4000);
console.log("url:", page.url());
console.log("title:", await page.title());
const txt = (await page.innerText("body").catch(() => "")).slice(0, 900);
console.log("---body---");
console.log(txt);
const inputs = await page.$$eval("input", (els) => els.map((e) => `${e.type}:${e.name || e.id}`));
console.log("inputs:", inputs.join(", "));
const iframes = await page.$$eval("iframe", (els) => els.map((e) => e.src || e.title));
console.log("iframes:", iframes.join(", "));
await page.screenshot({ path: "/tmp/reddit-register.png", fullPage: false });
await browser.close();
