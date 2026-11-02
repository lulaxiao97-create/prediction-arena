/**
 * Hot board — the 15-minute heartbeat of the acquisition engine.
 *
 * Reads the live manifest, ranks the 232 markets with the same heat model the desktop pack uses
 * (`scripts/lib/hot.ts`), and writes two artifacts:
 *
 *   .data/hot.json   machine-readable top 5 (id, lane, odds, deadline, tracked URL)
 *   .data/hot-5.txt  paste-ready: five replies, one per lane, each ending in the airdrop hook
 *
 * It deliberately does NOT talk to X. Reading X from this host is blocked (datacenter IP → 403,
 * nitter mirrors dead, no API credits — see `active-x-interceptor.ts --probe`), and pretending
 * otherwise is how a "24/7 monitor" becomes a cron job that logs successes it never had. What this
 * loop can honestly do is keep the material ready and current, so a human — or the desktop pack —
 * posts the right market within minutes of opening the folder.
 *
 *   bun scripts/hot-board.ts            # write the artifacts, print the top 5
 *   bun scripts/hot-board.ts --json     # stdout only (for the daemon's status line)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bar, bothOdds, shortTrackedUrl, timeLeft, weight } from "./lib/copy-kit";
import { heatScore, pickContrarian, shareOf, type HotPool } from "./lib/hot";

const ROOT = join(import.meta.dir, "..");
const MANIFEST = join(ROOT, "frontend", "public", "pools.json");
const DATA = join(ROOT, ".data");
const JSON_OUT = join(DATA, "hot.json");
const TEXT_OUT = join(DATA, "hot-5.txt");
const HOOK = "🎁 Bet now — every $1 earns genesis $ARENA points (1:1 at launch)";

type Pool = HotPool & { title: string; status?: number; endTimeUtc?: string };

function load(): Pool[] {
  const board = JSON.parse(readFileSync(MANIFEST, "utf8")) as { pools?: Pool[] };
  return (board.pools ?? []).filter((p) => (p.status ?? 1) === 1);
}

function main(): void {
  const pools = load();
  if (!pools.length) {
    console.error("hot-board: no open markets in the manifest");
    process.exit(1);
  }
  const picks = pickContrarian(pools, 5);
  const now = new Date().toISOString();
  const rows = picks.map((pool, i) => {
    const yes = Math.round(shareOf(pool) * 100);
    const { y, n } = bothOdds(yes);
    const duel = `YES ${bar(yes)} ${yes}% → ${y}× · NO ${bar(100 - yes)} ${100 - yes}% → ${n}×`;
    const url = shortTrackedUrl(pool.id, "x");
    const left = timeLeft(pool.endTimeUtc);
    const text = [`${pool.title}`, duel, `${url} · ${left} left`, HOOK].join("\n");
    return {
      rank: i + 1,
      id: pool.id,
      title: pool.title,
      lane: pool.category ?? "other",
      yes,
      oddsYes: y,
      oddsNo: n,
      endsIn: left,
      heat: Math.round(heatScore(pool)),
      url,
      weight: weight(text),
      text: weight(text) <= 275 ? text : [duel, url, HOOK].join("\n"),
    };
  });

  mkdirSync(DATA, { recursive: true });
  writeFileSync(
    JSON_OUT,
    `${JSON.stringify({ generatedAt: now, source: "frontend/public/pools.json", count: rows.length, hot: rows.map(({ text, ...r }) => r) }, null, 2)}\n`,
  );
  writeFileSync(
    TEXT_OUT,
    [
      `# hot board · ${now}`,
      "# five lanes, one reply each — paste, do not rewrite the numbers",
      "",
      ...rows.map((r) => `## ${r.rank} · ${r.lane} · heat ${r.heat} · ${r.weight}/280\n${r.text}\n`),
    ].join("\n"),
  );

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ generatedAt: now, count: rows.length, top: rows[0]?.title ?? null }));
    return;
  }
  console.log(`hot board · ${now}`);
  for (const r of rows) console.log(`  ${r.rank}. [${r.lane}] ${r.title} · heat ${r.heat} · ${r.weight}/280`);
  console.log(`written: ${JSON_OUT}\n         ${TEXT_OUT}`);
}

main();
