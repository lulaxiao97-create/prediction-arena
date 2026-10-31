/**
 * Rebuild the Arena Points ledger from on-chain bets.
 *
 *   bun scripts/sync-points.ts                 # scan, write frontend/public/points.json + docs/points/
 *   bun scripts/sync-points.ts --from-block=N  # start later (a long chain makes this cheap)
 *
 * Why replay the chain instead of a database: BetPlaced already carries the bettor, the stake and
 * the referrer, and it is permanent. A points table can be rebuilt from it at any time, which means
 * the scoreboard cannot be lost, quietly edited, or migrated wrong.
 *
 * Scoring lives in frontend/src/lib/points.ts so the bot, the API and the docs cannot disagree with
 * this script about what a point is.
 */
import { ethers } from "ethers";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { POINT_RULES, POINTS_DISCLAIMER, pointsForBet, referralPoints } from "../frontend/src/lib/points.ts";

const ROOT = join(import.meta.dir, "..");
const OUT_PUBLIC = join(ROOT, "frontend", "public", "points.json");
const OUT_DOC = join(ROOT, "docs", "points", "ledger.json");

const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["\']|["\']$/g, "")];
    }),
);

/**
 * Logs, not calls: `mainnet.base.org` answers eth_getLogs with -32011 "request limit reached" for
 * anything but the smallest windows, so the default is the public node the rest of this repo already
 * uses for log scans. RPC_URL still wins when someone wants their own endpoint.
 */
const RPC = process.env.RPC_URL ?? "https://base-rpc.publicnode.com";
const ARENA = process.env.ARENA_ADDRESS ?? env.ARENA_ADDRESS;
const manifest = JSON.parse(readFileSync(join(ROOT, "frontend", "public", "pools.json"), "utf8")) as {
  deployBlock?: number;
  pools?: { id: string | number; yesShare?: number; endTimeUtc?: string }[];
};
const fromArg = process.argv.find((a) => a.startsWith("--from-block="));
/**
 * The scan window: the whole deployment by default, but capped to the last SEASON_BLOCKS so a
 * replay stays a two-minute job instead of a fifteen-minute one. Points are a season artefact —
 * `--from-block=N` or SEASON_BLOCKS overrides it when the season genuinely starts earlier.
 */
const SEASON_BLOCKS = Number(process.env.SEASON_BLOCKS ?? 200_000);
const deployBlock = Number(manifest.deployBlock ?? 52_921_545);
let FROM = BigInt(fromArg ? fromArg.split("=")[1] : String(deployBlock));
// Base public RPCs cap eth_getLogs well below the 10k block window; 2k keeps every request inside
// it, and the loop halves the window again on a range error instead of failing the whole scan.
let CHUNK = 5_000n;

if (!ethers.isAddress(ARENA)) throw new Error("ARENA_ADDRESS missing/invalid");

const abi = JSON.parse(
  readFileSync(join(ROOT, "artifacts/contracts/PredictionArena.sol/PredictionArena.json"), "utf8"),
).abi;

const pools = new Map<string, { yesShare: number; endTime: number }>();
for (const p of manifest.pools ?? []) {
  const end = p.endTimeUtc ? Date.parse(p.endTimeUtc) : 0;
  pools.set(String(p.id), { yesShare: Number(p.yesShare ?? 0.5), endTime: Number.isFinite(end) ? end : 0 });
}

type Row = { points: number; fromBets: number; fromReferrals: number; bets: number; volumeUsd: number; lastBetAt: string | null };
const ledger = new Map<string, Row>();
const bump = (addr: string, patch: Partial<Row>) => {
  const key = addr.toLowerCase();
  const row = ledger.get(key) ?? { points: 0, fromBets: 0, fromReferrals: 0, bets: 0, volumeUsd: 0, lastBetAt: null };
  ledger.set(key, { ...row, ...patch, points: row.points + (patch.points ?? 0) });
};

const provider = new ethers.JsonRpcProvider(RPC);
const arena = new ethers.Contract(ARENA, abi, provider);
const head = await provider.getBlockNumber();
if (!fromArg) FROM = BigInt(Math.max(Number(FROM), head - SEASON_BLOCKS));
let bets = 0;
let volumeUsd = 0;

let scanned = 0;
for (let from = Number(FROM); from <= head; ) {
  const to = Math.min(from + Number(CHUNK) - 1, head);
  let logs: ethers.Log[] = [];
  let ok = false;
  for (let attempt = 0; attempt < 5 && !ok; attempt += 1) {
    try {
      logs = await arena.queryFilter(arena.filters.BetPlaced(), from, to);
      ok = true;
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (/range|too (many|large)|limit|exceed|coalesce/i.test(msg)) {
        CHUNK = BigInt(Math.max(200, Math.floor(Number(CHUNK) / 2)));
      }
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  if (!ok) {
    console.warn(`skipped ${from}..${to} after 5 attempts (${Number(CHUNK)}-block window)`);
    from += Number(CHUNK);
    continue;
  }
  for (const log of logs) {
    const parsed = arena.interface.parseLog({ topics: log.topics as string[], data: log.data });
    if (!parsed) continue;
    const bettor = String(parsed.args.bettor);
    const poolId = String(parsed.args.poolId);
    const netStake = Number(parsed.args.netStake) / 1e6;
    const referrer = String(parsed.args.referrer ?? ethers.ZeroAddress);
    const meta = pools.get(poolId);
    const block = await provider.getBlock(log.blockNumber).catch(() => null);
    const betAt = (block?.timestamp ?? Math.floor(Date.now() / 1000)) * 1000;
    const hoursToExpiry = meta?.endTime ? Math.max(0, (meta.endTime - betAt) / 3.6e6) : 24 * 30;
    const pts = pointsForBet({ stakeUsd: netStake, yesShare: meta?.yesShare ?? 0.5, hoursToExpiry });
    const when = new Date(betAt).toISOString();

    const row = ledger.get(bettor.toLowerCase());
    bump(bettor, {
      points: pts,
      fromBets: pts,
      bets: 1,
      volumeUsd: netStake,
      lastBetAt: !row?.lastBetAt || row.lastBetAt < when ? when : row.lastBetAt,
    });
    if (referrer && referrer !== ethers.ZeroAddress) {
      const share = referralPoints(pts);
      if (share > 0) bump(referrer, { points: share, fromReferrals: share });
    }
    bets += 1;
    volumeUsd += netStake;
  }
  from = to + 1;
  scanned += 1;
  if (scanned % 10 === 0) console.log(`  … ${from}/${head} (${Number(CHUNK)}-block window)`);
}

const holders = Object.fromEntries(
  [...ledger.entries()]
    .filter(([, v]) => v.points > 0)
    .sort((a, b) => b[1].points - a[1].points)
    .map(([k, v]) => [k, { ...v, volumeUsd: Number(v.volumeUsd.toFixed(2)) }]),
);
const top = Object.entries(holders)
  .slice(0, 200)
  .map(([address, v]) => ({ address, points: v.points }));
const totalPoints = Object.values(holders).reduce((s, v) => s + v.points, 0);

const payload = {
  v: 1,
  generatedAt: new Date().toISOString(),
  rules: POINT_RULES,
  disclaimer: POINTS_DISCLAIMER,
  totals: { wallets: Object.keys(holders).length, points: totalPoints, bets, volumeUsd: Number(volumeUsd.toFixed(2)) },
  holders,
  top,
};

mkdirSync(join(ROOT, "docs", "points"), { recursive: true });
writeFileSync(OUT_PUBLIC, JSON.stringify(payload, null, 2) + "\n");
writeFileSync(OUT_DOC, JSON.stringify(payload, null, 2) + "\n");

console.log(`── arena points ─────────────────────────────`);
console.log(`blocks     : ${FROM}..${head}`);
console.log(`bets       : ${bets} · volume $${volumeUsd.toFixed(2)}`);
console.log(`wallets    : ${Object.keys(holders).length} · points ${totalPoints}`);
console.log(`written    : ${OUT_PUBLIC}`);
if (!existsSync(OUT_DOC)) console.log("(doc copy missing)");
