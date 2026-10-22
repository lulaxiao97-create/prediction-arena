/**
 * Regenerate frontend/public/pools.json — the static pool manifest the dApp falls back to when
 * the public RPC rate-limits `eth_getLogs` (it does: -32011 request limit reached).
 *
 *   bun run scripts/sync-pool-list.ts                 # mainnet (BASE_RPC_URL / .env)
 *   RPC_URL=http://127.0.0.1:8546 bun run scripts/sync-pool-list.ts
 *
 * The manifest only carries ids; every field shown in the UI is still read live from the chain,
 * so a stale manifest can never misreport a pool's status or balance.
 */
import { ethers } from "ethers";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const env = readFileSync(join(root, ".env"), "utf8");
const pick = (k: string) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim();

const RPC =
  process.env.RPC_URL ??
  pick("BASE_RPC_URL") ??
  // mainnet.base.org answers eth_getLogs with -32011 "request limit reached"
  "https://base-rpc.publicnode.com";
const ARENA = process.env.ARENA_ADDRESS ?? pick("ARENA_ADDRESS");
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 8453);
const DEPLOY_BLOCK = BigInt(process.env.DEPLOY_BLOCK ?? 52921545);
const CHUNK = 5_000n;

if (!ethers.isAddress(ARENA)) throw new Error(`invalid ARENA_ADDRESS: ${ARENA}`);

const abi = JSON.parse(
  readFileSync(join(root, "artifacts/contracts/PredictionArena.sol/PredictionArena.json"), "utf8")
).abi;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const arena = new ethers.Contract(ARENA, abi, provider);
  const latest = await provider.getBlockNumber();
  const ids = new Set<string>();

  for (let from = Number(DEPLOY_BLOCK); from <= latest; from += Number(CHUNK)) {
    const to = Math.min(from + Number(CHUNK) - 1, latest);
    let logs: any[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        logs = await arena.queryFilter(arena.filters.PoolCreated(), from, to);
        break;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (attempt === 4) throw e;
        const wait = /429|rate|limit|exceed/i.test(msg) ? 1_500 * (attempt + 1) : 400 * (attempt + 1);
        console.warn(`  chunk ${from}..${to} failed (${msg.slice(0, 80)}) — retry in ${wait}ms`);
        await sleep(wait);
      }
    }
    for (const log of logs) {
      const id = (log as any).args?.poolId as bigint | undefined;
      if (id !== undefined) ids.add(id.toString());
    }
    process.stdout.write(`  scanned ${from}..${to} → ${ids.size} pools\n`);
  }

  const sorted = [...ids].map(Number).sort((a, b) => b - a);
  const out = {
    address: ARENA,
    chainId: CHAIN_ID,
    deployBlock: Number(DEPLOY_BLOCK),
    updatedAt: new Date().toISOString(),
    pools: sorted.map((id) => ({ id })),
  };
  // POOL_LIST_OUT lets a fork rehearsal write somewhere harmless instead of the shipped manifest
  const dest = join(root, process.env.POOL_LIST_OUT ?? "frontend/public/pools.json");
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nwrote ${dest} — ${sorted.length} pools (${RPC})`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
