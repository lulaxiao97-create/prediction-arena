/**
 * Attack the OWNER's EIP-7702 delegated account.
 *
 * The deployed arena's owner is 0x436b…55Ba1, whose code is `0xef0100 || 0x63c0…e32b`
 * (MetaMask EIP7702StatelessDeleGator). If that delegator let an arbitrary caller execute
 * calls "as the owner", every onlyOwner function (settle / seedPool / withdrawAdminFees /
 * rescueERC20) would be open to anyone — that would be a real Critical.
 *
 *   bun run audit/onchain-attack/02-owner-7702.ts
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";

const RPC = "http://127.0.0.1:8546";
const ARENA = "0x36f1bFbE3E0d0FA0941C031be278149D33f65684";
const OWNER = "0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1";
const DELEGATOR = "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b";
const FEE_VAULT_ALT = "0x000000000000000000000000000000000000dEaD";

const arenaAbi = JSON.parse(
  readFileSync(new URL("../../artifacts/contracts/PredictionArena.sol/PredictionArena.json", import.meta.url), "utf8")
).abi;
const delegatorAbi = JSON.parse(readFileSync(new URL("./delegator-abi.json", import.meta.url), "utf8"));
const p = new ethers.JsonRpcProvider(RPC);

function reason(e: any): string {
  const d = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (typeof d === "string" && d.length >= 10) {
    try {
      const pe = new ethers.Interface(delegatorAbi).parseError(d);
      if (pe) return `${pe.name}(${pe.args.map((x: any) => x.toString()).join(", ")})`;
    } catch {}
  }
  return String(e?.shortMessage ?? e?.message ?? e).split("\n")[0].slice(0, 120);
}

const results: any[] = [];
function rec(id: string, name: string, blocked: boolean | null, detail: string) {
  const v = blocked === null ? "INFO" : blocked ? "BLOCKED" : "!! OPEN";
  results.push({ id, name, verdict: v, detail });
  console.log(`${v.padEnd(9)} ${id.padEnd(5)} ${name}  →  ${detail}`);
}

(async () => {
  const attackerS = await p.getSigner(1);
  const attacker = await attackerS.getAddress();
  const arena = new ethers.Contract(ARENA, arenaAbi, p);
  const del = new ethers.Contract(OWNER, delegatorAbi, attackerS);

  console.log("owner code  :", await p.getCode(OWNER));
  console.log("delegator   :", DELEGATOR, `(${(await p.getCode(DELEGATOR)).length / 2 - 1} bytes)`);
  console.log("arena owner :", await arena.owner());
  console.log("attacker    :", attacker, "\n");

  const payload = arena.interface.encodeFunctionData("setFeeVault", [FEE_VAULT_ALT]);

  // 1) single execute(to,value,data) — ERC-4337 style
  try {
    const tx = await del["execute(address,uint256,bytes)"](ARENA, 0, payload);
    await tx.wait();
    rec("W1", "attacker execute(arena,0,setFeeVault) on owner account", false, "TRANSACTION LANDED");
  } catch (e: any) {
    rec("W1", "attacker execute(arena,0,setFeeVault) on owner account", true, reason(e));
  }

  // 2) ERC-7579 execute(bytes32 mode, bytes executionCalldata)
  try {
    const execData = ethers.concat([
      ethers.zeroPadValue(ARENA, 20),
      ethers.toBeHex(0, 32),
      ethers.toBeHex(payload.length / 2 - 1, 32),
      payload,
    ]);
    const tx = await del["execute(bytes32,bytes)"](ethers.ZeroHash, execData);
    await tx.wait();
    rec("W2", "attacker execute(mode,execData) on owner account", false, "TRANSACTION LANDED");
  } catch (e: any) {
    rec("W2", "attacker execute(mode,execData) on owner account", true, reason(e));
  }

  // 3) executeFromExecutor — needs the caller to be an enabled executor
  try {
    const mode = ethers.ZeroHash;
    const tx = await del.executeFromExecutor(
      mode,
      ethers.concat([ethers.zeroPadValue(ARENA, 20), ethers.toBeHex(0, 32), payload])
    );
    await tx.wait();
    rec("W3", "attacker executeFromExecutor on owner account", false, "TRANSACTION LANDED");
  } catch (e: any) {
    rec("W3", "attacker executeFromExecutor on owner account", true, reason(e));
  }

  // 4) state check: did any of it change the arena's feeVault?
  const vault = await arena.feeVault();
  rec("W4", "arena.feeVault untouched", vault !== FEE_VAULT_ALT, `feeVault is still ${vault}`);

  // 5) can the attacker make the owner account *sign* for them? (validateUserOp / isValidSignature)
  try {
    const tx = await del.isValidSignature(ethers.id("arbitrary"), "0x" + "11".repeat(65));
    rec("W5", "isValidSignature accepts a forged signature", tx !== "0x1626ba7e", `returned ${tx}`);
  } catch (e: any) {
    rec("W5", "isValidSignature accepts a forged signature", true, reason(e));
  }

  const open = results.filter((r) => r.verdict === "!! OPEN");
  console.log(`\n${results.length} checks, ${open.length} open paths via the owner account`);
  (await import("node:fs")).writeFileSync(
    new URL("./02-results.json", import.meta.url),
    JSON.stringify({ owner: OWNER, delegator: DELEGATOR, results }, null, 1)
  );
})().catch((e) => {
  console.error("CRASH", e);
  process.exit(1);
});
