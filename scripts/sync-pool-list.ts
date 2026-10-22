/**
 * Regenerate frontend/public/pools.json — the static market manifest the dApp falls back to when
 * the public RPC rate-limits `eth_getLogs` (it does: -32011 request limit reached).
 *
 *   bun run scripts/sync-pool-list.ts                                  # mainnet defaults
 *   RPC_URL=http://127.0.0.1:8546 POOL_LIST_OUT=logs/pools-fork.json bun run scripts/sync-pool-list.ts
 *
 * The manifest carries only static metadata (title/category/tags) plus pre-aggregated dashboard
 * stats. Every live field the UI renders (status, liquidity, payouts) is still read from chain.
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
const VOLUME_WINDOW_BLOCKS = 43_200n; // ≈24h on Base (2s blocks)

if (!ethers.isAddress(ARENA)) throw new Error(`invalid ARENA_ADDRESS: ${ARENA}`);

const abi = JSON.parse(
  readFileSync(join(root, "artifacts/contracts/PredictionArena.sol/PredictionArena.json"), "utf8")
).abi;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Derive display tags from the question + category. Only hints — never shown as on-chain data. */
function deriveTags(title: string, category: string): string[] {
  const t = title.toLowerCase();
  const tags = new Set<string>();
  if (t.includes("bitcoin") || t.includes("btc")) tags.add("BTC");
  if (t.includes("ethereum") || t.includes("eth/") || t.includes(" eth ")) tags.add("ETH");
  if (t.includes("base")) tags.add("Base");
  if (t.includes("solana") || t.includes("sol ")) tags.add("Solana");
  if (t.includes("fed") || t.includes("rate")) tags.add("Rates");
  if (t.includes("cpi") || t.includes("inflation")) tags.add("CPI");
  if (t.includes("gpt") || t.includes("ai ") || t.includes("agent")) tags.add("AI");
  if (t.includes("dex") || t.includes("volume")) tags.add("DEX");
  if (tags.size === 0 && category) tags.add(category);
  return [...tags].slice(0, 3);
}

async function scanLogs(
  arena: ethers.Contract,
  filter: ethers.ContractEventName | any,
  fromBlock: number,
  toBlock: number,
  label: string
): Promise<any[]> {
  const out: any[] = [];
  for (let from = fromBlock; from <= toBlock; from += Number(CHUNK)) {
    const to = Math.min(from + Number(CHUNK) - 1, toBlock);
    let logs: any[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        logs = await arena.queryFilter(filter as any, from, to);
        break;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (attempt === 4) {
          console.warn(`  ${label} ${from}..${to} failed: ${msg.slice(0, 80)}`);
          throw e;
        }
        const wait = /429|rate|limit|exceed/i.test(msg) ? 1_500 * (attempt + 1) : 400 * (attempt + 1);
        await sleep(wait);
      }
    }
    out.push(...logs);
  }
  return out;
}

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const arena = new ethers.Contract(ARENA, abi, provider);
  const latest = await provider.getBlockNumber();

  const created = await scanLogs(
    arena,
    arena.filters.PoolCreated(),
    Number(DEPLOY_BLOCK),
    latest,
    "PoolCreated"
  );
  console.log(`PoolCreated events: ${created.length} (blocks ${DEPLOY_BLOCK}..${latest})`);

  const rows: any[] = [];
  let tvl = 0n;
  let active = 0;
  let settled = 0;

  const seen = new Set<string>();
  for (const log of created) {
    const id = (log as any).args?.poolId as bigint;
    if (id === undefined || seen.has(id.toString())) continue;
    seen.add(id.toString());
    const title = String((log as any).args?.title ?? "");
    const category = String((log as any).args?.category ?? "");
    let status = 1;
    try {
      const pv = await arena.getPool(id);
      status = Number(pv.status);
      tvl += pv.totalNetPool as bigint;
      if (status === 1) active += 1;
      if (status === 2) settled += 1;
    } catch {
      /* pool unreadable: keep it listed, the UI will drop it on its own read */
    }
    rows.push({
      id: id.toString(),
      title,
      category,
      tags: deriveTags(title, category),
      status,
    });
  }

  // 24h volume = Σ grossAmount of BetPlaced inside the trailing ≈24h block window
  let volume24h = 0n;
  try {
    const fromBlock = Math.max(Number(DEPLOY_BLOCK), latest - Number(VOLUME_WINDOW_BLOCKS));
    const bets = await scanLogs(arena, arena.filters.BetPlaced(), fromBlock, latest, "BetPlaced");
    for (const b of bets) volume24h += ((b as any).args?.grossAmount ?? 0n) as bigint;
    console.log(`BetPlaced events (≈24h): ${bets.length}`);
  } catch {
    console.warn("  volume scan failed — volume24hUsdc stays null (UI shows the live pool sum)");
  }

  // Keep the sample/demo markets that ship with the app — this script only owns chain entries.
  // Without this, the first cron-driven sync would wipe the seeded marketplace.
  const dest = join(root, process.env.POOL_LIST_OUT ?? "frontend/public/pools.json");
  let demoRows: any[] = [];
  let previousFeatured: string | undefined;
  try {
    const previous = JSON.parse(readFileSync(dest, "utf8"));
    demoRows = (previous.pools ?? []).filter((row: any) => row.source === "demo");
    previousFeatured = previous.featured;
  } catch {
    /* first run */
  }

  const merged = [...rows, ...demoRows].sort((a, b) => Number(b.id) - Number(a.id));
  const out = {
    address: ARENA,
    chainId: CHAIN_ID,
    deployBlock: Number(DEPLOY_BLOCK),
    updatedAt: new Date().toISOString(),
    featured: previousFeatured ?? merged.find((row) => row.source !== "demo")?.id,
    stats: {
      tvlUsdc: tvl.toString(),
      volume24hUsdc: volume24h > 0n ? volume24h.toString() : null,
      activeMarkets: active,
      settledMarkets: settled,
    },
    pools: merged,
  };

  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `\nwrote ${dest} — ${merged.length} markets (${rows.length} on-chain + ${demoRows.length} demo), tvl ${ethers.formatUnits(tvl, 6)} USDC, ` +
      `volume24h ${ethers.formatUnits(volume24h, 6)} USDC (${RPC})`
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
