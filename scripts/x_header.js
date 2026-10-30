/**
 * X header image (1500x500, the size X crops to).
 *
 * Rendered with the same Chromium the e2e suite uses, from an HTML string — gradients, blur and
 * system fonts are native there, and the output is a plain PNG with no dependency on the site being
 * up. The copy is the account's whole pitch in one line, because the header is the only place a
 * visitor sees before deciding whether to follow.
 *
 *   node scripts/x_header.js
 *   node scripts/x_header.js --out=/tmp/header.png
 */

const { createRequire } = require("node:module");
const { join } = require("node:path");
const { mkdirSync } = require("node:fs");

const req = createRequire(join(__dirname, "..", "frontend", "package.json"));
const { chromium } = req("playwright-core");

const out = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? "/mnt/c/Users/Administrator/Desktop/pa_header.png";

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1500px; height:500px; overflow:hidden; background:#05080F;
         font-family:-apple-system,"Segoe UI",Inter,Helvetica,Arial,sans-serif; color:#E8EEF9; }
  .wrap { position:relative; width:1500px; height:500px; padding:64px 72px; display:flex; flex-direction:column; justify-content:space-between; }
  .glow { position:absolute; border-radius:999px; filter:blur(90px); opacity:.55; }
  .g1 { width:520px; height:520px; background:#FBBF24; left:-140px; top:-220px; }
  .g2 { width:460px; height:460px; background:#22D3EE; right:-120px; bottom:-220px; opacity:.35; }
  .grid { position:absolute; inset:0; background-image:linear-gradient(rgba(143,160,191,.10) 1px,transparent 1px),
          linear-gradient(90deg,rgba(143,160,191,.10) 1px,transparent 1px); background-size:50px 50px; }
  .kicker { position:relative; font-size:19px; letter-spacing:5px; color:#22D3EE; text-transform:uppercase; }
  h1 { position:relative; font-size:78px; line-height:1.04; letter-spacing:-1.6px; font-weight:800; max-width:1150px; }
  h1 em { font-style:normal; color:#FBBF24; }
  .foot { position:relative; display:flex; align-items:flex-end; justify-content:space-between; }
  .sub { font-size:25px; color:#8FA0BF; letter-spacing:.2px; }
  .sub b { color:#E8EEF9; font-weight:600; }
  .tag { font-size:20px; color:#5C6C87; letter-spacing:3px; }
  .bars { display:flex; gap:10px; align-items:flex-end; height:74px; }
  .bar { width:26px; border-radius:4px; background:#FBBF24; }
</style></head><body>
  <div class="wrap">
    <div class="grid"></div><div class="glow g1"></div><div class="glow g2"></div>
    <div class="kicker">Prediction Arena · Base</div>
    <h1>THE ODDS ON THE<br>ARGUMENT YOU'RE<br><em>ALREADY HAVING</em></h1>
    <div class="foot">
      <div class="sub">Binary markets, USDC escrow, <b>the losing side pays the winning side</b>.</div>
      <div class="bars">
        <div class="bar" style="height:22%"></div><div class="bar" style="height:38%"></div>
        <div class="bar" style="height:31%"></div><div class="bar" style="height:64%"></div>
        <div class="bar" style="height:52%"></div><div class="bar" style="height:88%"></div>
      </div>
      <div class="tag">@Predict065</div>
    </div>
  </div>
</body></html>`;

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 500 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(300);
  mkdirSync(join(out, ".."), { recursive: true });
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1500, height: 500 } });
  await browser.close();
  console.log(`header → ${out} (1500x500 @2x)`);
})();
