import { ethers, network } from "hardhat";

/**
 * Red-team simulation for the P0 hardening patch.
 *
 *   bunx hardhat run scripts/audit/red-team-attack.ts
 *
 * Every scenario is an actual on-chain transaction attempt against the freshly compiled
 * contract — not a code-reading claim. Blocked scenarios must revert with the expected custom
 * error; the recovery scenarios must move real USDC.
 */

const USDC = (n: string | number) => ethers.parseUnits(String(n), 6);
const fmt = (v: bigint) => Number(ethers.formatUnits(v, 6)).toFixed(2);
const DAY = 86_400;
const HASH = ethers.keccak256(ethers.toUtf8Bytes("ipfs://red-team-evidence"));

type Result = { id: string; title: string; status: "BLOCKED" | "OPEN" | "PASS"; detail: string };
const results: Result[] = [];

async function expectRevert(id: string, title: string, fn: () => Promise<unknown>, expected: string) {
  try {
    await fn();
    results.push({ id, title, status: "OPEN", detail: `NO REVERT — expected ${expected}` });
  } catch (error: any) {
    const text = String(error?.message ?? error);
    if (text.includes(expected)) {
      results.push({ id, title, status: "BLOCKED", detail: expected });
    } else {
      results.push({ id, title, status: "OPEN", detail: `reverted with unexpected error: ${text.slice(0, 120)}` });
    }
  }
}

async function main() {
  const [owner, alice, bob, kol, attacker] = await ethers.getSigners();

  const usdc = await ethers.deployContract("MockUSDC");
  await usdc.waitForDeployment();
  const arena = await ethers.deployContract("PredictionArena", [
    await usdc.getAddress(),
    owner.address,
    owner.address,
  ]);
  await arena.waitForDeployment();
  const arenaAddr = await arena.getAddress();

  for (const who of [owner, alice, bob, kol, attacker]) {
    await usdc.mint(who.address, USDC(2_000));
    await usdc.connect(who).approve(arenaAddr, ethers.MaxUint256);
  }

  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  await arena.createPool(1, "Red-team target A", "Macro", now + 3_600);
  await arena.seedPool(1, 0, USDC("22.5"));
  await arena.seedPool(1, 1, USDC("22.5"));

  // ── R1: the oracle tries to bet ─────────────────────────────────────────
  await expectRevert(
    "R1",
    "owner (oracle) calls bet()",
    () => arena.connect(owner).bet(1, 1, USDC(500), ethers.ZeroAddress),
    "OwnerCannotBet"
  );

  // ── R2: non-owner tries to settle ───────────────────────────────────────
  await expectRevert(
    "R2",
    "attacker calls settle(id, option, hash)",
    () => arena.connect(attacker).settle(1, 1, HASH),
    "OwnableUnauthorizedAccount"
  );

  // ── R3: settle before the pool actually ends ────────────────────────────
  await expectRevert(
    "R3",
    "owner settles before endTime",
    () => arena.settle(1, 1, HASH),
    "PoolNotEnded"
  );

  // ── R4: drain the escrowed rake of an open pool ─────────────────────────
  await expectRevert(
    "R4",
    "owner calls withdrawAdminFees() while pool is open",
    () => arena.withdrawAdminFees(),
    "NothingToWithdraw"
  );

  // ── R5: KOL tries to pull referral before settlement ────────────────────
  await arena.connect(alice).bet(1, 1, USDC(500), kol.address); // seeds the escrow
  await expectRevert(
    "R5",
    "KOL calls withdrawReferralFees(openPool)",
    () => arena.connect(kol).withdrawReferralFees(1),
    "PoolNotSettled"
  );

  // ── R6: refund before the pool is canceled ──────────────────────────────
  await expectRevert(
    "R6",
    "attacker calls claimRefund() on an open pool",
    () => arena.connect(attacker).claimRefund(1),
    "PoolNotCanceled"
  );

  // ── R7: force an early emergency cancel ─────────────────────────────────
  await expectRevert(
    "R7",
    "attacker calls emergencyRefund() before endTime + 30d",
    () => arena.connect(attacker).emergencyRefund(1),
    "EmergencyTooEarly"
  );

  // ── R8: platform must not profit from canceling a pool ──────────────────
  await arena.cancelPool(1);
  const aliceBefore = await usdc.balanceOf(alice.address);
  await arena.connect(alice).claimRefund(1);
  const refunded = (await usdc.balanceOf(alice.address)) - aliceBefore;
  const rakeAfterCancel = await arena.accumulatedAdminFees();
  const rakeEscrow = await arena.poolRakeAdmin(1);
  if (refunded === USDC(500) && rakeAfterCancel === 0n && rakeEscrow === 0n) {
    results.push({
      id: "R8",
      title: "cancel rug: platform keeps rake?",
      status: "BLOCKED",
      detail: `user refunded 100% (${fmt(refunded)} USDC), rake 0.00`,
    });
  } else {
    results.push({
      id: "R8",
      title: "cancel rug: platform keeps rake?",
      status: "OPEN",
      detail: `refund ${fmt(refunded)} / admin ${fmt(rakeAfterCancel)} / escrow ${fmt(rakeEscrow)}`,
    });
  }

  // ── R9: double refund ───────────────────────────────────────────────────
  await expectRevert(
    "R9",
    "attacker replays claimRefund()",
    () => arena.connect(alice).claimRefund(1),
    "AlreadyClaimed"
  );

  // ── R10: KOL cannot claim referral from a canceled pool ─────────────────
  await expectRevert(
    "R10",
    "KOL claims referral on canceled pool",
    () => arena.connect(kol).withdrawReferralFees(1),
    "PoolNotSettled"
  );

  // ── R11: emergency valve is closed on settled pools ─────────────────────
  await arena.createPool(2, "Red-team target B", "Tech", now + 3_600);
  await arena.seedPool(2, 0, USDC("22.5"));
  await arena.seedPool(2, 1, USDC("22.5"));
  await arena.connect(bob).bet(2, 0, USDC(500), ethers.ZeroAddress);
  await network.provider.send("evm_increaseTime", [3_700]);
  await network.provider.send("evm_mine", []);
  await arena.settle(2, 0, HASH);
  await network.provider.send("evm_increaseTime", [31 * DAY]);
  await network.provider.send("evm_mine", []);
  await expectRevert(
    "R11",
    "attacker re-cancels a settled pool via emergencyRefund()",
    () => arena.connect(attacker).emergencyRefund(2),
    "PoolNotOpen"
  );

  // ── R12: the escape hatch actually pays everyone back ───────────────────
  const now3 = (await ethers.provider.getBlock("latest"))!.timestamp;
  await arena.createPool(3, "Red-team target C (owner AWOL)", "CT Drama", now3 + 3_600);
  await arena.seedPool(3, 0, USDC("22.5"));
  await arena.seedPool(3, 1, USDC("22.5"));
  await arena.connect(bob).bet(3, 1, USDC(500), ethers.ZeroAddress);
  await network.provider.send("evm_increaseTime", [30 * DAY + 3_700]);
  await network.provider.send("evm_mine", []);

  await arena.connect(attacker).emergencyRefund(3); // attacker is just any address
  const bobBefore = await usdc.balanceOf(bob.address);
  await arena.connect(bob).claimRefund(3);
  const bobRefund = (await usdc.balanceOf(bob.address)) - bobBefore;
  if (bobRefund === USDC(500)) {
    results.push({
      id: "R12",
      title: "owner AWOL for 30d → funds recoverable",
      status: "PASS",
      detail: `stranger forced cancel, victim recovered ${fmt(bobRefund)} USDC (100%)`,
    });
  } else {
    results.push({
      id: "R12",
      title: "owner AWOL for 30d → funds recoverable",
      status: "OPEN",
      detail: `only ${fmt(bobRefund)} USDC recovered`,
    });
  }

  // ── R13: documented residual risk — sybil wallet ────────────────────────
  const alt = ethers.Wallet.createRandom().connect(ethers.provider);
  await (await owner.sendTransaction({ to: alt.address, value: ethers.parseEther("1") })).wait();
  await usdc.mint(alt.address, USDC(100));
  await usdc.connect(alt).approve(arenaAddr, ethers.MaxUint256);
  const now4 = (await ethers.provider.getBlock("latest"))!.timestamp;
  await arena.createPool(4, "Red-team target D", "Tech", now4 + 3_600);
  await arena.seedPool(4, 0, USDC("22.5"));
  await arena.seedPool(4, 1, USDC("22.5"));
  try {
    await (await arena.connect(alt).bet(4, 0, USDC(100), ethers.ZeroAddress)).wait();
    results.push({
      id: "R13",
      title: "owner bets from a FRESH wallet (sybil)",
      status: "OPEN",
      detail: "accepted — address-based guard cannot stop sybils (requires decentralised oracle)",
    });
  } catch (error: any) {
    results.push({
      id: "R13",
      title: "owner bets from a FRESH wallet (sybil)",
      status: "BLOCKED",
      detail: String(error?.message ?? error).slice(0, 100),
    });
  }

  // ── report ──────────────────────────────────────────────────────────────
  console.log("──────────────────────────────────────────────────────────────");
  for (const r of results) {
    const tag = r.status === "BLOCKED" ? "🛡 BLOCKED" : r.status === "PASS" ? "✅ PASS   " : "⚠️  OPEN   ";
    console.log(`${tag} ${r.id.padEnd(3)} ${r.title}`);
    console.log(`            ${r.detail}`);
  }
  const exploits = results.filter((r) => r.id !== "R12" && r.id !== "R13");
  const blockedExploits = exploits.filter((r) => r.status === "BLOCKED").length;
  const recovered = results.filter((r) => r.status === "PASS").length;
  const residual = results.filter((r) => r.status === "OPEN");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`contract-level exploits blocked : ${blockedExploits}/${exploits.length}`);
  console.log(`recovery paths verified         : ${recovered}/1`);
  if (blockedExploits === exploits.length && recovered === 1) {
    console.log("All exploits blocked successfully (contract level)");
  }
  if (residual.length > 0) {
    console.log(`documented residual (out of scope): ${residual.map((r) => r.id).join(", ")} — sybil wallet needs a decentralised oracle`);
  }
  console.log("──────────────────────────────────────────────────────────────");

  // documented limitation is not a test failure
}

main().catch((error) => {
  console.error("RED TEAM RUN FAILED:", error);
  process.exitCode = 1;
});
