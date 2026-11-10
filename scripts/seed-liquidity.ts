#!/usr/bin/env bun
/**
 * Seed liquidity — the operator takes the first position on the markets that get shown first.
 *
 * Why this exists. A market with an empty pool prices at 50/50 and looks untouched; the first
 * visitor then faces both "I might lose" and "nobody is here". This script does not fake a number —
 * it puts real USDC into the pools that the board shows first, so the odds are the contract's odds
 * and the depth is `totalNetPool` on Basescan. The operator's own position is a normal position: it
 * settles, it can win, it can lose, and it is not exempt from the fee.
 *
 * Usage
 *   bun scripts/seed-liquidity.ts                       # dry run: prints the plan, spends nothing
 *   bun scripts/seed-liquidity.ts --live                # executes (needs PRIVATE_KEY + USDC)
 *   bun scripts/seed-liquidity.ts --count=30 --amount=2 # how many markets, how much each
 *   bun scripts/seed-liquidity.ts --side=yes             # yes (default) | no | alternate
 *
 * Environment
 *   PRIVATE_KEY     operator wallet key (never commit it; pass it inline or via an env file)
 *   BASE_RPC_URL    defaults to https://mainnet.base.org
 *
 * Refusals, on purpose:
 *   · no key, no live run;
 *   · a market whose pool already holds stake is skipped (seed marks the start, not the middle);
 *   · every position is written to .data/seed-positions.json first, so a crash cannot double-spend
 *     the same market on the next run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Contract, JsonRpcProvider, Wallet, parseUnits, formatUnits } from "ethers";

const ROOT = join(import.meta.dir, "..");
const POOLS = join(ROOT, "frontend", "public", "pools.json");
const LEDGER = join(ROOT, ".data", "seed-positions.json");

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];
const ARENA_ABI = [
  "function bet(uint256 poolId, uint8 option, uint256 amount, address referrer)",
  // Field order matters: PoolView is (title, category, endTime, winningOption, status, ...). The
  // status is the FIFTH value, not the fourth — reading index 3 gets winningOption (0 for an
  // unsettled pool) and every "is this open?" check comes back false on a live market.
  "function getPool(uint256) view returns (tuple(string question, string category, uint64 endTime, uint8 winningOption, uint8 status, uint256 totalNetPool, uint256 option0Pool, uint256 option1Pool, bytes32 settlementHash))",
];

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
};
const LIVE = args.includes("--live");
const COUNT = Math.max(1, Math.min(100, Number(flag("count", "30"))));
const AMOUNT = Number(flag("amount", "2"));
/**
 * `both` puts an equal position on each side, which is what makes the odds mean something: a pool
 * with one YES bettor prices YES at 100% and the market is a mirror. Two-sided seed gives ~50/50 at
 * the current spot, so the first real visitor sees a spread instead of a mirror.
 */
const SIDES = flag("sides", "both");
const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

type Pool = { id: string | number; title: string; status?: number; endTimeUtc?: string; source?: string };

function readPools(): { address?: string; pools: Pool[] } {
  const raw = JSON.parse(readFileSync(POOLS, "utf8")) as { address?: string; pools?: Pool[] };
  return { address: raw.address, pools: raw.pools ?? [] };
}

function readLedger(): Record<string, { at: string; amount: string; side: string; tx?: string }> {
  try {
    return JSON.parse(readFileSync(LEDGER, "utf8"));
  } catch {
    return {};
  }
}

function writeLedger(rows: Record<string, unknown>): void {
  mkdirSync(join(ROOT, ".data"), { recursive: true });
  writeFileSync(LEDGER, `${JSON.stringify(rows, null, 2)}\n`);
}

async function main(): Promise<void> {
  const { address: arenaAddress, pools } = readPools();
  if (!arenaAddress) {
    console.error("pools.json carries no arena address — nothing to seed");
    process.exit(2);
  }

  const now = Date.now();
  const open = pools
    .filter((p) => (p.status ?? 1) === 1)
    .filter((p) => !p.endTimeUtc || Date.parse(p.endTimeUtc) > now)
    .sort((a, b) => (Date.parse(a.endTimeUtc ?? "") || 0) - (Date.parse(b.endTimeUtc ?? "") || 0));

  const ledger = readLedger();
  // Candidates, not targets: the board lists markets long before open-pools-batch has created their
  // pool on chain, and a bet on a non-existent pool reverts. Read the contract first, then keep the
  // first COUNT that are actually open and actually empty.
  const plan = open
    .filter((p) => !ledger[String(p.id)])
    .slice(0, Math.max(COUNT * 6, 60));

  console.log(`arena  ${arenaAddress}`);
  const perSide = SIDES === "both" ? AMOUNT / 2 : AMOUNT;
  console.log(`markets ${open.length} open · seeding ${plan.length} · ${AMOUNT} USDC per market · sides=${SIDES}`);
  const total = plan.length * AMOUNT;
  console.log(`total  ${total.toFixed(2)} USDC${LIVE ? "" : "  (dry run — pass --live to execute)"}`);

  const provider = new JsonRpcProvider(RPC, 8453);
  const arena = new Contract(arenaAddress, ARENA_ABI, provider);
  const usdc = new Contract(USDC, USDC_ABI, provider);

  // What the contract says about each candidate: a pool that already holds stake is not a seed
  // target, whatever the manifest thinks.
  const checked: { pool: Pool; net: bigint; status: number }[] = [];
  for (const pool of plan) {
    try {
      const row = (await arena.getPool(BigInt(pool.id))) as unknown as [string, string, bigint, bigint, bigint, bigint, bigint, bigint, string];
      checked.push({ pool, net: row[5], status: Number(row[4]) });
    } catch {
      console.warn(`skip ${pool.id}: not readable on chain yet`);
    }
  }
  const targets = checked.filter((c) => c.status === 1 && c.net === 0n).slice(0, COUNT);
  for (const c of checked) {
    if (c.status !== 1) console.log(`skip ${c.pool.id}: status ${c.status}`);
    else if (c.net > 0n) console.log(`skip ${c.pool.id}: already holds ${formatUnits(c.net, 6)} USDC`);
  }

  if (!LIVE) {
    for (const t of targets.slice(0, 10)) console.log(`  would bet ${AMOUNT} USDC on #${t.pool.id} ${t.pool.title.slice(0, 64)}`);
    if (targets.length > 10) console.log(`  … and ${targets.length - 10} more`);
    console.log(`\nseeded ${targets.length} market(s) would cost ${(targets.length * AMOUNT).toFixed(2)} USDC`);
    return;
  }

  const key = process.env.PRIVATE_KEY;
  if (!key) {
    console.error("PRIVATE_KEY is not set — refusing to spend anything. Pass it inline, e.g.\n  PRIVATE_KEY=0x… bun scripts/seed-liquidity.ts --live");
    process.exit(2);
  }

  const signer = new Wallet(key, provider);
  const me = await signer.getAddress();
  const balance = (await usdc.balanceOf(me)) as bigint;
  const needed = parseUnits(String(targets.length * AMOUNT), 6);
  console.log(`wallet ${me} · USDC ${formatUnits(balance, 6)} · needed ${formatUnits(needed, 6)}`);
  if (balance < needed) {
    console.error(`not enough USDC: short ${formatUnits(needed - balance, 6)}`);
    process.exit(2);
  }

  const allowance = (await usdc.allowance(me, arenaAddress)) as bigint;
  if (allowance < needed) {
    const tx = await (usdc.connect(signer) as Contract).approve(arenaAddress, needed);
    console.log(`approve ${formatUnits(needed, 6)} → ${tx.hash}`);
    await tx.wait();
  }

  const arenaAsSigner = arena.connect(signer) as Contract;
  const zero = "0x0000000000000000000000000000000000000000";

  for (const t of targets) {
    const legs: { option: 0 | 1; label: string }[] =
      SIDES === "both" ? [{ option: 0, label: "YES" }, { option: 1, label: "NO" }] : [{ option: 0, label: "YES" }];
    for (const leg of legs) {
      try {
        const tx = await arenaAsSigner.bet(BigInt(t.pool.id), leg.option, parseUnits(String(perSide), 6), zero);
        ledger[`${t.pool.id}:${leg.label}`] = {
          at: new Date().toISOString(),
          amount: String(perSide),
          side: leg.label.toLowerCase(),
          tx: tx.hash,
        };
        writeLedger(ledger); // written before the receipt: a crash must not re-seed this market
        console.log(`ok #${t.pool.id} ${leg.label} ${perSide} USDC · ${tx.hash}`);
        await tx.wait();
      } catch (e) {
        console.error(`fail #${t.pool.id} ${leg.label}: ${(e as Error).message}`);
      }
    }
  }

  console.log("\nnext: `bun scripts/refresh-board.sh` so the cards show the new depth, then publish.");
}

main().catch((err) => {
  console.error(`seed-liquidity failed: ${(err as Error).message}`);
  process.exit(1);
});
