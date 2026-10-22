import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// override:true — the .env file is authoritative; a stale exported PRIVATE_KEY in the
// shell must never silently win over the file (that is how a test key reaches mainnet).
dotenv.config({ override: true });

/**
 * Canonical USDC addresses.
 * Base Mainnet  : 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (Circle native USDC, 6 decimals)
 * Base Sepolia  : 0x036CbD53842c5426634e7929541eC2318f3dCF7e (Circle test USDC, 6 decimals)
 */
const USDC_BY_CHAIN_ID: Record<number, string> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

const LOCAL_CHAIN_IDS = new Set([31337, 1337]);

/**
 * Keeps frontend/.env.local in lockstep with what was actually deployed. Two names are written:
 * NEXT_PUBLIC_ARENA_CONTRACT_BASE_MAINNET (ops-facing, requested by the runbook) and
 * NEXT_PUBLIC_ARENA_ADDRESS (the one the app code reads), so neither can go stale.
 */
function syncFrontendEnv(arena: string, usdc: string, chainId: number) {
  const dir = join(__dirname, "..", "frontend");
  if (!existsSync(dir)) return;

  const file = join(dir, ".env.local");
  const template = join(dir, ".env.local.example");
  let lines: string[] = [];
  if (existsSync(file)) lines = readFileSync(file, "utf8").split(/\r?\n/);
  else if (existsSync(template)) lines = readFileSync(template, "utf8").split(/\r?\n/);

  const values = new Map<string, string>([
    ["NEXT_PUBLIC_ARENA_ADDRESS", arena],
    ["NEXT_PUBLIC_ARENA_CONTRACT_BASE_MAINNET", arena],
    ["NEXT_PUBLIC_USDC_ADDRESS", usdc],
    ["NEXT_PUBLIC_CHAIN_ID", String(chainId)],
  ]);

  const seen = new Set<string>();
  const out = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!match) return line;
    const key = match[1];
    if (!values.has(key)) return line;
    seen.add(key);
    return `${key}=${values.get(key)}`;
  });
  for (const [key, value] of values) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }
  writeFileSync(file, `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`);
  console.log(`Frontend env    : ${file} (arena + chainId ${chainId} synced)`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  // ---------------------------------------------------------------- config
  const feeReceiver = (process.env.FEE_RECEIVER ?? "").trim();
  if (!ethers.isAddress(feeReceiver) || feeReceiver === ethers.ZeroAddress) {
    throw new Error(`FEE_RECEIVER is missing or not a valid address (got "${feeReceiver}")`);
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`Network        : ${network.name} (chainId ${chainId})`);
  console.log(`Deployer       : ${deployer.address}`);
  console.log(`Deployer bal   : ${ethers.formatEther(balance)} ETH`);
  console.log(`Fee receiver   : ${feeReceiver}`);
  console.log("──────────────────────────────────────────────────────────────");

  // ---------------------------------------------------------------- USDC
  let usdcAddress = (process.env.USDC_ADDRESS ?? USDC_BY_CHAIN_ID[chainId] ?? "").trim();
  if (!usdcAddress) {
    if (LOCAL_CHAIN_IDS.has(chainId)) {
      console.log("No USDC known for this chain → deploying MockUSDC (local testing only)");
      const Mock = await ethers.getContractFactory("MockUSDC");
      const mock = await Mock.deploy();
      await mock.waitForDeployment();
      usdcAddress = await mock.getAddress();
      console.log(`MockUSDC       : ${usdcAddress}`);
    } else {
      throw new Error(
        `No USDC address configured for chainId ${chainId}. Set USDC_ADDRESS in .env and re-run.`
      );
    }
  }
  if (!ethers.isAddress(usdcAddress)) throw new Error(`Invalid USDC address: ${usdcAddress}`);

  const usdcCode = await ethers.provider.getCode(usdcAddress);
  if (usdcCode === "0x") throw new Error(`No contract deployed at USDC address ${usdcAddress}`);
  // Sanity check the token interface (decimals()/symbol() must decode).
  const usdc = new ethers.Contract(
    usdcAddress,
    [
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
      "function balanceOf(address) view returns (uint256)",
    ],
    deployer
  );
  const [decimals, symbol] = await Promise.all([usdc.decimals(), usdc.symbol()]);
  if (Number(decimals) !== 6) throw new Error(`Expected 6-decimal USDC, got ${decimals}`);
  console.log(`USDC           : ${symbol} @ ${usdcAddress} (decimals ${decimals})`);

  // ---------------------------------------------------------------- deploy
  console.log("Deploying PredictionArena ...");
  const Arena = await ethers.getContractFactory("PredictionArena");
  const arena = await Arena.deploy(usdcAddress, feeReceiver, deployer.address);
  const tx = arena.deploymentTransaction();
  await arena.waitForDeployment();

  const address = await arena.getAddress();
  const receipt = await tx?.wait();

  // Public RPCs are load-balanced: the receipt can be returned by a node whose state is still
  // behind, so `owner()` right after deployment decodes to 0x. Wait for bytecode visibility and
  // retry every readback instead of aborting a transaction that already succeeded.
  async function waitForCode(address_: string, attempts = 30) {
    for (let i = 0; i < attempts; i++) {
      const code = await ethers.provider.getCode(address_);
      if (code !== "0x") return true;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    return false;
  }

  async function readRetry<T>(label: string, fn: () => Promise<T>, fallback: T, attempts = 12): Promise<T> {
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
    }
    console.warn(`  ⚠ could not read ${label} after ${attempts} attempts (RPC lag) — check the explorer`);
    return fallback;
  }

  const visible = await waitForCode(address);
  if (!visible) {
    console.warn("  ⚠ deployed address has no bytecode yet — the node is lagging; verify on Basescan");
  }
  const deployedAt = receipt?.blockNumber ?? 0;

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`PredictionArena : ${address}`);
  console.log(`Tx hash         : ${tx?.hash ?? "n/a"}`);
  console.log(`Block           : ${deployedAt}`);
  const owner = await readRetry("owner", () => arena.owner(), "(unknown)");
  const vault = await readRetry("feeVault", () => arena.feeVault(), feeReceiver);
  const minBet = await readRetry("MIN_BET", () => arena.MIN_BET(), 0n);
  const capMax = await readRetry("MAX_BET", () => arena.MAX_BET(), 0n);
  console.log(`Owner           : ${owner}`);
  console.log(`feeVault        : ${vault}`);
  if (String(vault).toLowerCase() !== feeReceiver.toLowerCase()) {
    console.warn("  ⚠ feeVault does not match FEE_RECEIVER — investigate before sending funds");
  }
  console.log(`MIN_BET         : ${ethers.formatUnits(minBet, 6)} USDC`);
  console.log(`Max ticket     : ${ethers.formatUnits(capMax, 6)} USDC`);
  console.log(`Fee             : ${Number(await readRetry("fee bps", () => arena.PLATFORM_FEE_BPS(), 0n)) / 100}%`);
  console.log(
    `Referral        : ${Number(await arena.REFERRAL_SHARE_BPS()) / 100}% of fee ` +
      `(= ${(Number(await arena.PLATFORM_FEE_BPS()) * Number(await arena.REFERRAL_SHARE_BPS())) / 1e6}% of stake)`
  );
  console.log("──────────────────────────────────────────────────────────────");
  console.log("Add to .env:");
  console.log(`ARENA_ADDRESS=${address}`);
  console.log(`USDC_ADDRESS=${usdcAddress}`);

  syncFrontendEnv(address, usdcAddress, chainId);

  // ------------------------------------------------- optional Safe handoff
  const safe = (process.env.SAFE_ADDRESS ?? process.env.GNOSIS_SAFE ?? "").trim();
  if (safe) {
    if (!ethers.isAddress(safe) || safe === ethers.ZeroAddress) {
      throw new Error(`SAFE_ADDRESS is not a valid address (got "${safe}")`);
    }
    if (safe.toLowerCase() === deployer.address.toLowerCase()) {
      console.log("SAFE_ADDRESS equals the deployer — ownership left on the deployer EOA");
    } else {
      console.log(`Transferring ownership → Gnosis Safe ${safe} ...`);
      const handoff = await arena.transferOwnership(safe);
      await handoff.wait();
      const finalOwner = await arena.owner();
      if (finalOwner.toLowerCase() !== safe.toLowerCase()) {
        throw new Error(`Ownership handoff failed: owner is ${finalOwner}`);
      }
      console.log(`Owner           : ${finalOwner} (Safe, verified on-chain)`);
    }
  } else {
    console.log("⚠ SAFE_ADDRESS not set — owner is still the deployer EOA.");
    console.log("  Transfer to a Gnosis Safe before mainnet: arena.transferOwnership(<safe>)");
  }

  const explorer = chainId === 8453 ? "https://basescan.org" : chainId === 84532 ? "https://sepolia.basescan.org" : "";
  if (explorer) {
    console.log("──────────────────────────────────────────────────────────────");
    console.log(`Explorer        : ${explorer}/address/${address}`);
    console.log("Verify with (Etherscan V2 — hardhat-verify 2.x posts chainid in the body and fails):");
    console.log(`  bash scripts/verify-basescan.sh ${address}`);
  }
  console.log("──────────────────────────────────────────────────────────────");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
