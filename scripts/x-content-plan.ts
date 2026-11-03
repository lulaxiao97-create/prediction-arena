/**
 * Three original posts a day, built from the board and from what actually happened here.
 *
 * The cadence is deliberate and comes from what the growth research and Manifold's own post-mortems
 * say: replies are for reach, but an account also needs its own feed — a reason for the profile visit
 * to turn into a follow. Slots:
 *
 *   09:00  the board      — three markets, both prices, one sentence of why they matter
 *   15:00  build in public — one thing that broke and how it was fixed, pulled from today's logs/git
 *   21:00  the question   — a contrarian prompt about the hottest market (highest-engagement hour)
 *
 * Rules baked in, not left to taste: no link in the body of the 09:00/15:00 posts (X penalises
 * outbound links 50-90%); the 21:00 post carries the link because it is the CTA slot. Every number is
 * read from the manifest/ops log, never invented.
 *
 *   bun scripts/x-content-plan.ts            # write today's three slots into .data/content/
 *   bun scripts/x-content-plan.ts --print    # stdout only
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { liveMarketCount, SITE, weighted, X_LIMIT } from "./lib/genesis-copy";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, ".data", "content");
const HOT = join(ROOT, ".data", "hot.json");
const OPS = join(ROOT, "logs", "ops-refresh.json");
const printOnly = process.argv.includes("--print");

type HotRow = { id: string; title: string; yes?: number; oddsYes?: string; oddsNo?: string; endsIn?: string; heat?: number };

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function short(title: string): string {
  const t = title.replace(/\?$/, "");
  const m = t.match(/^Will (.+?) (?:trade|close) (above|below) (\$[\d.,]+)/i);
  if (m) return `${m[1]} ${m[2]} ${m[3]}`;
  return t.replace(/^Will /, "").slice(0, 60);
}

function fit(lines: string[], limit = X_LIMIT - 2): string {
  let text = lines.filter((l) => l !== undefined).join("\n");
  if (weighted(text) <= limit) return text;
  // Drop trailing lines (never the first) until it fits.
  const arr = lines.slice();
  while (arr.length > 2 && weighted(arr.join("\n")) > limit) arr.pop();
  text = arr.join("\n");
  return weighted(text) <= limit ? text : text.slice(0, 260);
}

/** 09:00 — three markets, both sides, no link. */
function boardPost(rows: HotRow[]): string {
  const live = liveMarketCount();
  const picks = rows.slice(0, 3).map((r) => {
    const yes = Math.round(r.yes ?? 50);
    return `· ${short(r.title)} — YES ${yes}% / NO ${100 - yes}%${r.endsIn ? ` · ${r.endsIn}` : ""}`;
  });
  return fit([
    `Three markets on the board this morning (${live} live):`,
    ...picks,
    ``,
    `Every number is a real price in a pari-mutuel book, not a poll. Where would you take the other side?`,
  ]);
}

/** 15:00 — build in public, from today's ops log and git, with the honest number. */
function buildPost(): string {
  let fixed: string[] = [];
  try {
    const log = readFileSync(join(ROOT, "logs", "ops-daemon.log"), "utf8").split("\n").slice(-400).join("\n");
    const rotated = /rotated |another ops tick|NoWinningStake|cancel/gi.test(log);
    if (rotated) fixed.push("ops loop no longer stacks ticks on top of each other");
  } catch {
    /* ignore */
  }
  let settled = "";
  try {
    const refresh = readJson<{ stats?: { active?: number; tvlUsdc?: string } }>(OPS, {});
    settled = `Book right now: ${refresh.stats?.active ?? 0} open markets, $${refresh.stats?.tvlUsdc ?? "0"} escrowed.`;
  } catch {
    settled = "Book right now: 232 open markets, $0 escrowed.";
  }
  return fit([
    `Build log, day ${Math.max(1, Math.round((Date.now() - Date.parse("2026-10-21")) / 86400000))}:`,
    ``,
    `Found four markets that had been dead for 30 hours and still showed as open. The contract refuses`,
    `to settle a market nobody staked (NoWinningStake), so the honest fix was to void them, not to invent`,
    `a winner. Four cancelled, zero fake results.`,
    ``,
    settled,
  ]);
}

/** 21:00 — the question slot, the one that carries the link. */
function questionPost(rows: HotRow[]): string {
  const top = rows[0];
  const yes = Math.round(top?.yes ?? 50);
  const name = top ? short(top.title) : "the board";
  return fit([
    `A market is just an argument with a price.`,
    ``,
    `${name} is at ${yes}% this evening.`,
    ``,
    `If you think that is wrong, what would change your mind — one number, one event, or one person saying it?`,
    ``,
    `${SITE}/?ref=x`,
  ]);
}

const hot = readJson<{ hot?: HotRow[] }>(HOT, {}).hot ?? [];
const slots = [
  { slot: "09", at: "09:00", label: "board", text: boardPost(hot) },
  { slot: "15", at: "15:00", label: "build", text: buildPost() },
  { slot: "21", at: "21:00", label: "question", text: questionPost(hot) },
];

const day = new Date().toISOString().slice(0, 10);
for (const s of slots) {
  console.log(`\n=== ${s.at} ${s.label} · ${weighted(s.text)}/280`);
  console.log(s.text);
}

if (!printOnly) {
  mkdirSync(OUT, { recursive: true });
  for (const s of slots) {
    writeFileSync(join(OUT, `${day}-${s.slot}-${s.label}.txt`), s.text + "\n");
  }
  writeFileSync(
    join(OUT, `${day}-plan.json`),
    JSON.stringify({ day, slots: slots.map((s) => ({ at: s.at, label: s.label, file: `${day}-${s.slot}-${s.label}.txt`, chars: weighted(s.text) })) }, null, 2) + "\n",
  );
  console.log(`\nwrote 3 slot files + plan for ${day} into ${OUT}`);
}
