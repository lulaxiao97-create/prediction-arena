/**
 * Settlement receipts.
 *
 * This is the only content that builds trust: an odds account that never shows what happened is a
 * horoscope. The rule this script enforces is simple and absolute — a receipt is written from the
 * manifest's settled state only. If nothing has settled, nothing is posted, and the run says so.
 *
 * What it produces per settled market:
 *
 *   SETTLED: Will AERO close above $0.7250 before Oct 31? → NO
 *   The 11% side just lost; NO paid 1.1×. Final line before close: 11% YES.
 *   Next up: <the liveliest open market>
 *
 *   bun scripts/x-settlement-post.ts             # write receipts for new settlements
 *   bun scripts/x-settlement-post.ts --post      # …and post them with x_post_gui.ps1
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const MANIFEST = join(ROOT, "frontend", "public", "pools.json");
const STATE = join(ROOT, ".data", "settlements.json");
const OUT = join(ROOT, "docs", "settlements");
const POST = process.argv.includes("--post");

type Pool = {
  id: string | number;
  title: string;
  status?: number;
  endTimeUtc?: string;
  traders?: number;
  yesShare?: number;
  /** Present once ops-refresh has read the settlement off-chain. */
  outcome?: "YES" | "NO" | string;
  resolvedAt?: string;
  marketData?: { asset?: string; strikeUsd?: number };
};

type State = { posted: Record<string, { at: string; text: string; id?: string }> };

const board = JSON.parse(readFileSync(MANIFEST, "utf8")) as { pools?: Pool[] };
const pools = board.pools ?? [];
const settled = pools.filter((p) => p.status === 2);
const open = pools.filter((p) => (p.status ?? 1) === 1);

if (settled.length === 0) {
  console.log(
    `settlements: none. ${open.length} markets open, 0 settled — a receipt is only written from a real settlement, never from an expired countdown.`,
  );
  process.exit(0);
}

const state: State = existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as State) : { posted: {} };
const fresh = settled.filter((p) => !state.posted[String(p.id)]);

if (fresh.length === 0) {
  console.log(`settlements: ${settled.length} settled, all already receipted`);
  process.exit(0);
}

function money(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "$—";
  if (v >= 1_000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${Number(v.toPrecision(3))}`;
}

function short(pool: Pool): string {
  const asset = pool.marketData?.asset;
  const strike = pool.marketData?.strikeUsd;
  if (asset && strike) return `${asset} ${/above|higher|reclaim/i.test(pool.title) ? "above" : "below"} ${money(strike)}`;
  return pool.title.replace(/^Will /i, "").replace(/\?$/, "").slice(0, 64);
}

const next = [...open].sort((a, b) => (b.traders ?? 0) - (a.traders ?? 0))[0];

mkdirSync(OUT, { recursive: true });
mkdirSync(join(ROOT, ".data"), { recursive: true });

const written: string[] = [];
for (const pool of fresh) {
  if (!pool.outcome) {
    // Settled on-chain but the outcome has not been read back into the manifest: say that instead of
    // guessing which side won.
    console.log(`  ! market ${pool.id} is settled but carries no outcome — skipped until ops refresh reads it`);
    continue;
  }
  const yes = Math.round((Number(pool.yesShare ?? 0.5) || 0.5) * 100);
  const winner = String(pool.outcome).toUpperCase() === "YES" ? "YES" : "NO";
  const winnerShare = winner === "YES" ? yes : 100 - yes;
  const payout = (1 / Math.max(0.02, winnerShare / 100)).toFixed(1);
  const losers = winner === "YES" ? 100 - yes : yes;

  const text = [
    `SETTLED: ${short(pool)} → ${winner}`,
    "",
    `The ${losers}% side just lost. ${winner} paid ${payout}× at the final line.`,
    next ? `Next: ${short(next)} — ${Math.round((Number(next.yesShare ?? 0.5) || 0.5) * 100)}% YES, ${next.traders ?? 0} wallets in.` : "",
    "",
    "https://predictionarena.online",
    "@Predict065",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const file = join(OUT, `${pool.id}.txt`);
  writeFileSync(file, `${text}\n`, "utf8");
  state.posted[String(pool.id)] = { at: new Date().toISOString(), text };
  written.push(file);
  console.log(`  ✓ receipt for ${pool.id} → ${file}`);
}

writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
console.log(`settlements: ${written.length} receipt(s) written`);

if (POST && written.length > 0) {
  const ps = process.env.POWERSHELL ?? "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
  for (const file of written) {
    const win = file.replace(/^\/mnt\/([a-z])\//, (_m, d: string) => `${d.toUpperCase()}:\\`).replace(/\//g, "\\");
    const proc = Bun.spawnSync({
      cmd: [ps, "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "scripts", "x_post_gui.ps1"), "-TextFile", win],
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = new TextDecoder().decode(proc.stdout).trim();
    console.log(`  post ${file}: ${out.split("\n").pop()}`);
  }
}
