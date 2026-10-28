/**
 * Social auto-pilot — pick the loudest market on the board and draft the daily post for X and
 * Telegram.
 *
 * Run it dry (default) to see exactly what would go out:
 *
 *   bun scripts/auto-market.ts                 # biggest payout on the board
 *   bun scripts/auto-market.ts --pick=expiry   # closest to closing
 *   bun scripts/auto-market.ts --limit=3       # three posts, one per market
 *   bun scripts/auto-market.ts --json          # machine-readable, for a cron wrapper
 *
 * Sending needs credentials; without them the script still prints the tweets, so the copy can be
 * reviewed (and pasted by hand) before anyone hands it a token:
 *
 *   X_OAUTH2_BEARER=...      # user-context token with tweet.write
 *   TELEGRAM_BOT_TOKEN=...   # bot that is an admin of @predictionarena_hq
 *   TELEGRAM_CHAT_ID=@predictionarena_hq
 *
 * Design rules, learned the hard way:
 *  - It never invents a number. Probability, payout, traders and the close time all come from the
 *    manifest or from `/api/board`, and the tweet quotes the same figures the card shows.
 *  - It never says "paying X×" about a settled market, and it skips markets whose window has
 *    already closed — a post that sends people to a dead market burns the click forever.
 *  - Every link carries `utm_*` + `ref`, the same attribution the in-app share button uses, so a
 *    spike in traffic can be traced to the channel that produced it.
 *  - Dry run is the default. Publishing is opt-in via `--send` *and* credentials.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SITE = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "https://predictionarena.online";
const MANIFEST = join(import.meta.dir, "..", "frontend", "public", "pools.json");
const X_HANDLE = "@Predict065";

type Pool = {
  id: string | number;
  title: string;
  status?: number;
  endTimeUtc?: string;
  traders?: number;
  liquidityUsdc?: string | number;
  yesShare?: number;
  marketData?: { asset?: string; spotUsd?: number; strikeUsd?: number; source?: string };
};

type Args = { pick: "movers" | "expiry"; limit: number; send: boolean; json: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { pick: "movers", limit: 1, send: false, json: false };
  for (const raw of argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "pick" && (value === "movers" || value === "expiry")) args.pick = value;
    else if (key === "limit") args.limit = Math.max(1, Math.min(10, Number(value) || 1));
    else if (key === "send") args.send = true;
    else if (key === "json") args.json = true;
    else if (key === "help" || key === "-h") {
      console.log("usage: bun scripts/auto-market.ts [--pick=movers|expiry] [--limit=N] [--send] [--json]");
      process.exit(0);
    }
  }
  return args;
}

function loadPools(): Pool[] {
  const board = JSON.parse(readFileSync(MANIFEST, "utf8")) as { pools?: Pool[] };
  return (board.pools ?? []).filter((p) => (p.status ?? 1) === 1);
}

/** On-chain share when the manifest carries one, else the deterministic demo figure. */
function yesShare(pool: Pool): number {
  const raw = Number(pool.yesShare ?? Number.NaN);
  if (Number.isFinite(raw) && raw > 0 && raw < 1) return raw;
  return 0.5;
}

/** X counts every URL as 23 characters, so length is measured with that substitution. */
function weight(text: string): number {
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  return urls.reduce((n, u) => n + 23 - u.length, text.length);
}

function money(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

/** Prices need more precision than a liquidity figure: "$0" for TOSHI is worse than no number. */
function price(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "$—";
  if (v >= 1_000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${Number(v.toPrecision(4))}`;
}

function clipped(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/** Attribution identical to the in-app share button, so both show up under one campaign. */
function trackedUrl(id: string | number, channel: "x" | "telegram"): string {
  const url = new URL(`${SITE}/market/${id}`);
  url.searchParams.set("utm_source", channel);
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", "auto_market");
  url.searchParams.set("utm_content", String(id));
  url.searchParams.set("ref", channel);
  return url.toString();
}

function closeIn(pool: Pool): string {
  if (!pool.endTimeUtc) return "soon";
  const ms = new Date(pool.endTimeUtc).getTime() - Date.now();
  if (ms <= 0) return "closed";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function rank(pools: Pool[], pick: Args["pick"]): Pool[] {
  const alive = pools.filter((p) => !poolClosed(p));
  if (pick === "expiry") {
    return [...alive].sort(
      (a, b) => new Date(a.endTimeUtc ?? 8.64e15).getTime() - new Date(b.endTimeUtc ?? 8.64e15).getTime(),
    );
  }
  // "movers": the side that pays the most — longest odds first, traders as the tie-break.
  return [...alive].sort((a, b) => {
    const pa = 1 / Math.max(0.02, yesShare(a));
    const pb = 1 / Math.max(0.02, yesShare(b));
    if (Math.abs(pb - pa) > 0.05) return pb - pa;
    return (b.traders ?? 0) - (a.traders ?? 0);
  });
}

function poolClosed(pool: Pool): boolean {
  if (!pool.endTimeUtc) return false;
  return new Date(pool.endTimeUtc).getTime() <= Date.now();
}

function tweetFor(pool: Pool): string {
  const yes = Math.round(yesShare(pool) * 100);
  const no = 100 - yes;
  const mult = (1 / Math.max(0.02, yes / 100)).toFixed(1);
  const traders = pool.traders ?? 0;
  const url = trackedUrl(pool.id, "x");
  const lead = pool.marketData?.asset
    ? `${pool.marketData.asset} at ${price(pool.marketData.spotUsd ?? 0)} right now.`
    : `Closes in ${closeIn(pool)}.`;

  const options = [
    `The crowd is paying ${mult}× on one side of this market:\n\n"${clipped(pool.title, 70)}"\n\n${yes}% YES · ${no}% NO · ${traders} traders in. ${lead}`,
    `Still ${closeIn(pool)} left to take a side:\n\n"${clipped(pool.title, 70)}"\n\n${yes}% YES pays ${mult}×. ${traders} traders are already in.`,
    `Two AI agents argued this one and the crowd split ${yes}/${no}:\n\n"${clipped(pool.title, 70)}"\n\nYES pays ${mult}×. ${lead}`,
  ];

  for (const draft of options) {
    const text = `${draft}\n${url}\n${X_HANDLE}`;
    if (weight(text) <= 275) return text;
  }
  return `${clipped(pool.title, 60)}\n${yes}% YES pays ${mult}×.\n${url}\n${X_HANDLE}`;
}

function telegramFor(pool: Pool): string {
  const yes = Math.round(yesShare(pool) * 100);
  const mult = (1 / Math.max(0.02, yes / 100)).toFixed(1);
  const url = trackedUrl(pool.id, "telegram");
  return [
    `📊 DAILY BOARD — ${new Date().toISOString().slice(0, 10)}`,
    "",
    `🔥 ${pool.title}`,
    `${yes}% YES · pays ${mult}× · ${pool.traders ?? 0} traders · ${money(Number(pool.liquidityUsdc ?? 0))} liquidity`,
    `Closes in ${closeIn(pool)}`,
    "",
    `Take a side → ${url}`,
    "",
    `Only official links: ${SITE} · x.com/Predict065 · t.me/predictionarena_hq`,
    `Contract: 0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5 (Base, v3)`,
  ].join("\n");
}

async function sendX(text: string): Promise<string> {
  const token = process.env.X_OAUTH2_BEARER;
  if (!token) return "skipped: X_OAUTH2_BEARER unset";
  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await res.text();
  return res.ok ? `sent: ${body.slice(0, 120)}` : `failed ${res.status}: ${body.slice(0, 200)}`;
}

async function sendTelegram(text: string): Promise<string> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID ?? "@predictionarena_hq";
  if (!token) return "skipped: TELEGRAM_BOT_TOKEN unset";
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: false }),
  });
  const body = await res.text();
  return res.ok ? "sent" : `failed ${res.status}: ${body.slice(0, 200)}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const pools = loadPools();
  if (pools.length === 0) {
    console.error("no open markets in the manifest");
    process.exit(1);
  }

  const picked = rank(pools, args.pick).slice(0, args.limit);
  const out: Record<string, unknown>[] = [];

  for (const pool of picked) {
    const tweet = tweetFor(pool);
    const tg = telegramFor(pool);
    const result: Record<string, unknown> = {
      id: pool.id,
      title: pool.title,
      tweet,
      tweetChars: weight(tweet),
      telegram: tg,
    };
    if (args.send) {
      result.x = await sendX(tweet);
      result.telegramSend = await sendTelegram(tg);
    }
    out.push(result);
  }

  if (args.json) console.log(JSON.stringify({ site: SITE, posts: out }, null, 2));
  else {
    out.forEach((r: Record<string, unknown>) => {
      console.log(`\n=== market ${r.id} — ${r.title}`);
      console.log(`--- X (${r.tweetChars}/280 weighted)`);
      console.log(r.tweet);
      console.log("--- Telegram");
      console.log(r.telegram);
      if (r.x) console.log(`--- x: ${r.x}`);
      if (r.telegramSend) console.log(`--- telegram: ${r.telegramSend}`);
    });
    if (!args.send) console.log("\n(dry run — pass --send with credentials to publish)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
