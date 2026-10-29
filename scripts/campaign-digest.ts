/**
 * One-click distribution kit for the copy the cloud already generated.
 *
 * The X API is a paid gate we do not pay; the copy factory is not. Every run of
 * `auto-market.ts --write --send` archives its output to `docs/campaigns/<YYYY-MM-DD>/index.json`
 * and commits it, so the newest campaign is always in the repo. This script turns that into
 * something a human can paste without opening an editor:
 *
 *   bun scripts/campaign-digest.ts                     # newest local archive, every channel
 *   bun scripts/campaign-digest.ts --remote            # newest archive from GitHub (no local run)
 *   bun scripts/campaign-digest.ts --channel=x         # only the tweet
 *   bun scripts/campaign-digest.ts --market=700011     # one market
 *   bun scripts/campaign-digest.ts --day=2026-10-29    # a specific day
 *   bun scripts/campaign-digest.ts --md                # weekly calendar table
 *   bun scripts/campaign-digest.ts --json              # pipe into something else
 *
 * What it will not do: post anything. "Zero-budget distribution" means a human pastes into the app
 * or a group chat, and the archive is the source of truth for what the numbers were at the time.
 * Copy is printed verbatim from the archive — re-formatting it here would mean two versions of the
 * same tweet, and the archived one is the one with the audit trail.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CAMPAIGNS = join(ROOT, "docs", "campaigns");
const REPO = process.env.CAMPAIGN_REPO ?? "lulaxiao97-create/prediction-arena";
const BRANCH = process.env.CAMPAIGN_BRANCH ?? "main";

type Post = {
  id: string | number;
  title: string;
  pick: string;
  tweet: string;
  tweetWeight: number;
  cast: string;
  castChars: number;
  telegram: string;
  links?: { x?: string; farcaster?: string; telegram?: string };
  tribal?: { base: number; adaptive: number; total: number; leader: string | null };
  generatedAt?: string;
};

type Archive = { day: string; posts: Post[] };

type Args = {
  day: string | null;
  market: string | null;
  channel: "all" | "x" | "cast" | "telegram";
  remote: boolean;
  json: boolean;
  md: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { day: null, market: null, channel: "all", remote: false, json: false, md: false };
  for (const raw of argv.slice(2)) {
    const [key, value = ""] = raw.replace(/^--/, "").split("=");
    if (key === "day") args.day = value;
    else if (key === "market") args.market = value;
    else if (key === "channel" && ["all", "x", "cast", "telegram"].includes(value)) {
      args.channel = value as Args["channel"];
    } else if (key === "remote") args.remote = true;
    else if (key === "json") args.json = true;
    else if (key === "md") args.md = true;
    else if (key === "help" || key === "-h") {
      console.log(
        "usage: bun scripts/campaign-digest.ts [--day=YYYY-MM-DD] [--market=<id>] [--channel=all|x|cast|telegram] [--remote] [--md] [--json]",
      );
      process.exit(0);
    }
  }
  return args;
}

function daysLocal(): string[] {
  try {
    return readdirSync(CAMPAIGNS)
      .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
      .filter((name) => statSync(join(CAMPAIGNS, name)).isDirectory())
      .sort();
  } catch {
    return [];
  }
}

function readLocal(day: string): Archive {
  const path = join(CAMPAIGNS, day, "index.json");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Archive;
  return { day: parsed.day ?? day, posts: parsed.posts ?? [] };
}

async function readRemote(day: string): Promise<Archive> {
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/docs/campaigns/${day}/index.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const parsed = (await res.json()) as Archive;
  return { day: parsed.day ?? day, posts: parsed.posts ?? [] };
}

function isoDay(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Newest archive that actually exists. Cloud runs can miss a day; never guess a path. */
async function resolve(args: Args): Promise<Archive> {
  if (args.day) return args.remote ? readRemote(args.day) : readLocal(args.day);

  if (!args.remote) {
    const days = daysLocal();
    if (days.length === 0) throw new Error(`no archives under ${CAMPAIGNS}`);
    return readLocal(days[days.length - 1]);
  }

  let lastError: unknown = null;
  for (let back = 0; back < 4; back += 1) {
    const day = isoDay(-back);
    try {
      return await readRemote(day);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`no cloud archive in the last 4 days (${(lastError as Error)?.message ?? "unknown"})`);
}

function rule(label: string): string {
  return `\n${"─".repeat(72)}\n${label}\n${"─".repeat(72)}`;
}

function block(post: Post, channel: Args["channel"]): string {
  const parts: string[] = [];
  const head = `market ${post.id}${post.tribal ? ` · tribal ${post.tribal.total}` : ""} · ${post.title}`;
  parts.push(rule(head));
  if (channel === "all" || channel === "x") {
    parts.push(`[X · ${post.tweetWeight}/280 weighted — paste as-is, the link carries ref=x]`);
    parts.push(post.tweet);
  }
  if (channel === "all" || channel === "cast") {
    parts.push(`[FARCASTER · ${post.castChars}/320 — needs a Warpcast signer; copy this one by hand]`);
    parts.push(post.cast);
  }
  if (channel === "all" || channel === "telegram") {
    parts.push("[TELEGRAM · the bot already posts this one; re-use it for a group chat verbatim]");
    parts.push(post.telegram);
  }
  return parts.join("\n");
}

function markdown(archive: Archive): string {
  const rows = archive.posts
    .map((p) => {
      const x = p.links?.x ?? "";
      return `| ${p.id} | ${p.title.replace(/\|/g, "\\|")} | ${p.pick} | ${p.tweetWeight}/280 | ${p.castChars}/320 | ${p.tribal?.total ?? "—"} | ${x ? `[link](${x})` : "—"} |`;
    })
    .join("\n");
  return [
    `# Marketing calendar — ${archive.day}`,
    "",
    `Source: \`docs/campaigns/${archive.day}/index.json\` (archived by \`scripts/auto-market.ts --write\`).`,
    "",
    "| Market | Title | Pick | X | Cast | tribal | Link |",
    "|---|---|---|---|---|---|---|",
    rows,
    "",
    "Distribution is manual by design: the X API is a paid gate, so a human pastes these into the app,",
    "a group chat, or a DM. Every link carries `utm_*` + `ref=` — that is what shows up in",
    "`/api/growth/summary` once the referred position lands on-chain.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const archive = await resolve(args);
  let posts = archive.posts;
  if (args.market) posts = posts.filter((p) => String(p.id) === args.market);
  if (posts.length === 0) throw new Error(`no posts for market ${args.market} in ${archive.day}`);

  if (args.json) {
    console.log(JSON.stringify({ day: archive.day, source: args.remote ? "remote" : "local", posts }, null, 2));
    return;
  }
  if (args.md) {
    console.log(markdown({ day: archive.day, posts }));
    return;
  }

  console.log(
    `\nPrediction Arena — distribution kit · ${archive.day} · ${posts.length} market(s) · source=${args.remote ? "github" : "local archive"}`,
  );
  console.log("Paste → post → the link attributes itself. Nothing here is auto-posted.");
  for (const post of posts) console.log(block(post, args.channel));
  console.log(
    `\n${"─".repeat(72)}\nReminder: the copy is archived verbatim. If a number looks stale, the board moved — rerun\nscripts/auto-market.ts --write instead of editing the tweet by hand.\n`,
  );
}

main().catch((err) => {
  console.error(`campaign-digest failed: ${(err as Error).message}`);
  process.exit(1);
});
