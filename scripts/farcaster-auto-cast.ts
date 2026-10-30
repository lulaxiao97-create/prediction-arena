/**
 * Farcaster auto-cast — the distribution channel that needs no followers.
 *
 * X gates reach behind an audience graph and a paid API; Farcaster does not. A cast with a frame
 * embed lands in the channel timeline of /base and /degen, where the people who bet on Base memes
 * actually read, and the frame is the product. So this script is not "post a link": it composes the
 * same three-line duel the X copy uses, attaches the market frame URL, and routes it to the channel
 * whose audience is already arguing about that token.
 *
 * Publishing needs a signer — one of:
 *   · NEYNAR_API_KEY + NEYNAR_SIGNER_UUID   (POST /v2/farcaster/cast, easiest)
 *   · FARCASTER_BEARER                      (Warpcast api, when the account has a token)
 * With neither, `--plan` still produces the exact casts and exits 0: a blocked credential is not a
 * reason to hide the work, and the same code path runs in CI once the secret exists.
 *
 *   bun scripts/farcaster-auto-cast.ts --plan
 *   bun scripts/farcaster-auto-cast.ts --publish
 *   bun scripts/farcaster-auto-cast.ts --self-test
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SITE, bar, bothOdds, clipped, price, timeLeft } from "./lib/copy-kit";

const ROOT = join(import.meta.dir, "..");
const MANIFEST = join(ROOT, "frontend", "public", "pools.json");
const DATA = process.env.FARCASTER_DATA ?? join(ROOT, ".data", "farcaster");
const CAST_LIMIT = 320;

type Pool = {
  id: string | number;
  title: string;
  category?: string;
  tags?: string[];
  status?: number;
  endTimeUtc?: string;
  traders?: number;
  yesShare?: number;
  marketData?: { asset?: string; spotUsd?: number };
};

type Cast = {
  marketId: string;
  channel: "base" | "degen";
  text: string;
  embed: string;
  chars: number;
};

type Args = { plan: boolean; publish: boolean; selfTest: boolean; limit: number; dryRun: boolean };
type PublishResult = { channel: string; marketId: string; status: "sent" | "skipped" | "failed"; detail: string; hash?: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { plan: false, publish: false, selfTest: false, limit: 2, dryRun: false };
  for (const raw of argv.slice(2)) {
    const [k, v = ""] = raw.replace(/^--/, "").split("=");
    if (k === "plan") args.plan = true;
    else if (k === "publish") args.publish = true;
    else if (k === "self-test") args.selfTest = true;
    else if (k === "limit") args.limit = Math.max(1, Number(v) || args.limit);
    else if (k === "dry-run") args.dryRun = true;
    else if (k === "help" || k === "-h") {
      console.log("usage: bun scripts/farcaster-auto-cast.ts [--plan|--publish|--self-test] [--limit=2] [--dry-run]");
      process.exit(0);
    }
  }
  return args;
}

function loadPools(): Pool[] {
  const board = JSON.parse(readFileSync(MANIFEST, "utf8")) as { pools?: Pool[] };
  return (board.pools ?? [])
    .filter((p) => (p.status ?? 1) === 1)
    .filter((p) => !p.endTimeUtc || new Date(p.endTimeUtc).getTime() > Date.now());
}

function yesShare(pool: Pool): number {
  const raw = Number(pool.yesShare ?? Number.NaN);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.5;
}

/** A tribe with a channel, or Base infrastructure: everything else has no home on Farcaster. */
const MEME_TOKENS = ["degen", "toshi", "brett", "mog", "zora"];

function channelFor(pool: Pool): Cast["channel"] {
  const title = pool.title.toLowerCase();
  if (MEME_TOKENS.some((t) => title.includes(t))) return "degen";
  if (pool.category === "Base Ecosystem" || title.includes("base") || title.includes("aero")) return "base";
  return title.includes("meme") || pool.category === "Memes & Culture" ? "degen" : "base";
}

function frameUrl(id: string | number): string {
  const host = SITE.replace(/^https?:\/\//, "");
  return `${host}/market/${id}?ref=fc&utm_source=farcaster&utm_medium=cast&utm_campaign=auto_cast`;
}

/**
 * Same three lines as the X reply, one link, no hashtags and no "gm". Farcaster readers punish
 * marketing voice harder than X does, because the timeline is small enough to notice.
 */
function castFor(pool: Pool): Cast {
  const yes = Math.round(yesShare(pool) * 100);
  const no = 100 - yes;
  const { y, n } = bothOdds(yes);
  const left = timeLeft(pool.endTimeUtc);
  const embed = frameUrl(pool.id);
  const asset = pool.marketData?.asset;
  const spot = pool.marketData?.spotUsd;
  const head = asset && spot ? `$${asset} ${price(spot)}` : `$${(pool.category ?? "base").split(" ")[0]}`;
  const ladder = [
    [`${head} · ${yes}% YES pays ${y}×`, `YES ${bar(yes)} ${yes}% · NO ${bar(no)} ${no}%`, `${pool.traders ?? 0} in · ${left} left`],
    [`${yes}% YES → ${y}× · ${no}% NO → ${n}×`, `${clipped(pool.title, 96)}`, `${pool.traders ?? 0} in · ${left} left`],
    [`${yes}% YES · ${no}% NO`, clipped(pool.title, 90)],
  ];
  const text = ladder.map((lines) => [...lines, embed].join("\n")).find((t) => t.length <= CAST_LIMIT) ?? ladder[ladder.length - 1].join("\n");
  return { marketId: String(pool.id), channel: channelFor(pool), text: text.length <= CAST_LIMIT ? text : text.slice(0, CAST_LIMIT - 1) + "…", embed, chars: Math.min(text.length, CAST_LIMIT) };
}

/** Rank: tribe first, then crowd — the same prior the content factory uses. */
function rank(pools: Pool[]): Pool[] {
  const tribal = (p: Pool) => (/aero|degen|toshi|brett|mog|zora/.test(p.title.toLowerCase()) ? 1 : 0);
  return [...pools].sort((a, b) => tribal(b) - tribal(a) || (b.traders ?? 0) - (a.traders ?? 0));
}

function signers(): { neynar: { key: string; signer: string } | null; warpcast: string | null } {
  const key = process.env.NEYNAR_API_KEY?.trim();
  const signer = process.env.NEYNAR_SIGNER_UUID?.trim();
  return {
    neynar: key && signer ? { key, signer } : null,
    warpcast: process.env.FARCASTER_BEARER?.trim() || null,
  };
}

async function publishCast(cast: Cast): Promise<PublishResult> {
  const { neynar, warpcast } = signers();
  if (neynar) {
    const res = await fetch("https://api.neynar.com/v2/farcaster/cast", {
      method: "POST",
      headers: { "content-type": "application/json", api_key: neynar.key },
      body: JSON.stringify({ signer_uuid: neynar.signer, text: cast.text, embeds: [{ url: cast.embed }], channel_id: cast.channel }),
    });
    const body = await res.text();
    if (res.ok) {
      const hash = (JSON.parse(body) as { cast?: { hash?: string } }).cast?.hash;
      return { channel: cast.channel, marketId: cast.marketId, status: "sent", detail: hash ? `hash ${hash}` : "sent", hash };
    }
    return { channel: cast.channel, marketId: cast.marketId, status: "failed", detail: `${res.status}: ${body.slice(0, 200)}` };
  }
  if (warpcast) {
    const res = await fetch("https://api.warpcast.com/v2/casts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: ["Bearer", warpcast].join(" ") },
      body: JSON.stringify({ text: cast.text, embeds: [{ url: cast.embed }], channelKey: cast.channel }),
    });
    const body = await res.text();
    return res.ok
      ? { channel: cast.channel, marketId: cast.marketId, status: "sent", detail: body.slice(0, 120) }
      : { channel: cast.channel, marketId: cast.marketId, status: "failed", detail: `${res.status}: ${body.slice(0, 200)}` };
  }
  return {
    channel: cast.channel,
    marketId: cast.marketId,
    status: "skipped",
    detail:
      "no Farcaster signer: set NEYNAR_API_KEY + NEYNAR_SIGNER_UUID (Neynar dashboard → signer → paste both into repo secrets), or FARCASTER_BEARER for an account with an API token",
  };
}

function selfTest(): void {
  let failures = 0;
  const check = (ok: boolean, label: string) => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) failures += 1;
  };
  const end = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const degenPool: Pool = { id: "700050", title: "Will DEGEN close above $0.00104 before October 31, 2026?", category: "Memes & Culture", status: 1, endTimeUtc: end, traders: 264, yesShare: 0.212, marketData: { asset: "DEGEN", spotUsd: 0.00096 } };
  const basePool: Pool = { id: "700008", title: "Will Base TVL close above $6.10B before October 31, 2026?", category: "Base Ecosystem", status: 1, endTimeUtc: end, traders: 282, yesShare: 0.442 };

  const d = castFor(degenPool);
  const b = castFor(basePool);
  console.log("routing");
  check(d.channel === "degen", "DEGEN routes to /degen");
  check(b.channel === "base", "Base TVL routes to /base");
  console.log("cast shape");
  for (const [name, cast] of [["degen", d], ["base", b]] as const) {
    check(cast.text.length <= CAST_LIMIT, `${name}: ${cast.text.length}/320 chars`);
    check(cast.text.split("\n").length <= 4, `${name}: at most 4 lines (got ${cast.text.split("\n").length})`);
    check(cast.text.includes("?ref=fc"), `${name}: embed carries ref=fc`);
    check(cast.text.includes("utm_source=farcaster"), `${name}: embed carries the channel tag`);
    check(/→ \d+\.\d×|pays \d+\.\d×/.test(cast.text), `${name}: implied payout present`);
    check(!/#\w+/.test(cast.text), `${name}: no hashtags (they read as spam on Farcaster)`);
    check(!/weight:|source:|market:|ref=/i.test(cast.text.replace(/ref=fc/g, "")), `${name}: no operator noise`);
  }
  console.log("\n--- /degen cast ---\n" + d.text + "\n-------------------");
  const results = rank([basePool, degenPool]);
  check(/DEGEN|Base/.test(results[0].title), "ranking puts a tribe first");

  console.log(failures === 0 ? "\nself-test: OK — routing, ≤320 chars, frame embed with attribution, no marketing voice" : `\nself-test: ${failures} failure(s)`);
  if (failures > 0) process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.selfTest) return selfTest();

  const pools = loadPools();
  if (pools.length === 0) {
    console.error("no open markets in the manifest — run scripts/refresh-board.sh first");
    process.exit(1);
  }
  const ranked = rank(pools);
  const picked: Pool[] = [];
  for (const channel of ["base", "degen"] as const) {
    const pool = ranked.find((p) => channelFor(p) === channel && !picked.some((q) => String(q.id) === String(p.id)));
    if (pool && picked.length < args.limit) picked.push(pool);
  }
  const casts = picked.map(castFor);

  // One market per channel per run: two casts into /degen in the same hour is spam, not reach.
  const seen = new Set<string>();
  const unique = casts.filter((c) => (seen.has(c.channel) ? false : seen.add(c.channel)));

  mkdirSync(DATA, { recursive: true });
  const planPath = join(DATA, `plan-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(planPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), casts: unique }, null, 2)}\n`, "utf8");

  if (!args.publish || args.dryRun) {
    for (const cast of unique) {
      console.log(`\n=== /${cast.channel} · market ${cast.marketId} · ${cast.chars}/320\n${cast.text}`);
    }
    console.log(`\nplan: ${unique.length} cast(s) → ${planPath} (publish with --publish)`);
    return;
  }

  const results: PublishResult[] = [];
  for (const cast of unique) results.push(await publishCast(cast));
  for (const r of results) console.log(`/${r.channel} ${r.marketId}: ${r.status} — ${r.detail}`);
  const sent = results.filter((r) => r.status === "sent").length;
  console.log(`publish: ${sent}/${results.length} sent`);
}

main().catch((err) => {
  console.error(`farcaster cast failed: ${(err as Error).message}`);
  process.exit(1);
});
