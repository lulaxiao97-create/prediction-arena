import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";

for (const k of ["PRIVATE_KEY","FEE_RECEIVER","SAFE_ADDRESS","BASESCAN_API_KEY","USDC_ADDRESS","BASE_RPC_URL","BASE_SEPOLIA_RPC_URL"]) delete process.env[k];
// override:true — the .env file is authoritative; a stale exported PRIVATE_KEY in the
// shell must never silently win over the file (that is how a test key reaches mainnet).
dotenv.config({ override: true });

/**
 * Pre-flight for a real mainnet deployment. Exits non-zero on any problem so a wrapper script
 * never broadcasts with a bad config.
 *
 *   bunx hardhat run scripts/preflight-env.ts --network base
 *
 * Config problems are reported without touching the network, so a missing .env gives a readable
 * message instead of Hardhat's "no signer" stack trace.
 */

const MIN_BALANCE = ethers.parseEther("0.001");
const USDC_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function main() {
  const problems: string[] = [];
  // accept a bare 64-hex key (wallets often show it without 0x)
  const rawKey = (process.env.PRIVATE_KEY ?? "").trim();
  const key = /^[0-9a-fA-F]{64}$/.test(rawKey) ? `0x${rawKey}` : rawKey;
  const feeReceiver = (process.env.FEE_RECEIVER ?? "").trim();
  const safe = (process.env.SAFE_ADDRESS ?? "").trim();
  const usdcAddress = (process.env.USDC_ADDRESS ?? USDC_MAINNET).trim();

  const keyOk = /^0x[0-9a-fA-F]{64}$/.test(key) && !/^0x0+$/.test(key);
  if (!keyOk) problems.push("PRIVATE_KEY is missing, malformed, or still the all-zero placeholder");
  if (!ethers.isAddress(feeReceiver) || feeReceiver === ethers.ZeroAddress) {
    problems.push("FEE_RECEIVER is missing / zero / not a valid address");
  }
  if (safe && (!ethers.isAddress(safe) || safe === ethers.ZeroAddress)) {
    problems.push("SAFE_ADDRESS is set but invalid");
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`Config file  : ${process.env.DOTENV_CONFIG_PATH ?? ".env (auto-loaded by hardhat)"}`);
  console.log(`Network      : ${network.name}`);
  console.log(`PRIVATE_KEY  : ${key ? `${key.slice(0, 2)}…${key.length} chars` : "MISSING"}`);
  console.log(`FEE_RECEIVER : ${feeReceiver || "MISSING"}`);
  console.log(`SAFE_ADDRESS : ${safe || "(none — ownership stays on the deployer EOA)"}`);
  console.log("──────────────────────────────────────────────────────────────");

  if (problems.length) {
    console.error("PREFLIGHT FAILED:");
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error("Fix .env (cp .env.example .env) and re-run.");
    process.exitCode = 1;
    return;
  }

  const wallet = new ethers.Wallet(key) as unknown as { address: string };
  const net = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(wallet.address);
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;

  const Arena = await ethers.getContractFactory("PredictionArena");
  const deployTx = await Arena.getDeployTransaction(usdcAddress, feeReceiver, wallet.address);
  const estimatedGas = await ethers.provider.estimateGas({ ...deployTx, from: wallet.address });
  const estimatedCost = estimatedGas * gasPrice;

  console.log(`Deployer     : ${wallet.address}`);
  console.log(`chainId      : ${net.chainId} ${Number(net.chainId) === 8453 ? "(Base Mainnet ✓)" : ""}`);
  console.log(`ETH balance  : ${ethers.formatEther(balance)} ETH`);
  console.log(`Gas price    : ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  console.log(`Est. deploy  : ${estimatedGas.toString()} gas ≈ ${ethers.formatEther(estimatedCost)} ETH`);
  console.log("──────────────────────────────────────────────────────────────");

  if (Number(net.chainId) !== 8453) {
    problems.push(`expected chainId 8453, RPC returned ${net.chainId}`);
  }
  if (balance < MIN_BALANCE) {
    problems.push(`balance ${ethers.formatEther(balance)} ETH is below the 0.001 ETH floor`);
  }
  if (balance < estimatedCost) {
    problems.push(
      `balance ${ethers.formatEther(balance)} ETH cannot cover the deployment (${ethers.formatEther(
        estimatedCost
      )} ETH)`
    );
  }

  const code = await ethers.provider.getCode(usdcAddress);
  if (code === "0x") {
    problems.push(`no contract deployed at USDC ${usdcAddress}`);
  } else {
    const usdc = new ethers.Contract(
      usdcAddress,
      ["function symbol() view returns (string)", "function decimals() view returns (uint8)"],
      ethers.provider
    );
    const [symbol, decimals] = await Promise.all([usdc.symbol(), usdc.decimals()]);
    console.log(`USDC         : ${symbol} @ ${usdcAddress} (decimals ${decimals})`);
    if (Number(decimals) !== 6) problems.push(`USDC decimals ${decimals} != 6`);
    if (usdcAddress.toLowerCase() !== USDC_MAINNET.toLowerCase()) {
      console.log("⚠ USDC_ADDRESS differs from the canonical Base USDC — make sure this is intentional");
    }
    if (!feeReceiver || !ethers.isAddress(feeReceiver)) problems.push("feeVault would be an invalid address");
  }

  if (problems.length) {
    console.error("PREFLIGHT FAILED:");
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log("PREFLIGHT OK — safe to deploy");
}

main().catch((error) => {
  console.error("PREFLIGHT ERROR:", error.shortMessage || error.message);
  process.exitCode = 1;
});
