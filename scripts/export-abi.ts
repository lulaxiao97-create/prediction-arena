import { artifacts } from "hardhat";
import * as dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// override:true — the .env file is authoritative; a stale exported PRIVATE_KEY in the
// shell must never silently win over the file (that is how a test key reaches mainnet).
dotenv.config({ override: true });

/**
 * Exports the compiled ABI + deployment metadata into the frontend so the dApp never
 * hand-maintains a copy of the interface (drift between contract and UI = wrong calldata).
 */
async function main() {
  const artifact = await artifacts.readArtifact("PredictionArena");

  const payload = {
    contractName: artifact.contractName,
    chainId: Number(process.env.CHAIN_ID ?? 8453),
    address: (process.env.ARENA_ADDRESS ?? "").trim(),
    exportedAt: new Date().toISOString(),
    abi: artifact.abi,
  };

  const dir = join(__dirname, "..", "frontend", "src", "lib", "contracts");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, "PredictionArena.json");
  writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");

  console.log(`ABI exported → ${out}`);
  console.log(`  contract : ${payload.contractName}`);
  console.log(`  chainId  : ${payload.chainId}`);
  console.log(`  address  : ${payload.address || "(empty — set ARENA_ADDRESS and re-run)"}`);
  console.log(`  entries  : ${payload.abi.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
