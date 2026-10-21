import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import "solidity-coverage";
import * as dotenv from "dotenv";

// Wipe inherited copies before loading .env: dotenv's override only touches keys that exist in
// the file, so a leftover `export USDC_ADDRESS=<local mock>` would otherwise leak into a
// mainnet deployment. .env is the single source of truth.
for (const k of [
  "PRIVATE_KEY",
  "FEE_RECEIVER",
  "SAFE_ADDRESS",
  "BASESCAN_API_KEY",
  "USDC_ADDRESS",
  "BASE_RPC_URL",
  "BASE_SEPOLIA_RPC_URL",
  "CHAIN_ID",
]) {
  delete process.env[k];
}
dotenv.config({ override: true });

const PRIVATE_KEY = process.env.PRIVATE_KEY?.trim();
// Only inject local accounts when a key is present: an empty `accounts: []` would leave the
// HTTP networks without any signer, while omitting it makes them use the node's own accounts.
const accountsField = PRIVATE_KEY
  ? { accounts: [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`] }
  : {};

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Paris keeps the bytecode free of PUSH0 so the same artifact verifies on any EVM L2.
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      allowUnlimitedContractSize: false,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    base: {
      url: process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org",
      chainId: 8453,
      ...accountsField,
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL?.trim() || "https://sepolia.base.org",
      chainId: 84532,
      ...accountsField,
    },
  },
  etherscan: {
    // A single string (not a per-network map) switches hardhat-verify to the Etherscan V2 API,
    // which is required now that the v1 basescan endpoint is sunset. The chainid is derived from
    // the network config (8453 for `base`).
    apiKey: process.env.BASESCAN_API_KEY?.trim() || "",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 120_000,
  },
};

export default config;
