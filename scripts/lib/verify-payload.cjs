// Builds the Etherscan V2 verification payload from Hardhat build-info.
// Usage: node scripts/lib/verify-payload.cjs <arenaAddress> [contractPath:Name] [ownerOverride]
// Writes /tmp/arena-solc-input.json + /tmp/arena-ctor-args.txt and prints JSON metadata on stdout.
const fs = require("node:fs");
const path = require("node:path");
const { AbiCoder, Wallet } = require("ethers");

const root = path.join(__dirname, "..", "..");
const address = process.argv[2];
const contract = process.argv[3] || "contracts/PredictionArena.sol:PredictionArena";
const ownerOverride = process.argv[4];

const env = {};
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const usdc = env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const feeReceiver = env.FEE_RECEIVER;
let key = env.PRIVATE_KEY || "";
if (/^[0-9a-fA-F]{64}$/.test(key)) key = `0x${key}`;
const owner = ownerOverride || (key ? new Wallet(key).address : "");
if (!owner) throw new Error("owner unknown: pass it as the 3rd argument");

// newest build-info that actually contains this contract
const dir = path.join(root, "artifacts", "build-info");
const candidates = fs
  .readdirSync(dir)
  .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

let picked = null;
for (const { f } of candidates) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  if (j.input?.sources?.[contract.split(":")[0]]) {
    picked = { f, j };
    break;
  }
}
if (!picked) throw new Error(`no build-info contains ${contract} — run bun run compile first`);

fs.writeFileSync("/tmp/arena-solc-input.json", JSON.stringify(picked.j.input));
const ctor = AbiCoder.defaultAbiCoder().encode(["address", "address", "address"], [usdc, feeReceiver, owner]).slice(2);
fs.writeFileSync("/tmp/arena-ctor-args.txt", ctor);

process.stdout.write(
  JSON.stringify({
    contractname: contract,
    compilerversion: `v${picked.j.solcLongVersion}`,
    buildInfo: picked.f,
    sources: Object.keys(picked.j.input.sources).length,
    optimizer: picked.j.input.settings.optimizer,
    evmVersion: picked.j.input.settings.evmVersion || "default",
    address,
    owner,
  })
);
