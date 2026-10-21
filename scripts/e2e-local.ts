import { ethers, network } from "hardhat";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Self-contained end-to-end proof, runs on the in-process Hardhat network:
 *
 *   bun run e2e:local
 *
 * bet → time-travel → settle(bytes32 evidence) → claimRewards → withdrawAdminFees →
 * withdrawReferralFees(poolId), asserting every number on the way.
 *
 * IMPORTANT — the ABI is read from the compiled artifact (artifacts/.../PredictionArena.json),
 * never hand-written. A hand-maintained ABI array silently drops events, and ethers then fails
 * with "Cannot read properties of undefined (reading 'args')" when parsing the receipt. Using the
 * artifact makes the ABI drift impossible: events, errors and structs always match the bytecode.
 */

const USDC = (n: string | number) => ethers.parseUnits(String(n), 6);
const EVIDENCE_HASH = ethers.keccak256(
  ethers.toUtf8Bytes("ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")
);

function artifactAbi(): any[] {
  const path = join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "PredictionArena.sol",
    "PredictionArena.json"
  );
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  return artifact.abi;
}

async function main() {
  const abi = artifactAbi();
  const eventNames = abi.filter((f) => f.type === "event").map((f) => f.name);
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`ABI source      : artifacts/contracts/PredictionArena.sol/PredictionArena.json`);
  console.log(`ABI entries     : ${abi.length} (events: ${eventNames.length} → ${eventNames.join(", ")})`);

  const [owner, alice, , kol] = await ethers.getSigners();

  // ── deploy fresh stack ────────────────────────────────────────────────
  const usdc = await ethers.deployContract("MockUSDC");
  await usdc.waitForDeployment();
  const arena = await ethers.deployContract("PredictionArena", [
    await usdc.getAddress(),
    owner.address, // feeVault (local: same signer for easy assertions)
    owner.address,
  ]);
  await arena.waitForDeployment();
  const arenaAddress = await arena.getAddress();

  for (const who of [alice, kol, owner]) {
    await usdc.mint(who.address, USDC(1_000));
    await usdc.connect(who).approve(arenaAddress, ethers.MaxUint256);
  }

  // ── open pool with the exact pool:auto recipe ─────────────────────────
  const poolId = 9_001n;
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const endTime = now + 3_600;
  await arena.createPool(poolId, "E2E: will the proof pass?", "Tech", endTime);
  await arena.seedPool(poolId, 0, USDC("22.5"));
  await arena.seedPool(poolId, 1, USDC("22.5"));
  assert.equal(await arena.maxBetFor(poolId), USDC(50), "bootstrap cap must be 50 USDC");
  console.log(`1) pool ${poolId} opened: seed 22.5 / 22.5, maxBet = ${ethers.formatUnits(await arena.maxBetFor(poolId), 6)} USDC`);

  // ── bet with referrer ─────────────────────────────────────────────────
  const betTx = await arena.connect(alice).bet(poolId, 1, USDC(5), kol.address);
  const betRc = await betTx.wait();
  const betEv = betRc!.logs
    .map((log) => {
      try {
        return arena.interface.parseLog(log as any);
      } catch {
        return null;
      }
    })
    .find((ev) => ev?.name === "BetPlaced");
  assert.ok(betEv, "BetPlaced event must decode");
  assert.equal(betEv!.args.fee, USDC("0.2"), "4% of 5 USDC");
  assert.equal(betEv!.args.referralCut, USDC("0.06"), "30% of the 4% rake");
  assert.equal(betEv!.args.netStake, USDC("4.8"), "96% into the pool");

  const afterBet = await arena.getPool(poolId);
  assert.equal(afterBet.option0Pool, USDC("22.5"));
  assert.equal(afterBet.option1Pool, USDC("27.3"));
  assert.equal(afterBet.totalNetPool, USDC("49.8"));
  // rake is escrowed per pool until settlement (that is what funds 100% refunds)
  assert.equal(await arena.accumulatedAdminFees(), 0n);
  assert.equal(await arena.poolRakeAdmin(poolId), USDC("0.14"));
  assert.equal(await arena.poolReferral(poolId, kol.address), USDC("0.06"));
  console.log(
    `2) bet 5 USDC → pools ${ethers.formatUnits(afterBet.option0Pool, 6)}/${ethers.formatUnits(
      afterBet.option1Pool,
      6
    )}, rake admin 0.14 + kol 0.06`
  );

  // ── time travel + settle with evidence hash ───────────────────────────
  await network.provider.send("evm_increaseTime", [3_700]);
  await network.provider.send("evm_mine", []);

  const settleTx = await arena.settle(poolId, 1, EVIDENCE_HASH);
  const settleRc = await settleTx.wait();
  const settledEv = settleRc!.logs
    .map((log) => {
      try {
        return arena.interface.parseLog(log as any);
      } catch {
        return null;
      }
    })
    .find((ev) => ev?.name === "PoolSettled");
  assert.ok(settledEv, "PoolSettled event must decode from the artifact ABI");
  assert.equal(settledEv!.args.poolId, poolId);
  assert.equal(settledEv!.args.winningOption, 1n); // uint8 decodes to bigint
  assert.equal(settledEv!.args.ipfsDataHash, EVIDENCE_HASH);

  const settled = await arena.getPool(poolId);
  assert.equal(settled.status, 2n); // enum decodes to bigint
  assert.equal(settled.settlementHash, EVIDENCE_HASH);
  console.log(
    `3) settle → option 1, status Settled, event hash ${settledEv!.args.ipfsDataHash.slice(0, 12)}… stored on-chain ✓`
  );

  // ── claim ─────────────────────────────────────────────────────────────
  const stake = (await arena.getStake(poolId, alice.address))[1];
  const expected = (stake * settled.totalNetPool) / settled.option1Pool;
  const before = await usdc.balanceOf(alice.address);
  await (await arena.connect(alice).claimRewards(poolId)).wait();
  const received = (await usdc.balanceOf(alice.address)) - before;
  assert.equal(received, expected, "payout == stake * totalNetPool / winningPool");
  assert.equal(await arena.pendingRewards(poolId, alice.address), 0n);
  console.log(
    `4) claim → stake ${ethers.formatUnits(stake, 6)} paid ${ethers.formatUnits(received, 6)} USDC (multi ${(
      Number(received) / Number(stake)
    ).toFixed(3)}x)`
  );

  // ── fee withdrawals stay isolated ─────────────────────────────────────
  const adminFees = await arena.accumulatedAdminFees();
  const vaultBefore = await usdc.balanceOf(owner.address);
  await (await arena.withdrawAdminFees()).wait();
  const vaultDelta = (await usdc.balanceOf(owner.address)) - vaultBefore;
  assert.equal(vaultDelta, adminFees);
  assert.equal(await arena.accumulatedAdminFees(), 0n);

  const kolFees = await arena.poolReferral(poolId, kol.address);
  const kolBefore = await usdc.balanceOf(kol.address);
  await (await arena.connect(kol).withdrawReferralFees(poolId)).wait();
  assert.equal((await usdc.balanceOf(kol.address)) - kolBefore, kolFees);
  console.log(
    `5) withdraw → admin ${ethers.formatUnits(adminFees, 6)} + kol ${ethers.formatUnits(kolFees, 6)} USDC, ledgers zeroed`
  );

  // ── solvency invariant ────────────────────────────────────────────────
  const balance = await arena.contractBalance();
  const liabilities = settled.totalNetPool - expected; // losing side stake still held
  assert.ok(balance >= liabilities, "contract must stay solvent");
  console.log(
    `6) solvency → balance ${ethers.formatUnits(balance, 6)} ≥ remaining pool ${ethers.formatUnits(
      liabilities,
      6
    )} USDC ✓`
  );

  console.log("──────────────────────────────────────────────────────────────");
  console.log("E2E PASS — 6/6 checks green (artifact ABI, no hand-written events)");
}

main().catch((error) => {
  console.error("E2E FAILED:", error);
  process.exitCode = 1;
});
