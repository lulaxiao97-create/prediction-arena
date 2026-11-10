import { chromium } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Reddit signup against the real Gmail address.
 *
 * The code arrives in the operator's already-signed-in Gmail window on Windows; this script waits for
 * it at /tmp/reddit-code.txt (written by the agent after reading the inbox screenshot) and then
 * finishes the form. Everything else — email submit, code field, username, password — is driven here.
 */
const PROXY = process.env.HTTPS_PROXY || "http://172.17.240.1:16781";
const EMAIL = process.env.GOOGLE_EMAIL || "lulaxiao97@gmail.com";
const PASSWORD = process.env.REDDIT_PASSWORD || "ArenaBase2026!xq";
const USER = process.env.REDDIT_USER || "arena_liu";
const CODE_FILE = "/tmp/reddit-code.txt";
const LOG = "/tmp/reddit-final.log";

const say = (m) => {
  console.log(m);
  writeFileSync(LOG, `${new Date().toISOString()} ${m}\n`, { flag: "a" });
};

const browser = await chromium.launch({ headless: true, proxy: { server: PROXY }, args: ["--no-sandbox"] });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  locale: "en-US",
  viewport: { width: 1366, height: 950 },
});
const page = await ctx.newPage();
page.setDefaultTimeout(25_000);

await page.goto("https://www.reddit.com/register/", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(3500);

await page.fill('input[name="email"]', EMAIL);
say(`email filled: ${EMAIL}`);
await page.click('button:has-text("Continue")');
await page.waitForTimeout(7000);
say(`after continue url=${page.url()}`);
await page.screenshot({ path: "/tmp/rf-after-email.png" });
const body = await page.innerText("body").catch(() => "");
say(`body: ${body.slice(0, 300).replace(/\n+/g, " | ")}`);

// Wait for the agent to drop the code in.
let code = null;
for (let i = 0; i < 72; i += 1) {
  if (existsSync(CODE_FILE)) {
    const raw = readFileSync(CODE_FILE, "utf8").trim();
    if (/^\d{6}$/.test(raw)) {
      code = raw;
      break;
    }
  }
  await page.waitForTimeout(5000);
}
if (!code) {
  say("NO CODE after 6 minutes");
  await browser.close();
  process.exit(3);
}
say(`code received: ${code}`);

const codeInput = page.locator('input[name="code"], input[placeholder*="code" i], input[autocomplete="one-time-code"]').first();
if (await codeInput.count()) {
  await codeInput.fill(code);
} else {
  await page.keyboard.type(code);
}
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/rf-after-code.png" });

await page.fill('input[name="username"]', USER).catch(() => say("no username field yet"));
await page.fill('input[name="password"]', PASSWORD).catch(() => say("no password field yet"));
await page.waitForTimeout(1500);

// Reddit's submit is a dark pill that often ignores a click; TAB+ENTER from the focused field is the
// reliable path (see the GUI skill's "main button ignores synthetic clicks" note).
await page.keyboard.press("Tab");
await page.waitForTimeout(300);
await page.keyboard.press("Enter");
await page.waitForTimeout(9000);

say(`final url=${page.url()}`);
say(`final body: ${(await page.innerText("body").catch(() => "")).slice(0, 400).replace(/\n+/g, " | ")}`);
await page.screenshot({ path: "/tmp/rf-final.png", fullPage: false });
console.log(JSON.stringify({ user: USER, email: EMAIL, password: PASSWORD, url: page.url() }));
await browser.close();
