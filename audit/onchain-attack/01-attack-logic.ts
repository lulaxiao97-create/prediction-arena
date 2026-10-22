/**
 * On-chain attack suite — runs against a Base-mainnet anvil fork carrying the REAL deployed
 * bytecode of PredictionArena 0x36f1bFbE3E0d0FA0941C031be278149D33f65684 and the REAL Base
 * USDC. No mocks: every revert/success below is produced by the live code.
 *
 *   anvil --fork-url https://mainnet.base.org --port 8546 --accounts 5 --balance 1000 --chain-id 8453
 *   bun run audit/onchain-attack/01-attack-logic.ts
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
const usdcAbi = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const p = new ethers.JsonRpcProvider(RPC);
const u = (x: number | string) => ethers.parseUnits(String(x), 6);
const fmt = (x: bigint) => (Number(x) / 1e6).toFixed(6);
const H = ethers.keccak256(ethers.toUtf8Bytes("evidence-bundle"));

const results: { id: string; name: string; verdict: string; detail: string }[] = [];
function rec(id: string, name: string, verdict: string, detail = "") {
  results.push({ id, name, verdict, detail });
  console.log(`${verdict.padEnd(9)} ${id.padEnd(5)} ${name}${detail ? "  →  " + detail : ""}`);
}
const iface = new ethers.Interface(arenaAbi);
function reason(e: any): string {
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data ?? e?.revert?.data;
  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    try {
      const pe = iface.parseError(data);
      if (pe) return `${pe.name}(${pe.args.map((x: any) => x.toString()).join(", ")})`;
    } catch {}
  }
  const m = e?.shortMessage ?? e?.reason ?? e?.message ?? String(e);
  return String(m).split("\n")[0].slice(0, 140);
}
async function expectRevert(id: string, name: string, fn: () => Promise<any>, want?: string) {
  try {
    const tx = await fn();
    if (tx?.wait) await tx.wait();
    rec(id, name, "!! FAIL", "call SUCCEEDED — attack path is open");
  } catch (e: any) {
    const r = reason(e);
    const ok = !want || r.toLowerCase().includes(want.toLowerCase());
    rec(id, name, ok ? "BLOCKED" : "REVIEW", r);
  }
}
async function ok(id: string, name: string, fn: () => Promise<any>, detail = "") {
  try {
    const tx = await fn();
    const rc = tx?.wait ? await tx.wait() : tx;
    rec(id, name, "OK", detail || `gas ${rc?.gasUsed?.toString() ?? "-"}`);
    return rc;
  } catch (e: any) {
    rec(id, name, "!! FAIL", reason(e));
  }
}
function balSlot(addr: string, slot = 9) {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [addr, slot]));
}
async function setUsdc(addr: string, amount: bigint) {
  await p.send("anvil_setStorageAt", [USDC, balSlot(addr), ethers.toBeHex(amount, 32)]);
}
async function advance(sec: number) {
  await p.send("evm_increaseTime", [sec]);
  await p.send("evm_mine", []);
}
async function ts(): Promise<bigint> {
  return BigInt((await p.getBlock("latest"))!.timestamp);
}

(async () => {
  const usdc = new ethers.Contract(USDC, usdcAbi, p);
  const arena = new ethers.Contract(ARENA, arenaAbi, p);
  const [, attackerS, userAS, userBS, userCS] = await Promise.all([0, 1, 2, 3, 4].map((i) => p.getSigner(i)));
  const attacker = await attackerS.getAddress();
  const A = await userAS.getAddress();
  const B = await userBS.getAddress();
  const C = await userCS.getAddress();
  const signers: Record<string, ethers.Signer> = {};

  await p.send("anvil_impersonateAccount", [OWNER]);
  await p.send("anvil_setBalance", [OWNER, ethers.toBeHex(ethers.parseEther("50"))]);
  const owner = await p.getSigner(OWNER);
  Object.assign(signers, { [OWNER]: owner, [attacker]: attackerS, [A]: userAS, [B]: userBS, [C]: userCS });

  for (const who of [OWNER, attacker, A, B, C]) {
    await setUsdc(who, u(500_000));
    await (await new ethers.Contract(USDC, usdcAbi, signers[who]).approve(ARENA, ethers.MaxUint256)).wait();
  }
  const cAsOwner = new ethers.Contract(ARENA, arenaAbi, owner);
  const cAsAtk = new ethers.Contract(ARENA, arenaAbi, attackerS);
  const cAsA = new ethers.Contract(ARENA, arenaAbi, userAS);
  const cAsB = new ethers.Contract(ARENA, arenaAbi, userBS);
  const cAsC = new ethers.Contract(ARENA, arenaAbi, userCS);
  const balanceOf = async (a: string) => (await usdc.balanceOf(a)) as bigint;

  async function newPool(id: number, ttl = 600) {
    const e = (await ts()) + BigInt(ttl);
    await (await cAsOwner.createPool(id, `pool ${id}`, "test", e)).wait();
    return { endTime: e, ttl };
  }

  console.log("\n══════ A. access control (attacker holds no role) ══════");
  const ac = await newPool(100, 7200);
  await (await cAsOwner.seedPool(100, 0, u(22.5))).wait();
  await (await cAsOwner.seedPool(100, 1, u(22.5))).wait();
  await expectRevert("A1", "attacker createPool", () => cAsAtk.createPool(101, "hack", "x", ac.endTime + 60n), "OwnableUnauthorizedAccount");
  await expectRevert("A2", "attacker seedPool", () => cAsAtk.seedPool(100, 0, u(10)), "OwnableUnauthorizedAccount");
  await expectRevert("A3", "attacker settle", () => cAsAtk.settle(100, 0, H), "OwnableUnauthorizedAccount");
  await expectRevert("A4", "attacker cancelPool", () => cAsAtk.cancelPool(100), "OwnableUnauthorizedAccount");
  await expectRevert("A5", "attacker withdrawAdminFees", () => cAsAtk.withdrawAdminFees(), "OwnableUnauthorizedAccount");
  await expectRevert("A6", "attacker rescueERC20(USDC)", () => cAsAtk.rescueERC20(USDC, attacker, 1), "OwnableUnauthorizedAccount");
  await expectRevert("A7", "owner rescueERC20(USDC) — bet token locked", () => cAsOwner.rescueERC20(USDC, OWNER, 1), "CannotRescueBetToken");
  await expectRevert("A8", "attacker bet 60 > cap 50", () => cAsAtk.bet(100, 0, u(60), ethers.ZeroAddress), "BetExceedsCap");

  console.log("\n══════ B. claim / refund state machine ══════");
  const pb = await newPool(101, 600);
  await (await cAsA.bet(101, 0, u(50), ethers.ZeroAddress)).wait();
  await (await cAsB.bet(101, 1, u(50), ethers.ZeroAddress)).wait();
  await advance(pb.ttl + 100);
  await (await cAsOwner.settle(101, 0, H)).wait();
  await expectRevert("B1", "loser claimRewards", () => cAsB.claimRewards(101), "NothingToClaim");
  await expectRevert("B2", "claimRefund on SETTLED pool", () => cAsA.claimRefund(101), "PoolNotCanceled");
  const a0 = await balanceOf(A);
  await ok("B3", "winner claimRewards", () => cAsA.claimRewards(101));
  const payA = (await balanceOf(A)) - a0;
  rec("B4", "payout == stake x totalNet/winPool (96.000000)", payA === u(96) ? "CONFIRM" : "!! FAIL", `paid ${fmt(payA)} USDC`);
  await expectRevert("B5", "winner double-claim", () => cAsA.claimRewards(101), "AlreadyClaimed");

  const pc = await newPool(102, 900);
  await (await cAsA.bet(102, 0, u(50), ethers.ZeroAddress)).wait();
  await (await cAsB.bet(102, 1, u(50), ethers.ZeroAddress)).wait();
  await advance(pc.ttl + 100);
  await (await cAsOwner.cancelPool(102)).wait();
  await expectRevert("B6", "claimRewards on CANCELED pool", () => cAsA.claimRewards(102), "PoolNotSettled");
  const a1 = await balanceOf(A);
  await ok("B7", "cancel refund", () => cAsA.claimRefund(102));
  const refundA = (await balanceOf(A)) - a1;
  rec("B8", "refund == 100% of gross (50.000000)", refundA === u(50) ? "CONFIRM" : "!! FAIL", `received ${fmt(refundA)} USDC`);
  await expectRevert("B9", "double refund", () => cAsA.claimRefund(102), "AlreadyClaimed");

  const pd = await newPool(103, 900);
  await (await cAsC.bet(103, 0, u(30), ethers.ZeroAddress)).wait();
  await (await cAsC.bet(103, 1, u(20), ethers.ZeroAddress)).wait();
  await advance(pd.ttl + 100);
  await (await cAsOwner.cancelPool(103)).wait();
  const c0 = await balanceOf(C);
  await ok("B10", "both-side bettor refund", () => cAsC.claimRefund(103));
  const refundC = (await balanceOf(C)) - c0;
  rec("B11", "both-side refund == 50.000000", refundC === u(50) ? "CONFIRM" : "!! FAIL", `received ${fmt(refundC)} USDC`);
  await expectRevert("B12", "both-side double refund", () => cAsC.claimRefund(103), "AlreadyClaimed");

  console.log("\n══════ C. rounding / dust conservation ══════");
  const pr = await newPool(104, 600);
  await (await cAsA.bet(104, 0, u(7), ethers.ZeroAddress)).wait();
  await (await cAsB.bet(104, 0, u(11), ethers.ZeroAddress)).wait();
  await (await cAsC.bet(104, 1, u(13), ethers.ZeroAddress)).wait();
  await advance(pr.ttl + 100);
  await (await cAsOwner.settle(104, 0, H)).wait();
  const pool104 = await arena.getPool(104);
  const a2 = await balanceOf(A);
  await (await cAsA.claimRewards(104)).wait();
  const p104A = (await balanceOf(A)) - a2;
  const b2 = await balanceOf(B);
  await (await cAsB.claimRewards(104)).wait();
  const p104B = (await balanceOf(B)) - b2;
  const dust = pool104.totalNetPool - p104A - p104B;
  rec(
    "C1",
    "sum(payouts) <= totalNetPool",
    dust >= 0n ? "CONFIRM" : "!! FAIL",
    `totalNet ${fmt(pool104.totalNetPool)} | paid ${fmt(p104A + p104B)} | dust ${dust} wei (stays in contract, nobody can take it)`
  );

  console.log("\n══════ D. fee / referral isolation ══════");
  const adminAcc = (await arena.accumulatedAdminFees()) as bigint;
  const rakeLeft104 = (await arena.poolRakeAdmin(104)) as bigint;
  rec("D1", "settled pool released its rake, escrow zeroed", rakeLeft104 === 0n ? "CONFIRM" : "!! FAIL", `accumulatedAdminFees ${fmt(adminAcc)} USDC, pool.rakeAdmin ${rakeLeft104}`);
  await expectRevert("D2", "KOL claims referral on CANCELED pool", () => cAsAtk.withdrawReferralFees(102), "PoolNotSettled");

  const pe = await newPool(105, 600);
  await (await cAsA.bet(105, 0, u(50), C)).wait();
  await (await cAsB.bet(105, 1, u(50), ethers.ZeroAddress)).wait();
  await advance(pe.ttl + 100);
  await (await cAsOwner.settle(105, 0, H)).wait();
  const c1 = await balanceOf(C);
  await ok("D3", "KOL withdrawReferralFees", () => cAsC.withdrawReferralFees(105));
  const kolGot = (await balanceOf(C)) - c1;
  rec("D4", "KOL cut == 1.2% of stake (0.600000)", kolGot === u(0.6) ? "CONFIRM" : "!! FAIL", `paid ${fmt(kolGot)} USDC`);
  await expectRevert("D5", "KOL double-withdraw", () => cAsC.withdrawReferralFees(105));

  console.log("\n══════ E. referral abuse ══════");
  const pe2 = await newPool(106, 600);
  await (await cAsAtk.bet(106, 0, u(50), attacker)).wait(); // referrer == self
  await (await cAsB.bet(106, 1, u(50), ethers.ZeroAddress)).wait();
  await advance(pe2.ttl + 100);
  await (await cAsOwner.settle(106, 0, H)).wait();
  const refSelf = (await arena.poolReferral(106, attacker)) as bigint;
  rec("E1", "referrer == bettor is neutralised", refSelf === 0n ? "CONFIRM" : "!! FAIL", `poolReferral[self] = ${fmt(refSelf)} USDC`);

  const pf = await newPool(107, 600);
  const sock = ethers.Wallet.createRandom().connect(p);
  await p.send("anvil_setBalance", [sock.address, ethers.toBeHex(ethers.parseEther("1"))]);
  await setUsdc(sock.address, u(1000));
  const sockBase = await balanceOf(sock.address);
  await (await cAsAtk.bet(107, 0, u(50), sock.address)).wait();
  await (await cAsB.bet(107, 1, u(50), ethers.ZeroAddress)).wait();
  await advance(pf.ttl + 100);
  await (await cAsOwner.settle(107, 0, H)).wait();
  await (await new ethers.Contract(ARENA, arenaAbi, sock).withdrawReferralFees(107)).wait();
  const sockGot = (await balanceOf(sock.address)) - sockBase;
  rec("E2", "sock-puppet referrer rebates 1.2%", sockGot === u(0.6) ? "CONFIRM" : "!! FAIL", `sock got ${fmt(sockGot)} USDC → that bet's effective rake is 2.8%, not 4%`);

  console.log("\n══════ G. economic attacks (non-owner) ══════");
  const pg = await newPool(110, 600);
  await (await cAsA.bet(110, 0, u(50), ethers.ZeroAddress)).wait();
  await (await cAsB.bet(110, 1, u(50), ethers.ZeroAddress)).wait();
  const atkBefore = await balanceOf(attacker);
  for (let i = 0; i < 10; i++) await (await cAsAtk.bet(110, 0, u(50), ethers.ZeroAddress)).wait();
  const atkSpent = atkBefore - (await balanceOf(attacker));
  await advance(pg.ttl + 100);
  await (await cAsOwner.settle(110, 0, H)).wait();
  const a3 = await balanceOf(A);
  await (await cAsA.claimRewards(110)).wait();
  const honestGain = (await balanceOf(A)) - a3;
  const atk2 = await balanceOf(attacker);
  await (await cAsAtk.claimRewards(110)).wait();
  const atkGot = (await balanceOf(attacker)) - atk2;
  rec(
    "G1",
    "rolling 50-USDC bets (no cumulative cap) dilute the honest winner",
    atkGot > atkSpent ? "CONFIRM" : "REVIEW",
    `honest winner ${fmt(honestGain)} instead of 96.000000 (−${fmt(u(96) - honestGain)}) | attacker spent ${fmt(atkSpent)} got ${fmt(atkGot)} → net +${fmt(atkGot - atkSpent)} — requires knowing the outcome first`
  );

  const ph = await newPool(111, 600);
  await (await cAsA.bet(111, 0, u(50), ethers.ZeroAddress)).wait();
  await (await cAsB.bet(111, 1, u(50), ethers.ZeroAddress)).wait();
  await advance(ph.ttl + 100);
  await advance(2_592_000 + 100); // 30 days of owner silence
  const b4 = await balanceOf(B);
  await (await cAsB.emergencyRefund(111)).wait(); // the LOSING side forces the void
  await (await cAsB.claimRefund(111)).wait();
  const loserBack = (await balanceOf(B)) - b4;
  rec(
    "G2",
    "losing side escapes a loss after 30d of owner silence",
    loserBack === u(50) ? "CONFIRM" : "!! FAIL",
    `loser recovered ${fmt(loserBack)} USDC (should have lost 50) | the winner's 46.000000 profit evaporates — only reachable if the owner does not settle`
  );

  console.log("\n══════ F. global solvency invariant ══════");
  let owed = (await arena.accumulatedAdminFees()) as bigint;
  const everyone = [OWNER, A, B, C, attacker];
  for (const id of [100, 101, 102, 103, 104, 105, 106, 107, 110, 111]) {
    const st = Number((await arena.getPool(id)).status as bigint);
    if (st === 2) {
      for (const who of everyone) {
        owed += (await arena.pendingRewards(id, who)) as bigint;
        owed += (await arena.poolReferral(id, who)) as bigint;
      }
    } else if (st === 3) {
      for (const who of everyone) owed += (await arena.pendingRefund(id, who)) as bigint;
    } else if (st === 1) {
      const pv = await arena.getPool(id);
      owed += (pv.totalNetPool as bigint) + ((await arena.poolRakeAdmin(id)) as bigint);
      for (const who of everyone) owed += (await arena.poolReferral(id, who)) as bigint;
    }
  }
  const real = await balanceOf(ARENA);
  rec("F1", "contract balance >= everything still owed", real >= owed ? "CONFIRM" : "!! FAIL", `balance ${fmt(real)} USDC vs owed ${fmt(owed)} USDC (surplus ${fmt(real - owed)})`);

  console.log("\n──────── summary ────────");
  const bad = results.filter((r) => r.verdict === "!! FAIL");
  console.log(`${results.length} checks, ${bad.length} failures`);
  bad.forEach((b) => console.log("  FAIL", b.id, b.name, b.detail));
  const w = JSON.stringify({ generatedAt: new Date().toISOString(), arena: ARENA, results }, null, 1);
  (await import("node:fs")).writeFileSync(new URL("./01-results.json", import.meta.url), w);
})().catch((e) => {
  console.error("SUITE CRASHED:", e);
  process.exit(1);
});
