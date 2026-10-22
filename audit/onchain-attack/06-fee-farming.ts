/**
 * FEE-FARMING CHECK — can anyone manufacture withdrawable platform fees out of nothing?
 *
 * The one way to "create" rake would be to settle a pool whose stake came from seedPool()
 * (seeds pay no rake). If that worked, the owner could mint accumulatedAdminFees at will and
 * drain USDC — even though every individual user is made whole.
 *
 *   bun run audit/onchain-attack/06-fee-farming.ts
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
const balSlot = (a: string, s = 9) =>
  ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [a, s]));

(async () => {
  const usdc = new ethers.Contract(USDC, usdcAbi, p);
  const arena = new ethers.Contract(ARENA, arenaAbi, p);
  await p.send("anvil_impersonateAccount", [OWNER]);
  await p.send("anvil_setBalance", [OWNER, ethers.toBeHex(ethers.parseEther("20"))]);
  const owner = await p.getSigner(OWNER);
  await p.send("anvil_setStorageAt", [USDC, balSlot(OWNER), ethers.toBeHex(u(1_000_000), 32)]);
  await (await new ethers.Contract(USDC, usdcAbi, owner).approve(ARENA, ethers.MaxUint256)).wait();
  const oA = new ethers.Contract(ARENA, arenaAbi, owner);
  const now = async () => BigInt((await p.getBlock("latest"))!.timestamp);
  const balanceOf = async (a: string) => (await usdc.balanceOf(a)) as bigint;

  const feesBefore = (await arena.accumulatedAdminFees()) as bigint;
  const poolId = 202;
  await (await oA.createPool(poolId, "seed only", "test", (await now()) + 300n)).wait();
  await (await oA.seedPool(poolId, 0, u(22.5))).wait();
  await (await oA.seedPool(poolId, 1, u(22.5))).wait();
  await p.send("evm_increaseTime", [350]);
  await p.send("evm_mine", []);
  await (await oA.settle(poolId, 0, H)).wait();

  const feesAfter = (await arena.accumulatedAdminFees()) as bigint;
  const before = await balanceOf(OWNER);
  await (await oA.claimRewards(poolId)).wait();
  const back = (await balanceOf(OWNER)) - before;

  console.log("seed-only pool: seeded 45.000000 USDC (22.5 per side), no real bettors");
  console.log("accumulatedAdminFees delta :", fmt(feesAfter - feesBefore), "USDC");
  console.log("owner recovered on claim   :", fmt(back), "USDC (his own 45.000000)");

  let canWithdraw = true;
  try {
    await (await oA.withdrawAdminFees({ gasLimit: 300_000 })).wait();
  } catch {
    canWithdraw = false;
  }
  console.log("withdrawAdminFees possible :", canWithdraw);
  console.log("");
  console.log(
    feesAfter - feesBefore === 0n
      ? "✅ VERDICT: seed-only pools release zero rake — fees cannot be manufactured out of thin air."
      : "❌ VERDICT: rake was fabricated from seed liquidity."
  );
})();
