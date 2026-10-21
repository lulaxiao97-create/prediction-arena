import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// override:true — the .env file is authoritative; a stale exported PRIVATE_KEY in the
// shell must never silently win over the file (that is how a test key reaches mainnet).
dotenv.config({ override: true });

/**
 * Atomic pool opening: createPool() + seedPool(option0) + seedPool(option1).
 *
 * Why this exists: a pool created with zero liquidity on both sides has cap = 50 USDC
 * (bootstrap floor), which is fine — but a pool seeded on ONE side only would look healthy
 * while the other side stays empty. Seeding both sides in the same run guarantees the market
 * is two-sided from block one, and makes the 20%-of-weaker-side guard meaningful instead of
 * reverting every ticket (22.5 USDC side ⇒ 20% = 4.5 < MIN_BET 5 ⇒ dead pool).
 *
 * If any seed leg fails, the script rolls back with cancelPool() so we never leave an
 * orphaned, unseeded pool on chain. Script-level atomicity, chain-level compensation.
 *
 * Usage:
 *   ARENA_ADDRESS=0x... USDC_ADDRESS=0x... TITLE="..." CATEGORY=crypto \
 *   bun run pool:auto --network base
 */

const USDC_BY_CHAIN_ID: Record<number, string> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

const usdc = (n: string | number) => ethers.parseUnits(String(n), 6);
const HARDCODED_BOOTSTRAP_CAP = usdc(50); // must match PredictionArena.BOOTSTRAP_MAX_BET

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  const arenaAddress = (process.env.ARENA_ADDRESS ?? "").trim();
  if (!ethers.isAddress(arenaAddress) || arenaAddress === ethers.ZeroAddress) {
    throw new Error("ARENA_ADDRESS is missing or invalid");
  }
  const usdcAddress = (process.env.USDC_ADDRESS ?? USDC_BY_CHAIN_ID[Number(net.chainId)] ?? "").trim();
  if (!ethers.isAddress(usdcAddress)) {
    throw new Error(`USDC_ADDRESS missing for chainId ${net.chainId}`);
  }
  if ((await ethers.provider.getCode(arenaAddress)) === "0x") {
    throw new Error(`No contract at ARENA_ADDRESS ${arenaAddress}`);
  }

  const arena = await ethers.getContractAt("PredictionArena", arenaAddress, signer);
  const token = new ethers.Contract(usdcAddress, ERC20_ABI, signer);

  // ---------------------------------------------------------------- preflight
  const owner = await arena.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `createPool is onlyOwner. Signer ${signer.address} != owner ${owner}. ` +
        "Run with the owner key, or execute through the Safe (owner = Safe)."
    );
  }

  const bootstrapCap: bigint = await arena.BOOTSTRAP_MAX_BET();
  if (bootstrapCap !== HARDCODED_BOOTSTRAP_CAP) {
    console.warn(
      `⚠ on-chain BOOTSTRAP_MAX_BET = ${ethers.formatUnits(bootstrapCap, 6)} USDC ` +
        `(expected ${ethers.formatUnits(HARDCODED_BOOTSTRAP_CAP, 6)}). Contract was compiled from a different source.`
    );
  }

  const seedPerSide = usdc(process.env.SEED_PER_SIDE ?? "22.5");
  if (seedPerSide < usdc(20) || seedPerSide > usdc(25)) {
    throw new Error("SEED_PER_SIDE must be within 20..25 USDC");
  }
  const seedTotal = seedPerSide * 2n;

  // ── cron guard: never open (and seed) a new pool while the last one is still live.
  // Without this an hourly cron would lock 2×22.5 USDC + gas every single hour.
  const stateFile = join(process.cwd(), process.env.POOL_STATE_FILE ?? "logs/pool-state.json");
  if (process.env.SKIP_IF_OPEN === "1" && existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8")) as { poolId?: string };
      if (state.poolId) {
        const last = await arena.getPool(BigInt(state.poolId));
        const latestBlock = await ethers.provider.getBlock("latest");
        if (Number(last.status) === 1 && BigInt(last.endTime) > BigInt(latestBlock?.timestamp ?? 0)) {
          console.log(
            `SKIP: pool ${state.poolId} is still Open until ${new Date(Number(last.endTime) * 1000).toISOString()} ` +
              `— not opening (and not locking) another one. Set SKIP_IF_OPEN=0 to force.`
          );
          return;
        }
      }
    } catch {
      console.log("tracked pool not found on this network (or state unreadable) — continuing with a fresh pool");
    }
  }

  const poolId = BigInt(process.env.POOL_ID ?? Math.floor(Date.now() / 1000));
  const durationHours = Number(process.env.DURATION_HOURS ?? 168);
  if (!Number.isFinite(durationHours) || durationHours < 1 || durationHours > 24 * 365) {
    throw new Error("DURATION_HOURS must be within 1..8760");
  }
  const title = (process.env.TITLE ?? "Will BTC close above $100k this quarter?").trim();
  const category = (process.env.CATEGORY ?? "Macro").trim();
  const latest = await ethers.provider.getBlock("latest");
  const endTime = BigInt((latest?.timestamp ?? Math.floor(Date.now() / 1000)) + durationHours * 3600);

  // duplicate guard: getPool reverts PoolNotFound for a free id
  let exists = true;
  try {
    await arena.getPool(poolId);
  } catch {
    exists = false;
  }
  if (exists) throw new Error(`poolId ${poolId} already exists — pick another POOL_ID`);

  const balance: bigint = await token.balanceOf(signer.address);
  const decimals = await token.decimals();
  if (Number(decimals) !== 6) throw new Error(`USDC decimals != 6 (${decimals})`);
  if (balance < seedTotal) {
    throw new Error(
      `USDC balance ${ethers.formatUnits(balance, 6)} < seeds ${ethers.formatUnits(seedTotal, 6)}`
    );
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`Network      : ${network.name} (${net.chainId})`);
  console.log(`Arena        : ${arenaAddress}`);
  console.log(`Signer/owner : ${signer.address}`);
  console.log(`USDC balance : ${ethers.formatUnits(balance, 6)}`);
  console.log(`Pool         : ${poolId} | ${title} [${category}]`);
  console.log(`Ends at      : ${new Date(Number(endTime) * 1000).toISOString()}`);
  console.log(`Seeds        : ${ethers.formatUnits(seedPerSide, 6)} x 2 = ${ethers.formatUnits(seedTotal, 6)} USDC`);
  console.log(`Bootstrap cap: ${ethers.formatUnits(bootstrapCap, 6)} USDC (hardcoded floor)`);
  console.log("──────────────────────────────────────────────────────────────");

  // ---------------------------------------------------------------- step 1: create
  console.log("1/4 createPool ...");
  const createTx = await arena.createPool(poolId, title, category, endTime);
  const createRc = await createTx.wait();
  console.log(`    ok  tx=${createTx.hash} block=${createRc?.blockNumber}`);

  const created = await arena.getPool(poolId);
  if (Number(created.status) !== 1) throw new Error("pool did not open");
  if (BigInt(created.endTime) !== endTime) throw new Error("endTime mismatch after create");

  // ---------------------------------------------------------------- step 2: approve
  console.log("2/4 approve USDC ...");
  const allowance: bigint = await token.allowance(signer.address, arenaAddress);
  if (allowance < seedTotal) {
    const approveTx = await token.approve(arenaAddress, ethers.MaxUint256);
    await approveTx.wait();
    console.log(`    ok  tx=${approveTx.hash}`);
  } else {
    console.log("    ok  existing allowance sufficient");
  }

  // ---------------------------------------------------------------- step 3+4: seed both sides
  try {
    for (const option of [0, 1] as const) {
      console.log(`${option === 0 ? "3" : "4"}/4 seedPool option ${option} ...`);
      const seedTx = await arena.seedPool(poolId, option, seedPerSide);
      const seedRc = await seedTx.wait();
      console.log(`    ok  tx=${seedTx.hash} block=${seedRc?.blockNumber}`);
    }
  } catch (error) {
    console.error("Seed leg failed — rolling back with cancelPool() so no orphan pool stays live");
    try {
      const cancelTx = await arena.cancelPool(poolId);
      await cancelTx.wait();
      console.error(`rolled back: pool ${poolId} canceled (tx=${cancelTx.hash})`);
    } catch (cancelError) {
      console.error(`ROLLBACK FAILED for pool ${poolId} — cancel it manually:`, cancelError);
    }
    throw error;
  }

  // ---------------------------------------------------------------- verify
  const pool = await arena.getPool(poolId);
  const cap = await arena.maxBetFor(poolId);

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`Pool status  : ${Number(pool.status) === 1 ? "Open" : pool.status}`);
  console.log(`Option 0     : ${ethers.formatUnits(pool.option0Pool, 6)} USDC`);
  console.log(`Option 1     : ${ethers.formatUnits(pool.option1Pool, 6)} USDC`);
  console.log(`Net pool     : ${ethers.formatUnits(pool.totalNetPool, 6)} USDC`);
  console.log(`Max ticket   : ${ethers.formatUnits(cap, 6)} USDC`);

  if (pool.option0Pool === 0n || pool.option1Pool === 0n) {
    throw new Error("one side ended up empty — dead pool");
  }
  if (cap < usdc(5)) {
    throw new Error(`max ticket ${ethers.formatUnits(cap, 6)} < MIN_BET 5 — pool would be locked`);
  }
  console.log(`Liquidity ok : both sides seeded, first retail bet 5..${ethers.formatUnits(cap, 6)} USDC will pass`);
  console.log("──────────────────────────────────────────────────────────────");
  console.log("Settle later with an evidence hash:");
  console.log(
    `  bunx hardhat run scripts/settle-pool.ts --network ${network.name}   # POOL_ID=${poolId}`
  );
  console.log(`  or: arena.settle(${poolId}, <option>, <bytes32 ipfs hash>)`);
  console.log("──────────────────────────────────────────────────────────────");

  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(
    stateFile,
    JSON.stringify({ poolId: String(poolId), endTime: Number(endTime), network: network.name, openedAt: new Date().toISOString() }, null, 2) + "\n"
  );
  console.log(`state written  : ${stateFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
