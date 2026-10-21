import { ethers, network } from "hardhat";

/**
 * Quantified PoC for the two privileged-role risks found in the audit:
 *
 *   A) "insider settlement"  — the owner is the oracle AND may bet, so it can bet on the
 *      outcome it will later declare and extract the opposing side's stake with ~zero risk.
 *   B) "cancel rug"          — cancelPool() returns users' net stake but keeps the 4% rake,
 *      so the owner can void a pool it is about to lose and still book the fee.
 *
 * Runs on the in-process Hardhat network:  bunx hardhat run scripts/audit/poc-owner-privilege.ts
 */

const USDC = (n: string | number) => ethers.parseUnits(String(n), 6);
const fmt = (v: bigint) => Number(ethers.formatUnits(v, 6)).toFixed(2);
const HASH = ethers.keccak256(ethers.toUtf8Bytes("ipfs://audit-poc"));

async function main() {
  const [owner, alice, feeVault, attacker] = await ethers.getSigners();

  const usdc = await ethers.deployContract("MockUSDC");
  await usdc.waitForDeployment();
  const arena = await ethers.deployContract("PredictionArena", [
    await usdc.getAddress(),
    feeVault.address,
    owner.address,
  ]);
  await arena.waitForDeployment();
  const arenaAddress = await arena.getAddress();

  for (const who of [alice, attacker, owner]) {
    await usdc.mint(who.address, USDC(1_000));
    await usdc.connect(who).approve(arenaAddress, ethers.MaxUint256);
  }

  const now = (await ethers.provider.getBlock("latest"))!.timestamp;

  // ── A) insider settlement ────────────────────────────────────────────────
  await arena.createPool(1, "PoC: insider settlement", "Macro", now + 3_600);
  await arena.seedPool(1, 0, USDC("22.5"));
  await arena.seedPool(1, 1, USDC("22.5"));

  const aliceBefore = await usdc.balanceOf(alice.address);
  const attackerBefore = await usdc.balanceOf(attacker.address);

  // F-01 patch: the owner address can no longer bet at all
  let ownerBlocked = false;
  try {
    await (await arena.connect(owner).bet(1, 0, USDC(50), ethers.ZeroAddress)).wait();
  } catch {
    ownerBlocked = true;
  }
  console.log(`F-01 guard: owner.bet() blocked = ${ownerBlocked}`);

  await arena.connect(alice).bet(1, 1, USDC(50), ethers.ZeroAddress); // victim bets NO
  await arena.connect(attacker).bet(1, 0, USDC(50), ethers.ZeroAddress); // owner's alt bets YES

  await network.provider.send("evm_increaseTime", [3_700]);
  await network.provider.send("evm_mine", []);

  // the owner simply declares the side it just bet on
  await arena.settle(1, 0, HASH);
  await arena.connect(attacker).claimRewards(1);

  const aliceAfter = await usdc.balanceOf(alice.address);
  const attackerAfter = await usdc.balanceOf(attacker.address);

  console.log("── A) insider settlement via sybil wallet (F-01 residual) ─────");
  console.log(`victim  (alice)  stake 50 USDC → payout 0      net ${fmt(aliceAfter - aliceBefore)} USDC`);
  console.log(`attacker(sybil)  stake 50 USDC → payout ${fmt(attackerAfter - attackerBefore + USDC(50))} → net +${fmt(attackerAfter - attackerBefore)} USDC`);
  console.log(`rake released at settle: admin ${fmt(await arena.accumulatedAdminFees())} USDC (escrow ${fmt(await arena.poolRakeAdmin(1))})`);

  // ── B) cancel rug ────────────────────────────────────────────────────────
  const now2 = (await ethers.provider.getBlock("latest"))!.timestamp;
  await arena.createPool(2, "PoC: cancel rug", "Tech", now2 + 3_600);
  await arena.seedPool(2, 0, USDC("22.5"));
  await arena.seedPool(2, 1, USDC("22.5"));
  const feesPre = await arena.accumulatedAdminFees();
  // cap is 50 USDC per ticket on a thin pool → two tickets = 100 USDC gross (96 net)
  await arena.connect(alice).bet(2, 1, USDC(50), ethers.ZeroAddress);
  await arena.connect(alice).bet(2, 1, USDC(50), ethers.ZeroAddress);

  const alicePreCancel = await usdc.balanceOf(alice.address);
  await arena.cancelPool(2);
  await arena.connect(alice).claimRefund(2);
  const refund = (await usdc.balanceOf(alice.address)) - alicePreCancel;
  const feesPost = await arena.accumulatedAdminFees();

  console.log("── B) cancel rug (after F-02 patch) ───────────────────────────");
  console.log(`victim staked 100 USDC → refunded ${fmt(refund)} USDC (loss ${fmt(USDC(100) - refund)})`);
  console.log(`platform rake kept on cancel: ${fmt(feesPost - feesPre)} USDC`);
  console.log("──────────────────────────────────────────────────────────────");
  console.log("A) still needs only the owner key + a fresh wallet (no exploit code) → decentralised oracle required.");
  console.log("B) now returns 100% of the stake: the cancel-rug path is closed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
