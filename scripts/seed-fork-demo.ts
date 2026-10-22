/**
 * Demo-state seeder for a Base-mainnet FORK (never mainnet): creates one Settled and one Canceled
 * pool so the frontend's state machine can be exercised against real contract code. The Open pool
 * comes from the real unattended script (scripts/open-pool-unattended.sh with NETWORK=baseFork).
 *
 *   anvil --fork-url https://mainnet.base.org --port 8546 --chain-id 8453
 *   bun run scripts/seed-fork-demo.ts
 *
 * Safe by construction: it refuses any RPC that is not localhost.
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8546";
const ARENA = "0x36f1bFbE3E0d0FA0941C031be278149D33f65684";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(RPC)) {
  throw new Error(`refusing to seed a non-local RPC: ${RPC}`);
}

const env = readFileSync(join(process.cwd(), ".env"), "utf8");
const PK = (env.match(/^PRIVATE_KEY=(.*)$/m)?.[1] ?? "").trim();
const abi = JSON.parse(
  readFileSync(join(process.cwd(), "artifacts/contracts/PredictionArena.sol/PredictionArena.json"), "utf8")
).abi;

const p = new ethers.JsonRpcProvider(RPC);
const u = (x: number | string) => ethers.parseUnits(String(x), 6);
const H = ethers.keccak256(ethers.toUtf8Bytes("ipfs://demo-evidence-bundle"));

const balSlot = (a: string) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [a, 9]));

(async () => {
  const owner = new ethers.Wallet(PK, p);
  // fork gas is real-priced: top the demo owner up so 6+ deployments/seed txs fit
  await p.send("anvil_setBalance", [owner.address, ethers.toBeHex(ethers.parseEther("10"))]);
  const arena = new ethers.Contract(ARENA, abi, owner);
  const usdcAbi = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];
  const [a1, a2] = [await p.getSigner(1), await p.getSigner(2)];
  const U1 = await a1.getAddress();
  const U2 = await a2.getAddress();

  for (const who of [U1, U2]) {
    await p.send("anvil_setStorageAt", [USDC, balSlot(who), ethers.toBeHex(u(1000), 32)]);
    await (await new ethers.Contract(USDC, usdcAbi, who === U1 ? a1 : a2).approve(ARENA, ethers.MaxUint256)).wait();
  }
  const now = BigInt((await p.getBlock("latest"))!.timestamp);

  async function mkPool(id: number, title: string, ttl: number) {
    // re-read the clock: advance() moves it between pools
    const t = BigInt((await p.getBlock("latest"))!.timestamp);
    await (await arena.createPool(id, title, "Macro", t + BigInt(ttl))).wait();
    await (await arena.seedPool(id, 0, u(22.5))).wait();
    await (await arena.seedPool(id, 1, u(22.5))).wait();
  }
  async function advance(sec: number) {
    await p.send("evm_increaseTime", [sec]);
    await p.send("evm_mine", []);
  }

  const base = Date.now() * 1000;

  // 2) SETTLED — YES wins, U1 holds the winning ticket
  const settledId = base + 2;
  await mkPool(settledId, "Base 日活地址本周是否破 500 万？", 120);
  await (await new ethers.Contract(ARENA, abi, a1).bet(settledId, 0, u(50), ethers.ZeroAddress)).wait();
  await (await new ethers.Contract(ARENA, abi, a2).bet(settledId, 1, u(50), ethers.ZeroAddress)).wait();
  await advance(200);
  await (await arena.settle(settledId, 0, H)).wait();

  // 3) CANCELED — voided, both sides refund 100% of gross
  const canceledId = base + 3;
  await mkPool(canceledId, "ETH 本周能否突破 $6k？（已取消）", 120);
  await (await new ethers.Contract(ARENA, abi, a1).bet(canceledId, 0, u(30), ethers.ZeroAddress)).wait();
  await (await new ethers.Contract(ARENA, abi, a2).bet(canceledId, 1, u(20), ethers.ZeroAddress)).wait();
  await advance(200);
  await (await arena.cancelPool(canceledId)).wait();

  for (const id of [settledId, canceledId]) {
    const pv = await arena.getPool(id);
    console.log(
      `pool ${id} | ${pv.title} | status=${Number(pv.status)} | net=${ethers.formatUnits(pv.totalNetPool, 6)} | winner=${pv.winningOption}`
    );
  }
  console.log(`\nU1 ${U1}`);
  console.log(`pendingRewards(settled) = ${ethers.formatUnits(await arena.pendingRewards(settledId, U1), 6)} USDC`);
  console.log(`pendingRefund(canceled)  = ${ethers.formatUnits(await arena.pendingRefund(canceledId, U1), 6)} USDC`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
