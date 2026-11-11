#!/usr/bin/env bun
/**
 * Unmatched-bet watchdog — makes the "first bettor is not trapped" promise operational.
 *
 * The board's real conversion killer is not the missing number, it is this: a lone bettor's
 * stake sits on a one-sided pari-mutuel pool. `settle()` reverts with NoWinningStake if the
 * other side is empty, so the owner can only `cancelPool()` — which is what actually refunds
 * 100% of gross stake (principal + the 4% rake) via `claimRefund()`.
 *
 * That refund path exists in the contract today (no new deployment needed). What was missing is
 * someone who actually calls it. This script is that someone: any open pool that has real stake
 * on exactly one side and has stayed that way for `graceHours` gets canceled, on chain, with the
 * tx hash logged. After that the bettor's claim is a single click on the market page.
 *
 *   bun scripts/unmatched-watchdog.ts                 # dry run: what would be canceled
 *   bun scripts/unmatched-watchdog.ts --live          # send cancelPool txs (needs owner key)
 *   bun scripts/unmatched-watchdog.ts --live --grace-hours=48 --max=3
 *
 * Deliberately conservative:
 *   - grace window is measured from the first hour this script saw the pool one-sided
 *     (persisted in .data/solo-watch.json), not from the bet's block time;
 *   - never touches a pool with stake on both sides, or with zero stake on both sides;
 *   - --max caps how many pools a single run can void, so a bug cannot empty the whole board.
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Contract, JsonRpcProvider, Wallet, parseUnits } from "ethers";

const ROOT = join(import.meta.dir, "..");
const DATA = join(ROOT, ".data");
const STATE = join(DATA, "solo-watch.json");
const LOG = join(DATA, "solo-watch.jsonl");

const arg = (name: string, fallback: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
};
const LIVE = process.argv.includes("--live");
const GRACE_HOURS = Number(arg("grace-hours", "24"));
const MAX_CANCELS = Number(arg("max", "3"));

const ABI = [
  "function getPool(uint256) view returns (tuple(string question, string category, uint64 endTime, uint8 winningOption, uint8 status, uint256 totalNetPool, uint256 option0Pool, uint256 option1Pool, bytes32 settlementHash))",
  "function cancelPool(uint256 poolId)",
];

const raw = JSON.parse(readFileSync(join(ROOT, "frontend/public/pools.json"), "utf8")) as {
  address: string;
  pools: { id: string | number; title: string; status?: number }[];
};

const rpc = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const provider = new JsonRpcProvider(rpc, 8453);
const arena = new Contract(raw.address, ABI, provider);

type State = Record<string, string>;
const state: State = existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as State) : {};
mkdirSync(DATA, { recursive: true });

const now = Date.now();
const solo: { id: string; title: string; net: bigint; side: 0 | 1 }[] = [];

for (const p of raw.pools) {
  if ((p.status ?? 1) !== 1) continue;
  try {
    const row = (await arena.getPool(BigInt(p.id))) as unknown as unknown[];
    const status = Number(row[4]);
    if (status !== 1) continue; // settled / canceled / missing on chain
    const net = BigInt(row[5] as bigint);
    const o0 = BigInt(row[6] as bigint);
    const o1 = BigInt(row[7] as bigint);
    if (net === 0n) continue; // never had a bet — nothing to protect
    if (o0 > 0n && o1 > 0n) continue; // two-sided, leave it alone
    solo.push({ id: String(p.id), title: p.title, net, side: o0 > 0n ? 0 : 1 });
  } catch {
    /* unreadable on this RPC pass — retry next run */
  }
}

// Age every solo pool from the first time we saw it one-sided.
for (const s of solo) if (!state[s.id]) state[s.id] = new Date(now).toISOString();
// Forget pools that are no longer solo so a later one-sided round restarts the clock.
const soloIds = new Set(solo.map((s) => s.id));
for (const id of Object.keys(state)) if (!soloIds.has(id)) delete state[id];
writeFileSync(STATE, JSON.stringify(state, null, 2));

const eligible = solo.filter((s) => {
  const seen = Date.parse(state[s.id]);
  return Number.isFinite(seen) && now - seen >= GRACE_HOURS * 3600_000;
});

console.log(`rpc ${rpc.replace(/\/[^/]*$/, "/…")} · arena ${raw.address}`);
console.log(`one-sided pools with stake: ${solo.length} · past ${GRACE_HOURS}h grace: ${eligible.length}`);
for (const s of solo) {
  const age = ((now - Date.parse(state[s.id])) / 3600_000).toFixed(1);
  console.log(`  #${s.id} side=${s.side} net=${Number(s.net) / 1e6} USDC age=${age}h ${s.title.slice(0, 58)}`);
}

if (!eligible.length) process.exit(0);
if (!LIVE) {
  console.log(`\ndry run — would cancel ${Math.min(eligible.length, MAX_CANCELS)} pool(s). Re-run with --live.`);
  process.exit(0);
}

const pk = process.env.PRIVATE_KEY;
if (!pk) {
  console.error("PRIVATE_KEY missing; refusing to run live");
  process.exit(1);
}
const wallet = new Wallet(pk, provider);
const owner = await arena.owner();
if ((await wallet.getAddress()).toLowerCase() !== String(owner).toLowerCase()) {
  console.error(`signer ${wallet.address} is not arena owner ${owner}`);
  process.exit(1);
}

// Gas guard: Base is cheap but a zero-balance key must fail loudly, not silently.
const bal = await provider.getBalance(wallet.address);
const MIN_GAS = parseUnits("0.00002", 18); // ~ a few hundred k gas at current Base prices
if (bal < MIN_GAS) {
  console.error(`owner gas ${bal} below guard ${MIN_GAS}; top up before live runs`);
  process.exit(1);
}

let sent = 0;
for (const s of eligible.slice(0, MAX_CANCELS)) {
  try {
    const tx = await arena.cancelPool(BigInt(s.id));
    const rc = await tx.wait();
    sent++;
    const line = {
      at: new Date().toISOString(),
      poolId: s.id,
      side: s.side,
      lockedUsdc: Number(s.net) / 1e6,
      tx: rc?.hash ?? tx.hash,
      block: rc?.blockNumber ?? null,
    };
    appendFileSync(LOG, JSON.stringify(line) + "\n");
    console.log(`canceled #${s.id} (${line.lockedUsdc} USDC refundable) tx=${line.tx}`);
  } catch (e) {
    console.error(`cancel #${s.id} failed: ${(e as Error).message.slice(0, 160)}`);
  }
}
console.log(`\nlive: canceled ${sent}/${eligible.length} eligible pool(s)`);
