/**
 * PROOF #1: "the source I audited is byte-for-byte the code running on Base".
 *
 *   bun run audit/onchain-attack/04-bytecode-proof.ts
 *
 * Method (strongest available): compare the locally compiled `deployedBytecode` against
 * `eth_getCode`, after normalising the only two things that may legitimately differ:
 *   1. constructor-injected immutables (the artifact carries zeros, mainnet carries the real
 *      USDC address). A diff region where the LOCAL side is all-zero and the CHAIN side is a
 *      20-byte address is an immutable slot, not a logic difference.
 *   2. the trailing CBOR metadata (holds an IPFS hash of the build inputs).
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";

const ARENA = "0x36f1bFbE3E0d0FA0941C031be278149D33f65684";
const RPC = process.env.RPC_URL ?? "https://mainnet.base.org";

const art = JSON.parse(
  readFileSync(new URL("../../artifacts/contracts/PredictionArena.sol/PredictionArena.json", import.meta.url), "utf8")
);

function stripMetadata(buf: Buffer): { body: Buffer; metaLen: number } {
  const metaLen = buf.readUInt16BE(buf.length - 2);
  return { body: buf.subarray(0, buf.length - 2 - metaLen), metaLen };
}

(async () => {
  const p = new ethers.JsonRpcProvider(RPC);
  const onchainHex = (await p.getCode(ARENA)).slice(2);
  const localHex = (art.deployedBytecode as string).replace(/^0x/, "");

  const loc = stripMetadata(Buffer.from(localHex, "hex"));
  const onc = stripMetadata(Buffer.from(onchainHex, "hex"));
  const a = Buffer.from(loc.body);
  const b = Buffer.from(onc.body);

  console.log("local   artifact runtime :", localHex.length / 2, "bytes (metadata", loc.metaLen, "B)");
  console.log("onchain eth_getCode       :", onchainHex.length / 2, "bytes (metadata", onc.metaLen, "B)");
  console.log("code section compared     :", a.length, "bytes\n");

  if (a.length !== b.length) {
    console.log("❌ VERDICT: length mismatch — the deployed code is NOT this build.");
    process.exitCode = 1;
    return;
  }

  // group contiguous diff bytes into regions
  const regions: { s: number; e: number }[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      const last = regions[regions.length - 1];
      if (last && i <= last.e + 4) last.e = i;
      else regions.push({ s: i, e: i });
    }
  }

  let immutableSlots = 0;
  let immutableValue = "";
  const unexplained: { s: number; e: number }[] = [];
  const zero = Buffer.alloc(32);
  for (const r of regions) {
    const localSide = a.subarray(r.s, r.e + 1);
    const chainSide = b.subarray(r.s, r.e + 1);
    const localAllZero = localSide.every((x) => x === 0);
    const isAddress = r.e - r.s + 1 === 20 && !chainSide.every((x) => x === 0);
    if (localAllZero && isAddress) {
      if (!immutableValue) immutableValue = "0x" + chainSide.toString("hex");
      immutableSlots++;
      zero.copy(a, r.s, 0, r.e - r.s + 1); // normalise the local side
      zero.copy(b, r.s, 0, r.e - r.s + 1); // and the chain side
    } else {
      unexplained.push(r);
    }
  }

  let remaining = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) remaining++;

  console.log(`diff regions found        : ${regions.length}`);
  console.log(`immutable slots (local=0) : ${immutableSlots}  → ${regions
    .filter((r) => a.subarray(r.s, r.e + 1).every((x) => x === 0))
    .length} normalised`);
  if (immutableSlots) {
    console.log(`immutable value           : ${immutableValue} (USDC — constructor arg)`);
  }
  console.log(`unexplained diff regions  : ${unexplained.length}`);
  unexplained.slice(0, 5).forEach((r) => console.log(`   ${r.s}..${r.e}`));
  console.log(`bytes still differing     : ${remaining}\n`);

  if (unexplained.length === 0 && remaining === 0) {
    console.log("✅ VERDICT: the audited source compiles to exactly the on-chain runtime.");
    console.log("   Every difference is a constructor-injected immutable or the metadata hash.");
    console.log("   → auditing contracts/PredictionArena.sol IS auditing 0x36f1…5684.");
  } else {
    console.log("❌ VERDICT: mismatch — do NOT trust the source audit for this address.");
    process.exitCode = 1;
  }

  const tail = onchainHex.slice(-86);
  console.log("\nmetadata tail:", "0x" + tail);
  const solc = tail.match(/736f6c6343([0-9a-f]{6})/);
  if (solc) {
    const v = parseInt(solc[1], 16);
    console.log(`solc version in metadata: 0.${(v >> 8) & 0xff}.${v & 0xff}`);
  }
})();
