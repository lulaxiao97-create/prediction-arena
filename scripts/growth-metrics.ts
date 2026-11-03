/**
 * Growth metrics — one line per hour, so "did it work" is a number and not a feeling.
 *
 * Reads the public fxtwitter profile endpoint (no auth, no API quota): followers, following, posts.
 * Appends to .data/growth.jsonl and prints the delta since the previous sample. Cron runs it hourly;
 * `--since=<ISO date>` prints the total movement in that window.
 *
 *   bun scripts/growth-metrics.ts            # sample + delta
 *   bun scripts/growth-metrics.ts --report   # last 24h summary from the file
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const FILE = join(ROOT, ".data", "growth.jsonl");
const HANDLE = process.env.GROWTH_HANDLE ?? "Predict065";
const ENDPOINT = `https://api.fxtwitter.com/${HANDLE}`;

type Sample = { at: string; followers: number; following: number; posts: number };

function curl(url: string): string | null {
  try {
    const p = Bun.spawnSync(["curl", "-s", "-m", "20", "-A", "Mozilla/5.0", url], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
    return p.exitCode === 0 ? p.stdout.toString() : null;
  } catch {
    return null;
  }
}

function readAll(): Sample[] {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as Sample;
      } catch {
        return null;
      }
    })
    .filter((x): x is Sample => Boolean(x));
}

if (process.argv.includes("--report")) {
  const rows = readAll();
  if (!rows.length) {
    console.log("no samples yet");
    process.exit(0);
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  const hours = Math.max(1, Math.round((Date.parse(last.at) - Date.parse(first.at)) / 3600_000));
  console.log(`${HANDLE}: ${first.followers} → ${last.followers} followers in ${hours}h (+${last.followers - first.followers})`);
  console.log(`posts ${first.posts} → ${last.posts} · following ${first.following} → ${last.following}`);
  for (const r of rows.slice(-6)) console.log(`  ${r.at}  followers=${r.followers} posts=${r.posts}`);
  process.exit(0);
}

const body = curl(ENDPOINT);
if (!body) {
  console.log("metrics: fetch failed (mirror or network)");
  process.exit(1);
}
let user: { followers?: number; following?: number; tweets?: number } | undefined;
try {
  const parsed = JSON.parse(body) as { code?: number; user?: { followers?: number; following?: number; tweets?: number } };
  if (parsed.code !== 200 || !parsed.user) throw new Error(`code ${parsed.code}`);
  user = parsed.user;
} catch (e) {
  // Never write a zero sample on a bad fetch: a false "followers 3 -> 0" in the series is worse than a
  // gap, and it makes the dashboard look like the account died.
  console.log(`metrics: skipped (${(e as Error).message})`);
  process.exit(1);
}

const sample: Sample = {
  at: new Date().toISOString(),
  followers: Number(user.followers ?? 0),
  following: Number(user.following ?? 0),
  posts: Number(user.tweets ?? 0),
};
const prev = readAll().pop();
mkdirSync(join(ROOT, ".data"), { recursive: true });
appendFileSync(FILE, `${JSON.stringify(sample)}\n`);

const d = prev ? sample.followers - prev.followers : 0;
console.log(
  `followers=${sample.followers} (${d >= 0 ? "+" : ""}${d} since ${prev?.at ?? "start"}) posts=${sample.posts} following=${sample.following}`,
);
