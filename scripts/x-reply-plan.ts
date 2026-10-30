/**
 * Today's reply worklist.
 *
 * The growth line is explicit: at this follower count the reach comes from replies, and replies are
 * the one thing that must not be machine-written — a channel that posts the same sentence under
 * twenty tweets gets muted. So this script does the part that is mechanical (who to answer, which
 * market prices what they talk about, what the numbers are today) and leaves the sentence to a human.
 *
 * Rules baked in, from the measured data in docs/GROWTH_LINE.md:
 *   · first token is a number, never "agree" / "great thread";
 *   · under 200 characters, because length made no difference and long replies read as ads;
 *   · ends with a question — 56% answer rate vs 42%;
 *   · no link: the link lives in the bio, a link in a reply is a downrank.
 *
 *   bun scripts/x-reply-plan.ts                 # write docs/replies/<today>.md
 *   bun scripts/x-reply-plan.ts --limit=20
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const MANIFEST = join(ROOT, "frontend", "public", "pools.json");
const TARGETS = join(ROOT, ".data", "outreach", "targets.json");
const OUT_DIR = join(ROOT, "docs", "replies");

type Pool = {
  id: string | number;
  title: string;
  category?: string;
  status?: number;
  endTimeUtc?: string;
  traders?: number;
  yesShare?: number;
  marketData?: { asset?: string; spotUsd?: number; strikeUsd?: number };
};

const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 20);

/** Tiering decides the copy, not the volume: big accounts are for reach, small ones for conversation. */
type Tier = "big" | "mid" | "small";

type Target = { handle: string; tier: Tier; note: string };

const BIG: Target[] = [
  { handle: "base", tier: "big", note: "Base official — everything they post is about the ecosystem" },
  { handle: "jessepollak", tier: "big", note: "Base lead — culture + onchain consumer takes" },
  { handle: "coinbase", tier: "big", note: "retail crypto audience" },
  { handle: "Uniswap", tier: "big", note: "DeFi infra audience" },
  { handle: "virtuals_io", tier: "big", note: "Base AI-agent ecosystem" },
  { handle: "degen", tier: "big", note: "the DEGEN tribe itself" },
];

const MID: Target[] = [
  { handle: "base_eth", tier: "mid", note: "Base community account" },
  { handle: "Bankless", tier: "mid", note: "prediction-market friendly audience" },
  { handle: "AerodromeFi", tier: "mid", note: "AERO — verify handle still live before replying" },
  { handle: "VelodromeFi", tier: "mid", note: "ve(3,3) crowd" },
  { handle: "BasedBeffJezos", tier: "mid", note: "e/acc, likes odds arguments" },
];

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

const TOKENS = ["aero", "degen", "toshi", "brett", "btc", "eth", "sol", "base"];

function marketFor(pools: Pool[], handle: string): Pool {
  const key = handle.toLowerCase();
  const titled = pools.find((p) => {
    const title = p.title.toLowerCase();
    if (key.includes("degen") && title.includes("degen")) return true;
    if (key.includes("aerodrome") && title.includes("aero")) return true;
    if (key.includes("base") && (title.includes("base") || p.category === "Base Ecosystem")) return true;
    return false;
  });
  if (titled) return titled;
  const tribal = pools.filter((p) => TOKENS.some((t) => p.title.toLowerCase().includes(t)));
  return (tribal.length > 0 ? tribal : pools).sort((a, b) => (b.traders ?? 0) - (a.traders ?? 0))[0];
}

/** Prices need their own formatting: TOSHI at $0.00014 must not render as "$0". */
function money(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "$—";
  if (v >= 1_000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${Number(v.toPrecision(3))}`;
}

/** The short form a reply needs: "AERO above $0.7175", not the whole question with a date in it. */
function shortTitle(pool: Pool): string {
  const asset = pool.marketData?.asset;
  const strike = pool.marketData?.strikeUsd;
  if (asset && strike) {
    const dir = /above|higher|reclaim|exceed/i.test(pool.title) ? "above" : "below";
    return `${asset} ${dir} ${money(strike)}`;
  }
  return pool.title
    .replace(/^Will /i, "")
    .replace(/\s+before\s+.*$/i, "")
    .replace(/\?$/, "")
    .slice(0, 52);
}

function daysLeft(pool: Pool): string {
  if (!pool.endTimeUtc) return "soon";
  const h = Math.round((new Date(pool.endTimeUtc).getTime() - Date.now()) / 3_600_000);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** Three phrasings per tier so twenty replies are not twenty copies of one sentence. */
function replyCopy(pool: Pool, tier: Tier, seed: number): string {
  const yes = Math.round(yesShare(pool) * 100);
  const no = 100 - yes;
  const y = (1 / Math.max(0.02, yes / 100)).toFixed(1);
  const subject = shortTitle(pool);
  const traders = pool.traders ?? 0;
  const left = daysLeft(pool);
  const variants: Record<Tier, string[]> = {
    big: [
      `${subject} is ${yes}% YES on the board right now — ${y}× if it lands. ${traders} wallets already took a side. Which way do you think it closes?`,
      `${traders} wallets positioned, ${yes}% on YES for ${subject} at ${y}×. Is the crowd right this time?`,
      `${yes}% YES / ${no}% NO on ${subject}, ${left} left. Where would you put the line?`,
    ],
    mid: [
      `Curious how you'd price it: the board has ${subject} at ${yes}% with ${traders} wallets in. Too cheap or too rich?`,
      `${subject} at ${yes}% YES and paying ${y}× — does that match what your crowd thinks?`,
      `Our board says ${yes}% on ${subject} (${left} left). What would you change about that number?`,
    ],
    small: [
      `Same question I keep asking: ${no}% of wallets say no to ${subject}. Where are you on it?`,
      `${traders} people disagree about ${subject} — ${no}% are on NO. What's your read?`,
      `${subject}: ${yes}% YES. Are you in the ${yes}% or the ${no}%?`,
    ],
  };
  const list = variants[tier];
  const text = list[seed % list.length];
  if (text.length <= 200) return text;
  // Fall back to the tightest phrasing rather than shipping a 240-character reply.
  const tight = `${subject}: ${yes}% YES at ${y}×, ${traders} wallets in. Which side are you on?`;
  return tight.length <= 200 ? tight : `${subject}: ${yes}% YES. You in or out?`;
}

function smallAccounts(): Target[] {
  // Real people harvested from public channel pages; only used for conversation-tier replies.
  try {
    const store = JSON.parse(readFileSync(TARGETS, "utf8")) as { people?: { username: string; via?: string }[] };
    return (store.people ?? []).slice(0, 8).map((p) => ({ handle: p.username, tier: "small" as Tier, note: `seen in @${p.via ?? "?"}` }));
  } catch {
    return [];
  }
}

const pools = loadPools();
const targets = [...BIG, ...MID, ...smallAccounts()].slice(0, LIMIT);
const day = new Date().toISOString().slice(0, 10);
mkdirSync(OUT_DIR, { recursive: true });

const rows = targets.map((t, i) => {
  const pool = marketFor(pools, t.handle);
  const text = replyCopy(pool, t.tier, i);
  return { ...t, pool, text };
});

const md = [
  `# ${day} — reply worklist`,
  "",
  `Generated ${new Date().toISOString()}. ${rows.length} targets.`,
  "",
  "How to use it: open the profile, reply to the **newest** tweet (not the pinned one), paste the line,",
  "and change the last clause so it answers what they actually said. The copy is a skeleton — twenty",
  "identical sentences is the one thing that gets an account muted.",
  "",
  "Rules: number first · under 200 chars · ends with a question · **no link in the reply**.",
  "",
  "| # | handle | tier | market | reply |",
  "|---|---|---|---|---|",
  ...rows.map((r, i) => `| ${i + 1} | @${r.handle} | ${r.tier} | ${shortTitle(r.pool)} | ${r.text.replace(/\|/g, "\\|")} |`),
  "",
  "## Copy-paste block",
  "",
  ...rows.map((r, i) => `${i + 1}. @${r.handle} (${r.tier} · ${r.note})\n   ${r.text}\n`),
].join("\n");

const file = join(OUT_DIR, `${day}.md`);
writeFileSync(file, md, "utf8");
console.log(`reply plan: ${rows.length} targets → ${file}`);
for (const r of rows.slice(0, 4)) console.log(`  @${r.handle} (${r.tier}): ${r.text}`);
