/**
 * QUANTIFY the owner's privilege on the live contract (Base fork, real USDC).
 *
 * The owner is the oracle (settle) AND may inject liquidity with seedPool(), which
 *   - pays no 4% rake, and
 *   - ignores the per-ticket cap (the cap is computed from the *weaker* side, and seeds are exempt).
 * So an owner that already knows the outcome can seed the winning side right before settlement
 * and take the opposing side's stake. This is a centralisation risk, not an external exploit —
 * the numbers below are the size of it.
 *
 *   bun run audit/onchain-attack/05-owner-privilege.ts
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";

const RPC = "http://127.0.0.1:8546";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ARENA = "0x36f1bFbE3E0d0FA0941C031be278149D33f65684";
const OWNER = "0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1";

const arenaAbi = JSON.parse(
  readFileSync(new URL("../../artifacts/contracts/PredictionArena.sol/PredictionArena.json", import.meta.url), "utf8")
).abi;
const usdcAbi = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];
const p = new ethers.JsonRpcProvider(RPC);
const u = (x: number | string) => ethers.parseUnits(String(x), 6);
const fmt = (x: bigint) => (Number(x) / 1e6).toFixed(6);
const H = ethers.keccak256(ethers.toUtf8Bytes("evidence"));

function balSlot(addr: string, slot = 9) {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [addr, slot]));
}

(async () => {
  const usdc = new ethers.Contract(USDC, usdcAbi, p);
  const arena = new ethers.Contract(ARENA, arenaAbi, p);
  const [, , userAS, userBS] = await Promise.all([0, 1, 2, 3, 4].map((i) => p.getSigner(i)));
  const A = await userAS.getAddress();
  const B = await userBS.getAddress();

  await p.send("anvil_impersonateAccount", [OWNER]);
  await p.send("anvil_setBalance", [OWNER, ethers.toBeHex(ethers.parseEther("50"))]);
  const owner = await p.getSigner(OWNER);

  for (const [who, s] of [
    [OWNER, owner],
    [A, userAS],
    [B, userBS],
  ] as const) {
    await p.send("anvil_setStorageAt", [USDC, balSlot(who), ethers.toBeHex(u(1_000_000), 32)]);
    await (await new ethers.Contract(USDC, usdcAbi, s).approve(ARENA, ethers.MaxUint256)).wait();
  }
  const oA = new ethers.Contract(ARENA, arenaAbi, owner);
  const asA = new ethers.Contract(ARENA, arenaAbi, userAS);
  const asB = new ethers.Contract(ARENA, arenaAbi, userBS);
  const now = async () => BigInt((await p.getBlock("latest"))!.timestamp);
  const balanceOf = async (a: string) => (await usdc.balanceOf(a)) as bigint;

  // ── baseline: same pool, owner does NOT add liquidity before settlement ──
  const ttl = 600;
  await (await oA.createPool(300, "baseline", "test", (await now()) + BigInt(ttl))).wait();
  await (await oA.seedPool(300, 0, u(22.5))).wait();
  await (await oA.seedPool(300, 1, u(22.5))).wait();
  await (await asA.bet(300, 0, u(50), ethers.ZeroAddress)).wait();
  await (await asB.bet(300, 1, u(50), ethers.ZeroAddress)).wait();
  await p.send("evm_increaseTime", [ttl + 50]);
  await p.send("evm_mine", []);
  await (await oA.settle(300, 0, H)).wait();
  const aBase = await balanceOf(A);
  await (await asA.claimRewards(300)).wait();
  const aFaidGain = (await balanceOf(A)) - aBase;
  const ownerBase = await balanceOf(OWNER);
  await (await oA.claimRewards(300)).wait();
  const ownerBaseGain = (await balanceOf(OWNER)) - ownerBase;

  // ── attack: owner seeds the winning side with 500 USDC right before settling ──
  await (await oA.createPool(301, "owner-inflated", "test", (await now()) + BigInt(ttl))).wait();
  await (await oA.seedPool(301, 0, u(22.5))).wait();
  await (await oA.seedPool(301, 1, u(22.5))).wait();
  await (await asA.bet(301, 0, u(50), ethers.ZeroAddress)).wait();
  await (await asB.bet(301, 1, u(50), ethers.ZeroAddress)).wait();

  const ownerBefore = await balanceOf(OWNER);
  await (await oA.seedPool(301, 0, u(500))).wait(); // no rake, no cap — he is the oracle
  const seeded = ownerBefore - (await balanceOf(OWNER));

  await p.send("evm_increaseTime", [ttl + 50]);
  await p.send("evm_mine", []);
  await (await oA.settle(301, 0, H)).wait();

  const aAtkBase = await balanceOf(A);
  await (await asA.claimRewards(301)).wait();
  const aAtkGain = (await balanceOf(A)) - aAtkBase;

  const owner2 = await balanceOf(OWNER);
  await (await oA.claimRewards(301)).wait();
  const ownerGot = (await balanceOf(OWNER)) - owner2;

  console.log("\n── baseline (owner seeds 22.5/22.5 and settles honestly) ──────────────");
  console.log(`honest winner A : stake 50 gross = 48 net → payout ${fmt(aFaidGain)}  (profit +${fmt(aFaidGain - u(50))})`);
  console.log(`owner           : seeded 45.0 (22.5/side) → payout ${fmt(ownerBaseGain)}  (net ${fmt(ownerBaseGain - u(45))})`);

  console.log("\n── owner seeds the winning side with 500 USDC right before settle ────");
  console.log(`extra capital   : ${fmt(seeded)} USDC (no rake paid, cap ignored)`);
  console.log(`honest winner A : payout ${fmt(aAtkGain)}  (was ${fmt(aFaidGain)}) → ${fmt(aFaidGain - aAtkGain)} USDC of A's profit moved to the owner`);
  const ownerTotalIn = u(545); // 22.5 loser-side seed + 22.5 + 500 winner-side seed
  console.log(`owner           : payout ${fmt(ownerGot)} on ${fmt(ownerTotalIn)} total seeded → net +${fmt(ownerGot - ownerTotalIn)}`);
  console.log(`loser B         : lost 50.000000 as designed`);

  console.log("\n── verdict ───────────────────────────────────────────────────────────");
  console.log("This path needs the owner key (the oracle). No external attacker can do it.");
  console.log("It is the same trust boundary as settle(): fixing it means a decentralised oracle.");
})();
