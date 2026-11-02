/**
 * DefiLlama adapter — Prediction Arena (Base).
 *
 * What DefiLlama will index: the USDC a bettor's stake sits in until the pool settles or refunds.
 * That is the whole TVL story for a pari-mutuel venue — there is no LP token, no lending market and
 * no vault; `bet()` pulls USDC into the arena contract and `claimRewards()` / `claimRefund()` pays it
 * out. So TVL = `usdc.balanceOf(arena)`, read straight from the chain.
 *
 * One correction to the brief, because the submission has to match reality: there is no prediction
 * *factory* and there are no 232 separate pool contracts. The 232 markets are `poolId`s inside one
 * immutable arena contract (0x9618…10b5) — `createPool(poolId, …)` per market, `bet(poolId, …)`,
 * `settle(poolId, …)`. DefiLlama's `owner` is therefore a single address, and the adapter does not
 * need to enumerate anything.
 *
 * The adapter is exported in the shape DefiLlama's test harness expects (`timetravel`,
 * `misrepresentedTokens`, `base.tvl`), and the same file doubles as a CLI so we can prove the number
 * before opening a PR:
 *
 *   bun scripts/defillama-adapter.ts            # human-readable TVL + open interest
 *   bun scripts/defillama-adapter.ts --json     # the same numbers as JSON
 *
 * `openInterestUsdc` is NOT part of TVL. It is the sum of `totalNetPool` over pools still open, read
 * from `getPools()` for the ids in the published manifest — the contract has no on-chain id
 * enumeration (pools are keyed by a hash of the title), so the manifest is the index. It is reported
 * separately because "money on the board" and "money in the contract" differ by unclaimed fees and
 * by settled-but-unclaimed payouts.
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const MANIFEST = join(ROOT, "frontend", "public", "pools.json");

export const ARENA = "0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5";
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

const ERC20 = ["function balanceOf(address) view returns (uint256)"];
// JSON ABI rather than the human-readable tuple string: ethers v6's parser chokes on a one-line tuple
// ("unsupported fragment" warnings) and then fails the call for an unrelated reason.
const POOL_VIEW = [
  {
    type: "function",
    name: "getPools",
    stateMutability: "view",
    inputs: [{ name: "ids", type: "uint256[]" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "title", type: "string" },
          { name: "category", type: "string" },
          { name: "endTime", type: "uint64" },
          { name: "winningOption", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "totalNetPool", type: "uint256" },
          { name: "option0Pool", type: "uint256" },
          { name: "option1Pool", type: "uint256" },
          { name: "settlementHash", type: "bytes32" },
        ],
      },
    ],
  },
];

export const methodology = {
  tvl: "USDC held by the Prediction Arena contract on Base. Every stake is escrowed there until the pool settles (pari-mutuel payout) or is cancelled (100% refund); unclaimed platform fees and unclaimed payouts also sit in the same balance.",
};

/** Minimal shape of the object DefiLlama hands to an adapter function. */
type LlamaApi = {
  call: (args: { abi: string; target: string; params?: unknown[] }) => Promise<unknown>;
  add: (token: string, amount: unknown, label?: string) => void;
};

export const adapter = {
  timetravel: true,
  misrepresentedTokens: false,
  methodology: methodology.tvl,
  base: {
    tvl: async (api: LlamaApi) => {
      const balance = (await api.call({
        abi: "erc20:balanceOf",
        target: USDC,
        params: [ARENA],
      })) as bigint;
      api.add(USDC, balance);
    },
  },
};

export type ArenaNumbers = {
  chain: "base";
  arena: string;
  usdc: string;
  blockNumber: number;
  tvlUsdc: number;
  openInterestUsdc: number;
  openPools: number;
  readAt: string;
};

/** The same computation the adapter performs, against a plain JSON-RPC provider. */
export async function readArena(provider = new ethers.JsonRpcProvider(RPC)): Promise<ArenaNumbers> {
  const usdc = new ethers.Contract(USDC, ERC20, provider);
  const arena = new ethers.Contract(ARENA, POOL_VIEW, provider);
  const [balance, blockNumber] = await Promise.all([
    usdc.balanceOf(ARENA) as Promise<bigint>,
    provider.getBlockNumber(),
  ]);

  let openInterest = 0n;
  let openPools = 0;
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { pools?: { id: string | number; status?: number }[] };
    const ids = (manifest.pools ?? []).filter((p) => (p.status ?? 1) === 1).map((p) => BigInt(p.id));
    if (ids.length) {
      // Chunked: a 232-id eth_call is fine on Base, but the adapter should not assume an RPC's gas cap.
      for (let i = 0; i < ids.length; i += 60) {
        const views = (await arena.getPools(ids.slice(i, i + 60))) as { totalNetPool: bigint; status: number }[];
        for (const v of views) {
          if (Number(v.status) === 1) {
            openInterest += v.totalNetPool;
            openPools += 1;
          }
        }
      }
    }
  } catch {
    /* a missing manifest must not break the TVL read — open interest is a bonus field */
  }

  return {
    chain: "base",
    arena: ARENA,
    usdc: USDC,
    blockNumber,
    tvlUsdc: Number(balance) / 1e6,
    openInterestUsdc: Number(openInterest) / 1e6,
    openPools,
    readAt: new Date().toISOString(),
  };
}

if (import.meta.main) {
  const json = process.argv.includes("--json");
  readArena()
    .then((n) => {
      if (json) {
        console.log(JSON.stringify(n, null, 2));
        return;
      }
      console.log(`Prediction Arena · Base ${n.blockNumber}`);
      console.log(`  TVL (USDC escrowed)   $${n.tvlUsdc.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
      console.log(`  open interest         $${n.openInterestUsdc.toLocaleString("en-US", { maximumFractionDigits: 2 })} across ${n.openPools} open pools`);
      console.log(`  arena                 ${n.arena}`);
    })
    .catch((err) => {
      console.error(`adapter read failed: ${(err as Error).message}`);
      process.exit(1);
    });
}
