// Probe: can we mint USDC balances on the anvil fork via storage, and impersonate the owner?
import { ethers } from "ethers";

const RPC = "http://127.0.0.1:8546";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ARENA = "0x36f1bFbE3E0d0FA0941C031be278149D33f65684";
const OWNER = "0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1";

const p = new ethers.JsonRpcProvider(RPC);
const usdcAbi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address,uint256) returns (bool)",
];

function slotKey(addr: string, slot: number) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [addr, slot])
  );
}

(async () => {
  const usdc = new ethers.Contract(USDC, usdcAbi, p);
  console.log("chainId", (await p.getNetwork()).chainId);
  console.log("symbol", await usdc.symbol(), "decimals", await usdc.decimals());

  const probe = "0x1111111111111111111111111111111111111111";
  for (const slot of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    const key = slotKey(probe, slot);
    await p.send("anvil_setStorageAt", [USDC, key, ethers.toBeHex(123_456_789n, 32)]);
    const bal = await usdc.balanceOf(probe);
    if (bal === 123_456_789n) {
      console.log("USDC balances slot =", slot);
      await p.send("anvil_setStorageAt", [USDC, key, ethers.toBeHex(0n, 32)]);
      break;
    }
  }

  // impersonate owner
  await p.send("anvil_impersonateAccount", [OWNER]);
  await p.send("anvil_setBalance", [OWNER, ethers.toBeHex(ethers.parseEther("10"))]);
  const arenaAbi = ["function owner() view returns (address)", "function MIN_BET() view returns (uint256)"];
  const arena = new ethers.Contract(ARENA, arenaAbi, p);
  console.log("arena.owner", await arena.owner(), "MIN_BET", (await arena.MIN_BET()).toString());

  const signer = await p.getSigner(OWNER);
  console.log("got impersonated signer?", await signer.getAddress());
  const c = new ethers.Contract(ARENA, ["function setFeeVault(address)"], signer);
  try {
    const tx = await c.setFeeVault("0x9520269b506e02c357a712160979a3237C404fE6");
    const r = await tx.wait();
    console.log("owner impersonation works, gas", r?.gasUsed?.toString());
  } catch (e: any) {
    console.log("owner call failed:", e.shortMessage ?? e.message);
  }
})();
