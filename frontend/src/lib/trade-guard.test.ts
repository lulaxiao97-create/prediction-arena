/**
 * Guard ordering tests. Run with: node --experimental-strip-types src/lib/trade-guard.test.ts
 * (Node 22+; this repo runs Node 26 where type stripping is on by default.)
 *
 * The balance/gas cases are gone on purpose: the CTA no longer gates on `balanceOf`. What is left
 * to assert is that an empty wallet reaches `ok` (so the button stays live) and that the amount
 * window is still enforced.
 */
import assert from "node:assert/strict";
import { resolveTradeGuard, quickAmountsFor } from "./trade-guard.ts";

const U = (n: number) => BigInt(n) * 1_000_000n;

const base = {
  address: "0x1111111111111111111111111111111111111111" as string,
  wrongChain: false,
  live: true,
  amount: U(100),
  cap: U(10_000),
  minBet: U(50),
};

const cases: [string, Record<string, unknown>, string][] = [
  ["no wallet connected", { address: undefined }, "no-wallet"],
  ["wrong chain", { wrongChain: true }, "wrong-chain"],
  ["demo market", { live: false }, "demo"],
  ["empty amount", { amount: 0n }, "empty-amount"],
  ["above per-trade cap", { amount: U(10_001) }, "above-cap"],
  ["below the minimum", { amount: U(49) }, "below-min"],
  ["all good", {}, "ok"],
];

let pass = 0;
for (const [label, override, expected] of cases) {
  const got = resolveTradeGuard({ ...base, ...override } as never);
  assert.equal(got, expected, `${label}: expected ${expected}, got ${got}`);
  console.log(`  ok  ${label.padEnd(28)} → ${got}`);
  pass++;
}

// A wallet that has never held USDC (or ETH) must still be allowed to press the button: the wallet
// is the thing that reports "insufficient funds", not a client-side read that turns the CTA off.
// Any balance-shaped field a caller still passes is ignored rather than treated as a blocker.
assert.equal(
  resolveTradeGuard({ ...base, usdcBalance: 0n, ethBalance: 0n } as never),
  "ok",
  "a zero balance must not disable the CTA"
);
console.log("  ok  zero USDC + zero ETH        → ok (wallet decides)");
pass++;

// exactly at the cap is allowed
assert.equal(resolveTradeGuard({ ...base, amount: U(10_000) } as never), "ok");
console.log("  ok  boundaries inclusive         → ok");
pass++;

// quick chips follow the live cap
assert.deepEqual(quickAmountsFor(U(50)), [50]);
assert.deepEqual(quickAmountsFor(U(600)), [50, 100, 500]);
assert.deepEqual(quickAmountsFor(U(10_000)), [50, 100, 500, 1_000, 5_000, 10_000]);
console.log("  ok  quick chips: cap 50 → [50]");
console.log("  ok  quick chips: cap 600 → [50,100,500]");

console.log(`\n${pass} assertions passed`);
