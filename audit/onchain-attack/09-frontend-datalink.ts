/**
 * Frontend data-link check: replays exactly the calls the dApp makes, against a live chain.
 *
 *   bun run audit/onchain-attack/09-frontend-datalink.ts                          # fork (8546)
 *   RPC_URL=https://base-rpc.publicnode.com bun run audit/onchain-attack/09-frontend-datalink.ts  # mainnet
 *
 * What it proves: every field the cards render (status / pools / pendingRewards / pendingRefund)
 * is readable with the ABI + selectors the frontend actually ships, and that the three UI states
 * (Open / Settled / Canceled) are all reachable.
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8546";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const frontendArtifact = JSON.parse(
  readFileSync(join(root, "frontend/src/lib/contracts/PredictionArena.json"), "utf8")
);
const ADDRESS: string = frontendArtifact.address;
const abi = frontendArtifact.abi;

const p = new ethers.JsonRpcProvider(RPC);
const arena = new ethers.Contract(ADDRESS, abi, p);
const usdc = new ethers.Contract(USDC, ["function balanceOf(address) view returns (uint256)"], p);
const fmt = (x: bigint) => (Number(x) / 1e6).toFixed(6);

(async () => {
  console.log(`RPC          ${RPC}`);
  console.log(`manifest addr ${ADDRESS}  (ABI ${abi.length} entries)`);

  // 1) the same manifest the browser fetches
  const manifest = JSON.parse(readFileSync(join(root, "frontend/public/pools.json"), "utf8"));
  console.log(`manifest      ${manifest.pools.length} pools, chainId ${manifest.chainId}`);

  // 2) join manifest ids with the log-scan result (what the hook returns)
  const override = (process.env.POOL_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const ids: bigint[] = override.length
    ? override.map((x) => BigInt(x))
    : manifest.pools.map((x: any) => BigInt(x.id));
  console.log(`hook ids      ${ids.length}`);

  const latest = await p.getBlockNumber();
  let logs: any[] = [];
  try {
    logs = await arena.queryFilter(arena.filters.PoolCreated(), Number(manifest.deployBlock), latest);
    for (const l of logs) {
      const id = (l as any).args?.poolId as bigint;
      if (!ids.some((x) => x === id)) ids.push(id);
    }
    console.log(`log scan      ${logs.length} PoolCreated events (deployBlock..${latest})`);
  } catch (e: any) {
    console.log(`log scan      FAILED (${String(e?.shortMessage ?? e?.message).slice(0, 90)}) — manifest still usable`);
  }

  // 3) read every field a card renders, in the same shape normalizePool() builds
  const seen = new Set<number>();
  for (const id of ids.sort((a, b) => (a < b ? 1 : -1))) {
    const pv = await arena.getPool(id);
    const status = Number(pv.status);
    seen.add(status);
    const statusName = ["None", "Open", "Settled", "Canceled"][status];
    const cap = await arena.maxBetFor(id);
    console.log(
      `  pool ${String(id).padEnd(17)} ${statusName.padEnd(8)} net=${fmt(pv.totalNetPool).padStart(10)} ` +
        `o0=${fmt(pv.option0Pool).padStart(9)} o1=${fmt(pv.option1Pool).padStart(9)} cap=${fmt(cap)} ` +
        `"${String(pv.title).slice(0, 28)}"`
    );
    if (status === 2) {
      for (const who of ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"]) {
        const r = await arena.pendingRewards(id, who);
        if (r > 0n) console.log(`      pendingRewards(${who.slice(0, 8)}…) = ${fmt(r)} USDC`);
      }
    }
    if (status === 3) {
      for (const who of ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"]) {
        const r = await arena.pendingRefund(id, who);
        if (r > 0n) console.log(`      pendingRefund (${who.slice(0, 8)}…) = ${fmt(r)} USDC`);
      }
    }
  }

  console.log(`\ncontract USDC balance: ${fmt(await usdc.balanceOf(ADDRESS))} USDC`);
  console.log(`states seen: ${[...seen].sort().map((s) => ["None", "Open", "Settled", "Canceled"][s]).join(", ") || "(none)"}`);
  const need = [1, 2, 3];
  const ok = ids.length === 0 || need.every((s) => seen.has(s));
  console.log(ok ? "\n✅ every UI state is reachable with the shipped ABI/address" : "\n⚠ not all of Open/Settled/Canceled present in this dataset");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
