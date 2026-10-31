/**
 * Marketing card renderer — the picture that makes a tweet worth stopping for.
 *
 * A number-only post gets scrolled past; a card gets screenshot. This renders a 1200×675 OG image
 * (1.91:1, what X and Farcaster both crop to) from the same manifest row the copy is built from, so
 * the picture can never disagree with the text it ships next to.
 *
 *   bun scripts/generate-marketing-image.ts                        # flagship market → Desktop pack
 *   bun scripts/generate-marketing-image.ts --market=700011
 *   bun scripts/generate-marketing-image.ts --out=/tmp/card.png --scale=2
 *
 * How: Chromium (the one Playwright already installed for e2e) renders real HTML/CSS at exactly
 * 1200×675 and screenshots it. That gives gradients, blur, blend modes and web-safe type without a
 * canvas dependency, and it is the same engine the site is tested in — the card looks like the
 * product because it is rendered by the same renderer.
 *
 * Reached through `createRequire(frontend/package.json)`: Playwright and qrcode live in the
 * frontend's node_modules, and this script runs from the repo root. Absolute paths into a package
 * tree are brittle, a require rooted at the frontend package is not.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const MANIFEST = join(ROOT, "frontend", "public", "pools.json");
const DESKTOP_FALLBACK = join(process.env.HOME ?? ".", "Desktop", "PredictionArena_Marketing");

type Pool = {
  id: string | number;
  title: string;
  status?: number;
  endTimeUtc?: string;
  traders?: number;
  liquidityUsdc?: string | number;
  yesShare?: number;
  marketData?: { asset?: string; spotUsd?: number; strikeUsd?: number; direction?: string; source?: string };
};

type Args = { market: string | null; out: string | null; scale: number; quiet: boolean; snapshot: string | null };

function parseArgs(argv: string[]): Args {
  const args: Args = { market: null, out: null, scale: 2, quiet: false, snapshot: null };
  for (const raw of argv.slice(2)) {
    const [key, value = ""] = raw.replace(/^--/, "").split("=");
    if (key === "market") args.market = value;
    else if (key === "snapshot") args.snapshot = value;
    else if (key === "out") args.out = value;
    else if (key === "scale") args.scale = Math.max(1, Math.min(3, Number(value) || 2));
    else if (key === "quiet") args.quiet = true;
    else if (key === "help" || key === "-h") {
      console.log("usage: bun scripts/generate-marketing-image.ts [--market=<id>] [--out=<path>] [--scale=2]");
      process.exit(0);
    }
  }
  return args;
}

function desktopDir(): string {
  if (process.env.MARKETING_DIR) return join(process.env.MARKETING_DIR, "PredictionArena_Marketing");
  if (existsSync("/mnt/c/Users")) {
    for (const user of readdirSync("/mnt/c/Users")) {
      const candidate = join("/mnt/c/Users", user, "Desktop");
      if (existsSync(candidate)) return join(candidate, "PredictionArena_Marketing");
    }
  }
  return DESKTOP_FALLBACK;
}

function openPools(): Pool[] {
  const board = JSON.parse(readFileSync(MANIFEST, "utf8")) as { pools?: Pool[] };
  return (board.pools ?? []).filter((p) => (p.status ?? 1) === 1);
}

function yesShare(pool: Pool): number {
  const raw = Number(pool.yesShare ?? Number.NaN);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.5;
}

function money(v: number): string {
  if (!Number.isFinite(v)) return "$—";
  if (v >= 1_000) return `$${Math.round(v).toLocaleString("en-US")}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${Number(v.toPrecision(4))}`;
}

function closeIn(endTimeUtc?: string): string {
  if (!endTimeUtc) return "SOON";
  const ms = new Date(endTimeUtc).getTime() - Date.now();
  if (ms <= 0) return "CLOSED";
  const hours = Math.round(ms / 3_600_000);
  return hours < 24 ? `${hours}H LEFT` : `${Math.round(hours / 24)}D LEFT`;
}

/**
 * The headline. A price market reduces to the fight — "AERO vs $0.78" — because that is what a
 * thumb reads at feed speed. Anything editorial keeps its question, clipped.
 */
function headline(pool: Pool): { big: string; sub: string } {
  const md = pool.marketData;
  if (md?.asset && md?.strikeUsd) {
    return {
      big: `${md.asset} vs ${money(md.strikeUsd)}`,
      sub: pool.title,
    };
  }
  const short = pool.title.replace(/^Will\s+/i, "").replace(/\?$/, "");
  return {
    big: short.length > 44 ? `${short.slice(0, 43).trimEnd()}…` : short,
    sub: pool.title,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The card. One column of numbers on the left, the scannable square on the right. */
function html(pool: Pool, qrSvg: string, trackedUrl: string): string {
  const yes = Math.round(yesShare(pool) * 100);
  const no = 100 - yes;
  const yesMult = (1 / Math.max(0.02, yes / 100)).toFixed(1);
  const noMult = (1 / Math.max(0.02, no / 100)).toFixed(1);
  const { big, sub } = headline(pool);
  const traders = pool.traders ?? 0;
  const liquidity = Number(pool.liquidityUsdc ?? 0);
  const asset = pool.marketData?.asset ?? "MARKET";
  const spot = pool.marketData?.spotUsd;
  // A card rendered from an archived snapshot must not claim to be live — the copy it ships next to
  // was written hours ago, and "LIVE" next to "ARCHIVED" is exactly the kind of small lie that makes
  // an audience stop trusting the big numbers.
  const isArchive = pool.marketData?.source === "ARCHIVED SNAPSHOT";
  const feed = isArchive ? "SNAPSHOT" : (pool.marketData?.source ?? "PREDICTION ARENA");
  const liveTag = isArchive ? "AS POSTED" : "LIVE";

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1200px; height:675px; }
  body {
    background:#05070d;
    color:#E8EEF9;
    font-family:"DejaVu Sans", system-ui, sans-serif;
    position:relative; overflow:hidden;
  }
  .grid {
    position:absolute; inset:-40px;
    background-image:linear-gradient(rgba(34,211,238,0.07) 1px, transparent 1px),
                     linear-gradient(90deg, rgba(34,211,238,0.07) 1px, transparent 1px);
    background-size:48px 48px;
    transform:perspective(700px) rotateX(46deg) translateY(-70px) scale(1.35);
    transform-origin:top center; opacity:.75;
  }
  .glowA { position:absolute; width:760px; height:760px; left:-260px; top:-300px; border-radius:50%;
    background:radial-gradient(circle, rgba(34,211,238,0.28), transparent 62%); filter:blur(12px); }
  .glowB { position:absolute; width:720px; height:720px; right:-240px; bottom:-320px; border-radius:50%;
    background:radial-gradient(circle, rgba(251,191,36,0.22), transparent 64%); filter:blur(12px); }
  .scan { position:absolute; inset:0;
    background:repeating-linear-gradient(0deg, rgba(255,255,255,0.032) 0 1px, transparent 1px 3px); }
  .frame { position:absolute; inset:22px; border:1px solid rgba(34,211,238,0.22); border-radius:18px; }
  .corner { position:absolute; width:26px; height:26px; border:2px solid #22D3EE; }
  .c1 { left:22px; top:22px; border-right:0; border-bottom:0; border-radius:18px 0 0 0; }
  .c2 { right:22px; top:22px; border-left:0; border-bottom:0; border-radius:0 18px 0 0; }
  .c3 { left:22px; bottom:22px; border-right:0; border-top:0; border-radius:0 0 0 18px; }
  .c4 { right:22px; bottom:22px; border-left:0; border-top:0; border-radius:0 0 18px 0; }

  .wrap { position:relative; padding:52px 58px 88px; display:flex; gap:40px; height:100%; }
  .left { flex:1; min-width:0; display:flex; flex-direction:column; }
  .kicker { display:flex; align-items:center; gap:10px; font-size:15px; letter-spacing:.22em;
    text-transform:uppercase; color:#22D3EE; font-weight:700; }
  .dot { width:9px; height:9px; border-radius:50%; background:#16C784; box-shadow:0 0 12px #16C784; }
  h1 { margin-top:22px; font-size:74px; line-height:1.02; font-weight:800; letter-spacing:-.02em;
    text-shadow:0 0 28px rgba(34,211,238,0.35); }
  h1 .em { color:#FBBF24; }
  .flag { font-size:46px; vertical-align:middle; margin-right:10px; }
  .sub { margin-top:14px; font-size:19px; line-height:1.35; color:#8FA0BF; max-width:640px; }
  .rows { margin-top:26px; width:640px; }
  .row { margin-top:14px; }
  .head { display:flex; align-items:baseline; gap:12px; font-family:"DejaVu Sans Mono", monospace; }
  .label { font-size:20px; font-weight:700; letter-spacing:.08em; }
  .yes .label { color:#16C784; }
  .no .label { color:#F87171; }
  .pct { font-size:40px; font-weight:700; }
  .mult { font-size:20px; color:#E8EEF9; opacity:.85; }
  .track { margin-top:7px; height:16px; border-radius:9px; background:rgba(255,255,255,0.07);
    border:1px solid rgba(255,255,255,0.09); overflow:hidden; }
  .fill { height:100%; border-radius:8px; }
  .yes .fill { width:${Math.max(2, yes)}%; background:linear-gradient(90deg,#0E9F6E,#16C784,#5EEAD4);
    box-shadow:0 0 22px rgba(22,199,132,0.55); }
  .no .fill { width:${Math.max(2, no)}%; background:linear-gradient(90deg,#B91C1C,#EF4444,#F87171);
    box-shadow:0 0 22px rgba(248,113,113,0.45); }
  .meta { margin-top:auto; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  .pill { font-family:"DejaVu Sans Mono", monospace; font-size:17px; padding:9px 16px; border-radius:999px;
    border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.045); color:#E8EEF9; }
  .pill.hot { border-color:rgba(251,191,36,0.45); background:rgba(251,191,36,0.10); color:#FDE68A; }
  .pill.cool { border-color:rgba(34,211,238,0.4); background:rgba(34,211,238,0.08); color:#A5F3FC; }

  .right { width:300px; flex:0 0 300px; display:flex; flex-direction:column; align-items:center;
    justify-content:center; gap:14px; }
  .qrbox { padding:14px; border-radius:18px; background:#ffffff; box-shadow:0 0 60px rgba(34,211,238,0.35); }
  .qrbox svg { width:230px; height:230px; display:block; }
  .domain { font-family:"DejaVu Sans Mono", monospace; font-size:18px; color:#22D3EE; letter-spacing:.02em; }
  .handle { font-size:13.5px; color:#8FA0BF; font-family:"DejaVu Sans Mono", monospace; white-space:nowrap; }
  /* The airdrop pill: the one line on the card that is about the venue rather than the market. */
  .airdrop { margin-top:10px; display:inline-block; font-size:12.5px; font-weight:700; letter-spacing:.06em;
    color:#0B0F1A; background:#FBBF24; border-radius:999px; padding:5px 11px; white-space:nowrap; }
  .contract { position:absolute; left:58px; right:58px; bottom:26px; display:flex;
    justify-content:space-between; font-family:"DejaVu Sans Mono", monospace; font-size:12.5px;
    color:rgba(143,160,191,0.72); }
</style></head>
<body>
  <div class="grid"></div>
  <div class="glowA"></div>
  <div class="glowB"></div>
  <div class="scan"></div>
  <div class="frame"></div>
  <div class="corner c1"></div><div class="corner c2"></div>
  <div class="corner c3"></div><div class="corner c4"></div>

  <div class="wrap">
    <div class="left">
      <div class="kicker"><span class="dot"></span> ${escapeHtml(feed)} · ${escapeHtml(asset)} · ${liveTag}</div>
      <h1><span class="flag">🏴</span>${escapeHtml(big)}</h1>
      <p class="sub">${escapeHtml(sub)}</p>

      <div class="rows">
        <div class="row yes">
          <div class="head">
            <span class="label">YES</span>
            <span class="pct">${yes}%</span>
            <span class="mult">${yesMult}× payout</span>
          </div>
          <div class="track"><div class="fill"></div></div>
        </div>
        <div class="row no">
          <div class="head">
            <span class="label">NO</span>
            <span class="pct">${no}%</span>
            <span class="mult">${noMult}× payout</span>
          </div>
          <div class="track"><div class="fill"></div></div>
        </div>
      </div>

      <div class="meta">
        <span class="pill hot">${escapeHtml(closeIn(pool.endTimeUtc))}</span>
        <span class="pill cool">${traders} IN</span>
        <span class="pill">${money(liquidity)} POOL</span>
        ${spot ? `<span class="pill">SPOT ${escapeHtml(money(spot))}</span>` : ""}
      </div>
    </div>

    <div class="right">
      <div class="qrbox">${qrSvg}</div>
      <div class="domain">predictionarena.online</div>
      <div class="airdrop">🔥 ARENA POINTS · GENESIS AIRDROP</div>
      <div class="handle">@Predict065 · t.me/predictionarena_hq</div>
    </div>
  </div>

  <div class="contract">
    <span>BASE MAINNET · USDC · NON-CUSTODIAL</span>
    <span>0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5</span>
  </div>
</body></html>`;
}

/**
 * Rebuild a pool-shaped row from an archived post's snapshot.
 *
 * This is what keeps the picture and the tweet consistent: both come from the numbers that were
 * true when the copy was written, not from whatever the board says two hours later.
 */
function fromSnapshot(path: string, marketId: string): Pool | null {
  const archive = JSON.parse(readFileSync(path, "utf8")) as {
    posts?: { id: string | number; title: string; snapshot?: Record<string, unknown> }[];
  };
  const post = (archive.posts ?? []).find((p) => String(p.id) === marketId);
  const snap = post?.snapshot as
    | { yes?: number; traders?: number; liquidityUsdc?: number; asset?: string | null; strikeUsd?: number | null; spotUsd?: number | null; endTimeUtc?: string | null }
    | undefined;
  if (!post || !snap || typeof snap.yes !== "number") return null;
  return {
    id: post.id,
    title: post.title,
    traders: snap.traders ?? 0,
    liquidityUsdc: snap.liquidityUsdc ?? 0,
    yesShare: Math.max(0.01, Math.min(0.99, snap.yes / 100)),
    endTimeUtc: snap.endTimeUtc ?? undefined,
    marketData: {
      asset: snap.asset ?? undefined,
      strikeUsd: snap.strikeUsd ?? undefined,
      spotUsd: snap.spotUsd ?? undefined,
      source: "ARCHIVED SNAPSHOT",
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const pools = openPools();
  if (pools.length === 0) throw new Error(`no open markets in ${MANIFEST}`);

  const archived = args.snapshot && args.market ? fromSnapshot(args.snapshot, args.market) : null;
  const pool = archived
    ?? (args.market
      ? pools.find((p) => String(p.id) === args.market)
      : [...pools].sort((a, b) => (b.traders ?? 0) - (a.traders ?? 0))[0]);
  if (!pool) throw new Error(`market ${args.market} not found in the open board or the snapshot`);

  const out = args.out ?? join(desktopDir(), "01-market-card.png");
  mkdirSync(dirname(out), { recursive: true });

  const req = createRequire(join(ROOT, "frontend", "package.json"));
  let chromium: { launch: (opts?: unknown) => Promise<unknown> };
  let QRCode: { toString: (text: string, opts: unknown) => Promise<string> };
  try {
    chromium = req("playwright-core").chromium as typeof chromium;
    QRCode = req("qrcode") as typeof QRCode;
  } catch (err) {
    throw new Error(
      `playwright-core / qrcode are not resolvable from frontend/package.json (${(err as Error).message})`,
    );
  }

  const tracked = `https://predictionarena.online/market/${pool.id}?utm_source=x&utm_medium=social&utm_campaign=market_card&utm_content=${pool.id}&ref=x`;
  // Rendered SVG keeps the QR crisp at 2× and avoids shipping a raster inside a raster.
  const qrSvg = await QRCode.toString(tracked, { type: "svg", margin: 0, errorCorrectionLevel: "M", width: 230 });

  const browser = (await chromium.launch({ args: ["--no-sandbox", "--font-render-hinting=none"] })) as {
    newPage: (opts: unknown) => Promise<{
      setContent: (html: string, opts: unknown) => Promise<void>;
      screenshot: (opts: unknown) => Promise<Uint8Array>;
      close: () => Promise<void>;
    }>;
    close: () => Promise<void>;
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: args.scale });
    await page.setContent(html(pool, qrSvg, tracked), { waitUntil: "load" });
    const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1200, height: 675 } });
    writeFileSync(out, png);
    await page.close();
    if (!args.quiet) {
      console.log(`card: ${out}`);
      console.log(`  market ${pool.id} · ${headline(pool).big} · ${Math.round(png.length / 1024)}KB @ ${args.scale}×`);
      console.log(`  qr → ${tracked}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`generate-marketing-image failed: ${(err as Error).message}`);
  process.exit(1);
});
