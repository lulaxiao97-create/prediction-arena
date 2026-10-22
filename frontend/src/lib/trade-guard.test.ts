/**
 * Guard ordering tests. Run with: node --experimental-strip-types src/lib/trade-guard.test.ts
 * (Node 22+; this repo runs Node 26 where type stripping is on by default.)
 */
import assert from "node:assert/strict";
import { resolveTradeGuard, quickAmountsFor, GAS_FLOOR } from "./trade-guard.ts";

const U = (n: number) => BigInt(n) * 1_000_000n;
const ETH = (n: number) => BigInt(Math.round(n * 1e18));

const base = {
  address: "0x1111111111111111111111111111111111111111" as string,
  wrongChain: false,
  live: true,
  usdcBalance: U(10_000),
  ethBalance: ETH(0.001),
  amount: U(100),
  cap: U(10_000),
  minBet: U(50),
};

const cases: [string, Record<string, unknown>, string][] = [
  ["no wallet connected", { address: undefined }, "no-wallet"],
  ["wrong chain", { wrongChain: true }, "wrong-chain"],
  ["demo market", { live: false }, "demo"],
  ["empty amount", { amount: 0n }, "empty-amount"],
  ["USDC balance is 0", { usdcBalance: 0n }, "no-usdc"],
  ["amount exceeds USDC balance", { usdcBalance: U(80) }, "insufficient-usdc"],
  ["no ETH for gas", { ethBalance: 0n }, "no-gas"],
  ["above per-trade cap", { amount: U(10_001), usdcBalance: U(20_000) }, "above-cap"],
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

// ordering: a zero balance must win over "amount too big" so the CTA says "deposit", not "cap"
assert.equal(
  resolveTradeGuard({ ...base, usdcBalance: 0n, amount: U(999) } as never),
  "no-usdc",
  "zero balance should outrank the cap check"
);
console.log("  ok  ordering: zero balance beats cap  → no-usdc");
pass++;

// a wallet with USDC but dust ETH must report gas, not "ok"
assert.equal(
  resolveTradeGuard({ ...base, ethBalance: GAS_FLOOR - 1n } as never),
  "no-gas",
  "dust ETH must block"
);
console.log("  ok  gas floor boundary           → no-gas");
pass++;

// exactly at the gas floor and exactly at the cap are allowed
assert.equal(resolveTradeGuard({ ...base, ethBalance: GAS_FLOOR, amount: U(10_000) } as never), "ok");
console.log("  ok  boundaries inclusive         → ok");
pass++;

// unread balances must not block
assert.equal(
  resolveTradeGuard({ ...base, usdcBalance: undefined, ethBalance: undefined } as never),
  "ok",
  "unknown balances are not blockers"
);
console.log("  ok  unknown balances don't block → ok");
pass++;

// quick chips follow the live cap
assert.deepEqual(quickAmountsFor(U(50)), [50]);
assert.deepEqual(quickAmountsFor(U(600)), [50, 100, 500]);
assert.deepEqual(quickAmountsFor(U(10_000)), [50, 100, 500, 1_000, 5_000, 10_000]);
console.log("  ok  quick chips: cap 50 → [50]");
console.log("  ok  quick chips: cap 600 → [50,100,500]");
console.log("  ok  quick chips: cap 10k → full ladder");
pass += 3;

console.log(`\n${pass} assertions passed`);
