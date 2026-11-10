#!/usr/bin/env bun
/** One-off: how many of the board's open markets actually have a pool on Base? */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Contract, JsonRpcProvider } from "ethers";

const ROOT = join(import.meta.dir, "..");
const raw = JSON.parse(readFileSync(join(ROOT, "frontend/public/pools.json"), "utf8")) as {
  address: string;
  pools: { id: string | number; title: string; status?: number; endTimeUtc?: string; totalNetPool?: string }[];
};
const ABI = [
  // Field order matters: PoolView is (title, category, endTime, winningOption, status, ...). The
  // status is the FIFTH value, not the fourth — reading index 3 gets winningOption (0 for an
  // unsettled pool) and every "is this open?" check comes back false on a live market.
  "function getPool(uint256) view returns (tuple(string question, string category, uint64 endTime, uint8 winningOption, uint8 status, uint256 totalNetPool, uint256 option0Pool, uint256 option1Pool, bytes32 settlementHash))",
];
const provider = new JsonRpcProvider(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", 8453);
const arena = new Contract(raw.address, ABI, provider);

const now = Date.now();
const open = raw.pools.filter((p) => (p.status ?? 1) === 1 && (!p.endTimeUtc || Date.parse(p.endTimeUtc) > now));
const counts: Record<string, number> = {};
const withStake: string[] = [];
const openPools: { id: string; net: string; title: string }[] = [];

for (const p of open) {
  try {
    const row = (await arena.getPool(BigInt(p.id))) as unknown as unknown[];
    const status = Number(row[4]);
    const net = row[5] as bigint;
    counts[status] = (counts[status] ?? 0) + 1;
    if (status === 1) openPools.push({ id: String(p.id), net: net.toString(), title: p.title });
    if (net > 0n) withStake.push(String(p.id));
  } catch {
    counts.err = (counts.err ?? 0) + 1;
  }
}

console.log("board open rows:", open.length);
console.log("chain status counts (0=missing,1=open,2=settled,3=voided):", counts);
console.log("open on chain:", openPools.length, "· holding stake:", withStake.length);
console.log("first 8 open-on-chain:");
for (const p of openPools.slice(0, 8)) console.log(` #${p.id} net=${p.net} ${p.title.slice(0, 70)}`);
