/**
 * Debate engine tests. Run with: node --experimental-strip-types src/lib/debate.test.ts
 *
 * What this locks out: a per-category paragraph repeated on every market, English leaking into a
 * non-English page, and rounds that never mention the market's own numbers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateContextDebate, type DebateLang } from "./debate.ts";

type ManifestPool = {
  id: string;
  title: string;
  category: string;
  yesShare?: number;
  liquidityUsdc?: string;
  endTimeUtc?: string;
  marketData?: { asset?: string; spotUsd?: number; strikeUsd?: number; direction?: string; windowDays?: number };
};

const manifest = JSON.parse(readFileSync(new URL("../../public/pools.json", import.meta.url), "utf8")) as {
  pools: ManifestPool[];
};

const LANGS: DebateLang[] = ["en", "zh-TW", "de", "fr", "ja", "ko"];

const asInput = (p: ManifestPool) => ({
  poolId: p.id,
  category: p.category,
  title: p.title,
  yesPct: (p.yesShare ?? 0.5) * 100,
  netPoolUsdc: Number(p.liquidityUsdc ?? 0),
  marketData: p.marketData,
  endTime: p.endTimeUtc ? Math.floor(Date.parse(p.endTimeUtc) / 1_000) : undefined,
  depthUsdc: Number(p.liquidityUsdc ?? 0),
});

let pass = 0;
const ok = (label: string) => {
  console.log(`  ok  ${label}`);
  pass++;
};

// 1) Six rounds, three desks, both sides — in every language, for every market.
const counts: Record<string, number> = {};
for (const p of manifest.pools) {
  for (const lang of LANGS) {
    const lines = generateContextDebate(asInput(p), lang);
    assert.equal(lines.length, 6, `${p.id}/${lang}: expected 6 rounds`);
    const stances = new Set(lines.map((l) => l.stance));
    assert.deepEqual([...stances].sort(), ["bear", "bull"], `${p.id}/${lang}: debate lost a side`);
    const agents = new Set(lines.map((l) => l.agent));
    assert.ok(agents.size >= 2, `${p.id}/${lang}: only one desk spoke`);
    // CJK is denser per character: a Chinese/Japanese/Korean round says the same thing in ~half
    // the characters, so the floor has to be per script rather than one number for all six.
    const minLen = lang === "zh-TW" || lang === "ja" || lang === "ko" ? 22 : 45;
    for (const l of lines) {
      assert.ok(l.text.trim().length > minLen, `${p.id}/${lang}: round too short → ${l.text}`);
      assert.ok(l.text.length <= 520, `${p.id}/${lang}: round too long (${l.text.length})`);
      assert.ok(!/\{[a-z]+\}/i.test(l.text), `${p.id}/${lang}: unfilled placeholder → ${l.text}`);
      assert.ok(!/\s{2,}/.test(l.text), `${p.id}/${lang}: double space → ${l.text}`);
    }
    counts[lang] = (counts[lang] ?? 0) + 1;
  }
}
ok(`6 rounds × 6 languages for ${manifest.pools.length} markets (${Object.keys(counts).length} locales)`);

// 2) Non-Latin locales stay in their own script — no English sentence leaked in.
const LATIN_ONLY = /^[\x00-\x7F\s]*$/;
for (const lang of ["zh-TW", "ja", "ko"] as const) {
  for (const p of manifest.pools.slice(0, 12)) {
    const text = generateContextDebate(asInput(p), lang).map((l) => l.text).join(" ");
    assert.ok(!LATIN_ONLY.test(text), `${p.id}/${lang}: produced pure-ASCII text`);
    assert.ok(/[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(text), `${p.id}/${lang}: no native script found`);
    // prose subjects must be translated, not borrowed from the English deck
    assert.ok(!/market-structure bill|total market cap|this market\b/i.test(text), `${p.id}/${lang}: English subject leaked`);
  }
}
ok("zh-TW / ja / ko debates are native-script, no English prose subjects");

// 3) Every market's debate carries its own parameters: a number appears in every round,
//    the odds appear in the crossfire, and the verdict names the losing side's multiple.
for (const p of manifest.pools) {
  const lines = generateContextDebate(asInput(p), "en");
  const text = lines.map((l) => l.text).join(" ");
  const asset = p.marketData?.asset;
  if (asset) assert.ok(text.toUpperCase().includes(asset.toUpperCase()), `${p.id}: never names ${asset}`);
  const strike = p.marketData?.strikeUsd;
  if (strike) {
    const plain = String(Number(strike.toPrecision(4)));
    assert.ok(text.replace(/[,\s$]/g, "").includes(plain.slice(0, 5)), `${p.id}: never names its strike`);
  }
  for (const [i, line] of lines.entries()) {
    assert.ok(/\d/.test(line.text), `${p.id}: round ${i + 1} carries no number`);
  }
  assert.ok(/%\s*YES/.test(lines[4].text) && /x\b/.test(lines[4].text), `${p.id}: crossfire has no odds`);
  assert.ok(/x\b/.test(lines[5].text), `${p.id}: verdict has no multiple`);
}
ok(`${manifest.pools.length} markets: every round carries numbers, crossfire + verdict carry the odds`);

// 4) No two markets open with the same sentence (the original complaint).
const openers = manifest.pools.map((p) => generateContextDebate(asInput(p), "en")[0].text);
assert.equal(new Set(openers).size, openers.length, "two markets shared an opening round");
ok(`${openers.length} distinct opening rounds`);

// 5) Deterministic: same market + language ⇒ same six rounds (reload, SSR, id type).
for (const p of manifest.pools.slice(0, 10)) {
  assert.deepEqual(generateContextDebate(asInput(p), "de"), generateContextDebate(asInput(p), "de"));
}
ok("deterministic across calls");

// 6) A sports or politics market never borrows a crypto desk.
const CRYPTO_JARGON = /perp funding|open interest|exchange reserves|dex volume|staking|blob fee|cme basis|liquidity pool/i;
for (const p of manifest.pools) {
  if (!/premier|league|match|nba|nfl|sport|esport|cup|series|race|senate|congress|bill|legislat|policy|regulat/i.test(`${p.title} ${p.category}`)) continue;
  const text = generateContextDebate(asInput(p), "en").map((l) => l.text).join(" ");
  assert.ok(!CRYPTO_JARGON.test(text), `${p.id}: civics/sports debate used crypto jargon → ${text.slice(0, 120)}`);
}
ok("sports and politics debates stay in their own vocabulary");

console.log(`\n${pass} checks passed`);
