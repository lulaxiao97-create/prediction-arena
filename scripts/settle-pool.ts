import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// override:true — the .env file is authoritative; a stale exported PRIVATE_KEY in the
// shell must never silently win over the file (that is how a test key reaches mainnet).
dotenv.config({ override: true });

/**
 * Settle a pool and pin its verdict to a verifiable evidence digest.
 *
 * The evidence bundle (oracle feed snapshot, resolution sources, timestamps) is hashed with
 * sha256 → bytes32, passed to settle(poolId, winningOption, ipfsDataHash) and stored on-chain
 * + emitted in PoolSettled. Anyone can re-download the bundle from IPFS, re-hash it and compare.
 *
 * Usage:
 *   POOL_ID=123 WINNING_OPTION=1 EVIDENCE_FILE=./evidence/pool-123.json \
 *   bunx hardhat run scripts/settle-pool.ts --network base
 *
 * Or pass a pre-computed hash:
 *   POOL_ID=123 WINNING_OPTION=1 EVIDENCE_HASH=0xabc... bunx hardhat run scripts/settle-pool.ts
 */

async function main() {
  const [signer] = await ethers.getSigners();
  const arenaAddress = (process.env.ARENA_ADDRESS ?? "").trim();
  if (!ethers.isAddress(arenaAddress)) throw new Error("ARENA_ADDRESS is missing or invalid");

  const arena = await ethers.getContractAt("PredictionArena", arenaAddress, signer);

  const poolId = BigInt(process.env.POOL_ID ?? "0");
  if (poolId === 0n) throw new Error("POOL_ID is required");
  const winningOption = Number(process.env.WINNING_OPTION ?? "-1");
  if (winningOption !== 0 && winningOption !== 1) throw new Error("WINNING_OPTION must be 0 or 1");

  let evidenceHash = (process.env.EVIDENCE_HASH ?? "").trim();
  const evidenceFile = (process.env.EVIDENCE_FILE ?? "").trim();
  if (!evidenceHash && evidenceFile) {
    const digest = createHash("sha256").update(readFileSync(evidenceFile)).digest("hex");
    evidenceHash = `0x${digest}`;
    console.log(`evidence     : ${evidenceFile}`);
    console.log(`sha256       : ${evidenceHash}`);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(evidenceHash)) {
    throw new Error("Need EVIDENCE_FILE or a 32-byte EVIDENCE_HASH (0x + 64 hex chars)");
  }
  if (evidenceHash === ethers.ZeroHash) throw new Error("refusing to settle with a zero evidence hash");

  const pool = await arena.getPool(poolId);
  if (Number(pool.status) !== 1) throw new Error(`pool ${poolId} is not Open (status=${pool.status})`);

  const latest = await ethers.provider.getBlock("latest");
  if (BigInt(latest?.timestamp ?? 0) < BigInt(pool.endTime)) {
    throw new Error(
      `pool ${poolId} ends at ${new Date(Number(pool.endTime) * 1000).toISOString()} — cannot settle yet`
    );
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`Arena        : ${arenaAddress}`);
  console.log(`Pool         : ${poolId} | ${pool.title}`);
  console.log(`Option 0     : ${ethers.formatUnits(pool.option0Pool, 6)} USDC`);
  console.log(`Option 1     : ${ethers.formatUnits(pool.option1Pool, 6)} USDC`);
  console.log(`Verdict      : option ${winningOption}`);
  console.log(`Evidence hash: ${evidenceHash}`);
  console.log("──────────────────────────────────────────────────────────────");

  const tx = await arena.settle(poolId, winningOption, evidenceHash);
  const receipt = await tx.wait();
  console.log(`settled      : tx=${tx.hash} block=${receipt?.blockNumber}`);

  const after = await arena.getPool(poolId);
  if (Number(after.status) !== 2) throw new Error("pool did not reach Settled");
  if (after.settlementHash.toLowerCase() !== evidenceHash.toLowerCase()) {
    throw new Error("on-chain evidence hash mismatch");
  }
  console.log(`status       : Settled, winningOption=${after.winningOption}`);
  console.log(`hash on-chain: ${after.settlementHash}  ✓ verified`);
  console.log(`payout pool  : ${ethers.formatUnits(after.totalNetPool, 6)} USDC net`);
  console.log("Winners can now call claimRewards(poolId).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
