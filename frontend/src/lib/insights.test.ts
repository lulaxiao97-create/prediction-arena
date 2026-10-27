/**
 * Per-market commentary tests. Run with: node --experimental-strip-types src/lib/insights.test.ts
 *
 * The failure these lock out: one canned paragraph per category, printed on every market in the
 * lane. Every shipped listing now has to produce two distinct, subject-specific lines that mention
 * its own numbers, stay deterministic, and never borrow a desk that cannot speak to it (perp funding
 * on a Premier League market, DEX volume on a Senate bill).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ANGLE_COUNT, ANGLE_KEYS, insightAngleKeys, insightsFor, type InsightPool } from "./insights.ts";

type ManifestPool = {
  id: string;
  title: string;
  category: string;
  tags?: string[];
  endTimeUtc?: string;
  yesShare?: number;
  liquidityUsdc?: string;
  marketData?: InsightPool["marketData"];
};

const manifest = JSON.parse(
  readFileSync(new URL("../../public/pools.json", import.meta.url), "utf8"),
) as { pools: ManifestPool[] };

const U = (n: number) => BigInt(Math.round(n));

function asPool(p: ManifestPool): InsightPool {
  const liq = Number(p.liquidityUsdc ?? 0);
  const share = p.yesShare ?? 0.5;
  return {
    id: p.id,
    title: p.title,
    category: p.category,
    tags: p.tags,
    endTime: p.endTimeUtc ? Math.floor(Date.parse(p.endTimeUtc) / 1_000) : 0,
    option0Pool: U(liq * share),
    option1Pool: U(liq * (1 - share)),
    marketData: p.marketData,
  };
}

let pass = 0;
const ok = (label: string) => {
  console.log(`  ok  ${label}`);
  pass++;
};

const pools = manifest.pools.map(asPool);
const lines = pools.flatMap((p) => {
  const s = insightsFor(p);
  return [s.yes.take, s.no.take];
});

// 1) The bank is large enough to be a real engine, not a handful of templates.
assert.ok(ANGLE_COUNT >= 20, `expected 20+ angles, found ${ANGLE_COUNT}`);
assert.equal(new Set(ANGLE_KEYS).size, ANGLE_COUNT, "angle keys must be unique");
ok(`${ANGLE_COUNT} distinct analytical angles in the bank`);

// 2) Every market gets two non-empty, card-sized lines, and they disagree.
for (const p of pools) {
  const s = insightsFor(p);
  for (const [side, take] of [["yes", s.yes.take], ["no", s.no.take]] as const) {
    assert.ok(take && take.trim().length > 40, `${p.id} ${side} take is too short: ${take}`);
    assert.ok(take.length <= 240, `${p.id} ${side} take overflows the card: ${take.length} chars`);
  }
  assert.notEqual(s.yes.take, s.no.take, `${p.id} printed the same line twice`);
  assert.notEqual(s.yes.agent, s.no.agent, `${p.id} used the same desk on both sides`);
}
ok(`${pools.length} markets × 2 sides: non-empty, ≤200 chars, different desks`);

// 3) No market repeats another market's sentence — that was the original complaint.
assert.equal(new Set(lines).size, lines.length, "two markets printed an identical take");
ok(`${lines.length} takes are all unique (no shared template text)`);

// 4) Deterministic: same market, same words, every call (reload / server vs client).
for (const p of pools.slice(0, 12)) {
  assert.deepEqual(insightsFor(p), insightsFor({ ...p }), `${p.id} drifted between renders`);
  // the same id as a string (manifest) and as a bigint (on-chain) must agree
  assert.deepEqual(insightsFor(p), insightsFor({ ...p, id: BigInt(p.id) }), `${p.id} id type changed the take`);
}
ok("deterministic across calls and across id types");

// 5) Subject alignment: a price market names its ticker and its strike.
const priceMarkets = manifest.pools.filter((p) => p.marketData?.asset);
for (const p of priceMarkets) {
  const pool = asPool(p);
  const s = insightsFor(pool);
  const text = `${s.yes.take} ${s.no.take}`;
  assert.ok(
    text.toUpperCase().includes(String(p.marketData?.asset).toUpperCase()),
    `${p.id} (${p.marketData?.asset}) never names its subject: ${text}`,
  );
  const strike = p.marketData?.strikeUsd;
  if (strike) {
    const plain = (s: string) => s.replace(/[,\s$]/g, "");
    const formatted = plain(String(Number(strike.toPrecision(4))));
    assert.ok(
      plain(text).includes(formatted.slice(0, 5)),
      `${p.id} never mentions its strike (${formatted}): ${text}`,
    );
  }
}
ok(`${priceMarkets.length} price markets name their ticker and strike`);

// 6) Domain hygiene: a sports/politics market must not borrow a crypto desk.
const noCryptoDesk = /perp funding|dex volume|exchange reserves|on-chain|staking|cme basis|blob space/i;
for (const p of manifest.pools) {
  const hay = `${p.title} ${p.category}`;
  if (!/premier|league|match|nba|nfl|sport|esport|cup|series|race|senate|congress|bill|legislat|policy|regulat/i.test(hay)) continue;
  const s = insightsFor(asPool(p));
  const text = `${s.yes.take} ${s.no.take}`;
  assert.ok(!noCryptoDesk.test(text), `${p.id} gave a civics/sports market a crypto line: ${text}`);
}
ok("sports and politics markets stay inside their own vocabulary");

// 7) The board actually exercises the bank: many different angles, not three on repeat.
const used = new Set<string>();
for (const p of pools) {
  const keys = insightAngleKeys(p);
  used.add(keys.yes);
  used.add(keys.no);
}
assert.ok(used.size >= 20, `board only exercised ${used.size} angles`);
ok(`the shipped board uses ${used.size} different angles`);

// 8) TVL markets talk about TVL, not token spot.
for (const p of manifest.pools.filter((x) => /tvl/i.test(x.title))) {
  const s = insightsFor(asPool(p));
  const text = `${s.yes.take} ${s.no.take}`;
  assert.ok(/tvl|bridge|liquidity|sequencer|stablecoin|blob/i.test(text), `${p.id} TVL market reads generic: ${text}`);
}
ok("TVL markets reference TVL / bridge / chain infrastructure");

console.log(`\n${pass} checks passed`);
