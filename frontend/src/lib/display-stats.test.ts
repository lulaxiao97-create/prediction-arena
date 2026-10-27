/**
 * Odds-fallback tests. Run with: node --experimental-strip-types src/lib/display-stats.test.ts
 *
 * The rule this locks in: a YES/NO button always prints a multiple. An empty or one-sided pool
 * must fall back to fee-net implied odds instead of rendering `—`, which is what made the first
 * cards on the board look broken.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  displayStatsFor,
  fallbackShareFor,
  feeNetOdds,
  poolSideMultiplier,
  poolSideShare,
  poolStats,
} from "./display-stats.ts";

const U = (n: number) => BigInt(Math.round(n)) * 1_000_000n;

let pass = 0;
const ok = (label: string) => {
  console.log(`  ok  ${label}`);
  pass++;
};

// 1) The stated example: p = 0.5 net of the 4% fee is exactly 1.92x.
assert.equal(Number(feeNetOdds(0.5).toFixed(2)), 1.92, "50% must print 1.92x");
ok("50% implied → 1.92x");

// 2) An empty pool (chain row, no stake yet) still gets two different, finite multiples.
const empty = { id: 1_759_000_001n, totalNetPool: 0n, option0Pool: 0n, option1Pool: 0n };
const m0 = poolSideMultiplier(empty, 0);
const m1 = poolSideMultiplier(empty, 1);
for (const [label, m] of [["YES", m0], ["NO", m1]] as const) {
  assert.ok(Number.isFinite(m) && m > 0, `empty pool ${label} must be a positive finite multiple`);
}
assert.notEqual(m0, m1, "the two sides must not print the same multiple");
ok(`empty pool → ${m0.toFixed(2)}x / ${m1.toFixed(2)}x`);

// 3) Same id, same numbers — deterministic, so a reload cannot reshuffle the board.
assert.deepEqual(poolSideMultiplier(empty, 0), m0);
assert.deepEqual(displayStatsFor(empty.id), displayStatsFor(String(empty.id)));
ok("deterministic per id (bigint and string agree)");

// 4) One side empty: the funded side stays at 1.00x, the empty side is finite (clamped), not ∞.
const oneSided = { id: 42n, totalNetPool: U(1_000), option0Pool: U(1_000), option1Pool: 0n };
assert.equal(Number(poolSideMultiplier(oneSided, 0).toFixed(2)), 1.0);
assert.ok(Number.isFinite(poolSideMultiplier(oneSided, 1)));
ok(`one-sided pool → ${poolSideMultiplier(oneSided, 0).toFixed(2)}x / ${poolSideMultiplier(oneSided, 1).toFixed(2)}x`);

// 5) A funded pool still quotes its real pari-mutuel ratio (fallback must not overwrite it).
const funded = { id: 7n, totalNetPool: U(10_000), option0Pool: U(2_500), option1Pool: U(7_500) };
assert.equal(poolSideMultiplier(funded, 0), 4);
assert.equal(Number(poolSideShare(funded, 0).toFixed(2)), 0.25);
ok("funded pool keeps its real ratio (4.00x on a 25% side)");

// 6) Every listing the board ships must render a multiple on both buttons.
const manifest = JSON.parse(readFileSync(new URL("../../public/pools.json", import.meta.url), "utf8")) as {
  pools: { id: string; liquidityUsdc: string; yesShare: number }[];
};
for (const p of manifest.pools) {
  const total = U(Number(p.liquidityUsdc));
  const pool = {
    id: p.id,
    totalNetPool: total,
    option0Pool: U(Number(p.liquidityUsdc) * p.yesShare),
    option1Pool: total - U(Number(p.liquidityUsdc) * p.yesShare),
  };
  for (const side of [0, 1] as const) {
    const m = poolSideMultiplier(pool, side);
    assert.ok(Number.isFinite(m) && m > 0, `pool ${p.id} side ${side} has no multiple`);
  }
}
ok(`${manifest.pools.length} shipped listings × 2 sides → every button has a multiple`);

// 7) The fallback share stays inside the band the card prints (no 0% / 100% cards).
for (const id of ["700001", "700019", "1759000001"]) {
  const s = fallbackShareFor(id);
  assert.ok(s >= 0.18 && s <= 0.82, `fallback share ${s} outside 0.18–0.82`);
}
ok("fallback share stays inside 18–82%");

// 8) Real liquidity precedence: the moment the contract holds stake, the card prints the chain's
//    number — and stops inventing traders/turnover next to real money.
{
  const demoPool = { id: 700001n, totalNetPool: 0n };
  const demoStats = poolStats(demoPool);
  assert.equal(demoStats.source, "demo", "empty pool must use the demo depth");
  assert.ok(demoStats.liquidityUsdc > 0n, "demo depth must never be zero");
  assert.ok(demoStats.traders !== null, "demo depth carries a trader estimate");

  const livePool = { id: 700001n, totalNetPool: 4_250_000_000n }; // 4,250 USDC
  const liveStats = poolStats(livePool);
  assert.equal(liveStats.source, "chain", "funded pool must report chain liquidity");
  assert.equal(liveStats.liquidityUsdc, 4_250_000_000n, "chain liquidity must be the contract's number");
  assert.equal(liveStats.traders, null, "traders are not indexed on-chain — must be null, not invented");
  assert.equal(liveStats.volume24hUsdc, 0n, "turnover is not indexed on-chain — must be zero, not invented");
}
ok("real stake outranks the demo generator on every card figure");

console.log(`\n${pass} assertions passed`);
