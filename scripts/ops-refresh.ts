/**
 * Ops refresh: the daemon's read-side job.
 *
 * Recomputes what the UI shows from on-chain state instead of trusting the last write:
 *   · per-pool probability, net pool, and 24h notional (from recent Bet events)
 *   · aggregate TVL / active / settled counters
 *   · a list of pools that ended but were never settled, so a human (or a future auto-oracle)
 *     can act on them — this script never settles anything by itself, because settlement is a
 *     claim about the world, not a piece of housekeeping.
 *
 *   npx hardhat run scripts/ops-refresh.ts --network base
 *   npx hardhat run scripts/ops-refresh.ts --network localhost
 */
import { ethers, network } from "hardhat";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const POOLS_JSON = join(ROOT, "frontend", "public", "pools.json");
const OUT = join(ROOT, "logs", "ops-refresh.json");

type Entry = {
  id: string;
  title?: string;
  category?: string;
  status?: number;
  endTime?: number;
  probability?: number;
  volume24hUsdc?: string | null;
  [k: string]: unknown;
};

async function main() {
  const [signer] = await ethers.getSigners();
  const arenaAddress = (process.env.ARENA_ADDRESS ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(arenaAddress)) throw new Error("ARENA_ADDRESS missing in .env");

  const arena = await ethers.getContractAt("PredictionArena", arenaAddress, signer);
  const net = await ethers.provider.getNetwork();
  const head = await ethers.provider.getBlockNumber();

  // discover pools: manifest first (cheap), then any PoolCreated we can see in the recent window
  let manifest: { pools?: Entry[]; address?: string; stats?: unknown; [k: string]: unknown } = {};
  if (existsSync(POOLS_JSON)) {
    try {
      manifest = JSON.parse(readFileSync(POOLS_JSON, "utf8"));
    } catch {
      console.warn("pools.json unreadable — continuing with event discovery only");
    }
  }
  const ids = new Set<string>((manifest.pools ?? []).map((p) => String(p.id)));

  // the daemon's own most recent write is the cheapest reliable source of "a pool I just opened"
  const statePath = join(ROOT, "logs", "pool-state.json");
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, "utf8")) as { poolId?: string };
      if (state.poolId) ids.add(String(state.poolId));
    } catch {
      /* ignore */
    }
  }

  const deployBlock = Number(process.env.NEXT_PUBLIC_ARENA_DEPLOY_BLOCK ?? 0) || Math.max(0, head - 45_000);
  try {
    const logs = await arena.queryFilter(arena.filters.PoolCreated(), deployBlock, head);
    for (const log of logs) {
      const parsed = "args" in log ? (log.args as unknown as { poolId?: bigint }) : undefined;
      if (parsed?.poolId !== undefined) ids.add(String(parsed.poolId));
    }
  } catch (err) {
    console.warn(`event discovery skipped (${(err as Error).message.slice(0, 80)}) — manifest only`);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const stale: { id: string; title: string; endedHoursAgo: number }[] = [];
  const rows: Record<string, unknown>[] = [];
  let tvl = 0n;
  let active = 0;
  let settled = 0;

  for (const id of ids) {
    const pid = BigInt(id);
    let pool: Awaited<ReturnType<typeof arena.getPool>>;
    try {
      pool = await arena.getPool(pid);
    } catch {
      continue; // demo ids live only in the manifest
    }
    const status = Number(pool.status);
    const total = pool.totalNetPool as bigint;

    if (status === 1) {
      active += 1;
      tvl += total;
      if (Number(pool.endTime) < nowSec) {
        stale.push({
          id,
          title: String(pool.title ?? ""),
          endedHoursAgo: Math.round((nowSec - Number(pool.endTime)) / 3600),
        });
      }
    } else if (status === 2) {
      settled += 1;
    }

    // 24h notional: sum of Bet amounts in the last 24h (best-effort; RPCs limit ranges)
    let volume: bigint | null = null;
    try {
      const fromBlock = Math.max(deployBlock, head - 2_000);
      const bets = await arena.queryFilter(arena.filters.BetPlaced(pid), fromBlock, head);
      let sum = 0n;
      for (const b of bets) {
        const ts = (await ethers.provider.getBlock(b.blockNumber))?.timestamp ?? 0;
        if (nowSec - Number(ts) <= 86_400) {
          const args = (b as unknown as { args?: { amount?: bigint } }).args;
          sum += args?.amount ?? 0n;
        }
      }
      volume = sum;
    } catch {
      volume = null; // rate-limited RPC → leave unknown rather than lie with 0
    }

    const side0 = (pool.option0Pool ?? 0n) as bigint;
    rows.push({
      id,
      title: pool.title,
      category: pool.category,
      status,
      endTime: Number(pool.endTime),
      netPoolUsdc: ethers.formatUnits(total, 6),
      probability: total > 0n ? Number((side0 * 10_000n) / total) / 100 : 50,
      volume24hUsdc: volume === null ? null : ethers.formatUnits(volume, 6),
    });
  }

  // write back into the manifest, preserving demo entries
  if (existsSync(POOLS_JSON)) {
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    for (const p of manifest.pools ?? []) {
      const live = byId.get(String(p.id));
      if (!live) continue;
      p.probability = live.probability as number;
      p.volume24hUsdc = live.volume24hUsdc as string | null;
      p.status = live.status as number;
      (p as Record<string, unknown>).netPoolUsdc = live.netPoolUsdc;
    }
    // Never zero out the dashboard when there is simply nothing on-chain yet: a fresh deployment
    // would otherwise render "TVL $0 / 0 markets" and throw away the sample-market framing.
    if (active > 0 || settled > 0) {
      manifest.stats = {
        tvlUsdc: ethers.formatUnits(tvl, 6),
        volume24hUsdc: rows.reduce<number>((n, r) => n + Number(r.volume24hUsdc ?? 0), 0).toFixed(2),
        activeMarkets: active,
        settledMarkets: settled,
      } as unknown as typeof manifest.stats;
    } else {
      console.log("[ops] no on-chain pools — leaving manifest stats untouched");
    }
    (manifest as Record<string, unknown>).updatedAt = new Date().toISOString();
    writeFileSync(POOLS_JSON, JSON.stringify(manifest, null, 2) + "\n");
  }

  mkdirSync(join(ROOT, "logs"), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        network: network.name,
        chainId: Number(net.chainId),
        head,
        arena: arenaAddress,
        stats: { tvlUsdc: ethers.formatUnits(tvl, 6), active, settled, pools: rows.length },
        pools: rows,
        needsSettlement: stale,
      },
      null,
      2
    ) + "\n"
  );

  console.log(`[ops] ${network.name} head=${head} arena=${arenaAddress}`);
  console.log(`[ops] pools=${rows.length} active=${active} settled=${settled} tvl=${ethers.formatUnits(tvl, 6)} USDC`);
  if (stale.length) {
    console.log(`[ops] ⚠ ${stale.length} pool(s) ended but not settled:`);
    for (const s of stale.slice(0, 8)) console.log(`      ${s.id} — ${s.title} (ended ${s.endedHoursAgo}h ago)`);
  } else {
    console.log("[ops] no pending settlements");
  }
  console.log(`[ops] wrote ${OUT} + refreshed pools.json`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
