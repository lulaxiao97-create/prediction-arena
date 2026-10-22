/**
 * PROOF #2: reentrancy — does the arena's ReentrancyGuard hold if the payment token calls back?
 *
 * Base USDC never calls back, so this needs a hostile 6-decimal ERC20
 * (contracts/mocks/ReentrantUSDC.sol). Runs on a clean local anvil (NOT the mainnet fork)
 * because the token itself must be hostile; the arena bytecode is the same artifact that was
 * deployed to 0x36f1…5684 (proved byte-for-byte in 04-bytecode-proof.ts).
 *
 *   anvil --port 8547 --accounts 5 --balance 1000 --chain-id 31337
 *   bun run audit/onchain-attack/03-reentrancy-local.ts
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";

const RPC = "http://127.0.0.1:8547";
const arenaArt = JSON.parse(
  readFileSync(new URL("../../artifacts/contracts/PredictionArena.sol/PredictionArena.json", import.meta.url), "utf8")
);
const tokenArt = JSON.parse(
  readFileSync(new URL("../../artifacts/contracts/mocks/ReentrantUSDC.sol/ReentrantUSDC.json", import.meta.url), "utf8")
);

const p = new ethers.JsonRpcProvider(RPC);
const u = (x: number | string) => ethers.parseUnits(String(x), 6);
const H = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
const results: any[] = [];
function rec(id: string, name: string, verdict: string, detail = "") {
  results.push({ id, name, verdict, detail });
  console.log(`${verdict.padEnd(9)} ${id.padEnd(4)} ${name}${detail ? "  →  " + detail : ""}`);
}
function reason(e: any): string {
  const d = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (typeof d === "string" && d.length >= 10) {
    try {
      const pe = new ethers.Interface(arenaArt.abi).parseError(d);
      if (pe) return `${pe.name}()`;
    } catch {}
    const known: Record<string, string> = { "0x3ee5aeb5": "ReentrancyGuardReentrantCall()" };
    if (known[d.slice(0, 10)]) return known[d.slice(0, 10)];
  }
  return String(e?.shortMessage ?? e?.message ?? e).split("\n")[0].slice(0, 120);
}

(async () => {
  const [deployerS, atkS, usrS] = await Promise.all([0, 1, 2].map((i) => p.getSigner(i)));
  const deployer = await deployerS.getAddress();
  const atk = await atkS.getAddress();
  const usr = await usrS.getAddress();

  const tok = await new ethers.ContractFactory(tokenArt.abi, tokenArt.bytecode, deployerS).deploy();
  await tok.waitForDeployment();
  const arena = await new ethers.ContractFactory(arenaArt.abi, arenaArt.bytecode, deployerS).deploy(
    await tok.getAddress(),
    deployer,
    deployer
  );
  await arena.waitForDeployment();
  const A: any = arena;
  const T: any = tok;
  const arenaAddr = await arena.getAddress();
  console.log("hostile token:", await tok.getAddress());
  console.log("arena copy   :", arenaAddr, "(same artifact as mainnet)\n");

  for (const [who, s] of [
    [atk, atkS],
    [usr, usrS],
  ] as const) {
    await (await T.mint(who, u(1000))).wait();
    await (await T.connect(s).approve(arenaAddr, ethers.MaxUint256)).wait();
  }
  const arm = async (payload: string) => (await T.arm(arenaAddr, payload)).wait();
  const disarm = async () => (await T.arm(ethers.ZeroAddress, "0x")).wait();
  const now = async () => BigInt((await p.getBlock("latest"))!.timestamp);

  // ---------- pool 1 ----------
  await (await A.createPool(1, "reentry", "test", (await now()) + 600n)).wait();

  // R1: token calls back into bet() from inside transferFrom
  await arm(A.interface.encodeFunctionData("bet", [1, 1, u(10), ethers.ZeroAddress]));
  try {
    await (await A.connect(atkS).bet(1, 0, u(10), ethers.ZeroAddress)).wait();
    rec("R1", "reenter bet() from transferFrom", "!! FAIL", "transaction LANDED — guard bypassed");
  } catch (e: any) {
    rec("R1", "reenter bet() from transferFrom", "BLOCKED", reason(e));
  }
  await disarm();

  // honest round-trip on the same pool
  await (await A.connect(atkS).bet(1, 0, u(50), ethers.ZeroAddress)).wait();
  await (await A.connect(usrS).bet(1, 1, u(50), ethers.ZeroAddress)).wait();
  await p.send("evm_increaseTime", [700]);
  await p.send("evm_mine", []);
  await (await A.settle(1, 0, H)).wait();

  // R2: token calls back into claimRewards() from inside the payout transfer
  await arm(A.interface.encodeFunctionData("claimRewards", [1]));
  try {
    await (await A.connect(atkS).claimRewards(1)).wait();
    rec("R2", "reenter claimRewards() from payout", "!! FAIL", "transaction LANDED — double payout possible");
  } catch (e: any) {
    rec("R2", "reenter claimRewards() from payout", "BLOCKED", reason(e));
  }
  const st = async () => `${await T.getFunction("armed")()} / ${await T.getFunction("target")()}`;
  console.log("   [dbg] after blocked attempt: armed/target =", await st());
  await disarm();
  console.log("   [dbg] after disarm:          armed/target =", await st());
  const before1 = (await T.balanceOf(atk)) as bigint;
  await (await A.connect(atkS).claimRewards(1, { gasLimit: 400_000 })).wait();
  const got1 = ((await T.balanceOf(atk)) as bigint) - before1;
  rec("R3", "honest claim after disarming the token", "OK", `winner got ${ethers.formatUnits(got1, 6)} hUSDC`);

  // ---------- pool 2: cross-function reentry ----------
  await (await A.createPool(2, "cross", "test", (await now()) + 600n)).wait();
  await (await A.connect(atkS).bet(2, 0, u(50), ethers.ZeroAddress)).wait();
  await (await A.connect(usrS).bet(2, 1, u(50), ethers.ZeroAddress)).wait();
  await p.send("evm_increaseTime", [700]);
  await p.send("evm_mine", []);
  await (await A.settle(2, 0, H)).wait();
  await arm(A.interface.encodeFunctionData("claimRefund", [2]));
  try {
    await (await A.connect(atkS).claimRewards(2)).wait();
    rec("R4", "cross-function reentry (claimRefund inside claimRewards)", "!! FAIL", "transaction LANDED");
  } catch (e: any) {
    rec("R4", "cross-function reentry (claimRefund inside claimRewards)", "BLOCKED", reason(e));
  }
  await disarm();
  const before2 = (await T.balanceOf(atk)) as bigint;
  await (await A.connect(atkS).claimRewards(2, { gasLimit: 400_000 })).wait();
  const got2 = ((await T.balanceOf(atk)) as bigint) - before2;
  rec("R5", "honest claim after disarming (cross-fn pool)", "OK", `winner got ${ethers.formatUnits(got2, 6)} hUSDC`);

  // ---------- R6: refund path is guarded too ----------
  await (await A.createPool(3, "refund", "test", (await now()) + 600n)).wait();
  await (await A.connect(atkS).bet(3, 0, u(50), ethers.ZeroAddress)).wait();
  await (await A.cancelPool(3)).wait();
  await arm(A.interface.encodeFunctionData("claimRefund", [3]));
  try {
    await (await A.connect(atkS).claimRefund(3)).wait();
    rec("R6", "reenter claimRefund() from refund transfer", "!! FAIL", "transaction LANDED");
  } catch (e: any) {
    rec("R6", "reenter claimRefund() from refund transfer", "BLOCKED", reason(e));
  }
  await disarm();

  console.log(`\n${results.length} checks, ${results.filter((r) => r.verdict === "!! FAIL").length} failures`);
  (await import("node:fs")).writeFileSync(
    new URL("./03-results.json", import.meta.url),
    JSON.stringify({ results }, null, 1)
  );
})().catch((e) => {
  console.error("CRASH", e);
  process.exit(1);
});
