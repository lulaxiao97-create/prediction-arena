/**
 * Automated market generator.
 *
 * Runs headless (no Hardhat, no network) and writes `logs/generated-market.json`, which
 * `scripts/auto-create-pool.ts` then deploys on-chain. Keeping generation and deployment separate
 * means the daemon can decide *what* to open without touching a key, and the deployment step can
 * be retried without regenerating a different market.
 *
 *   node --experimental-strip-types scripts/gen-market.ts
 *   ROTATION=3 node --experimental-strip-types scripts/gen-market.ts
 *
 * An LLM is optional: set DEEPSEEK_API_KEY (or OPENAI_API_KEY) and the kernel output is rewritten
 * by the model; on any failure the kernel output is kept. `source` in the JSON records which path
 * was used so the log never lies about where the copy came from.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import * as dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateMarket, currentSlot } from "../frontend/src/lib/auto-gen.ts";
import type { LiveNumbers } from "../frontend/src/lib/auto-gen.ts";
import { readSnapshot, snapshotAgeMs } from "./fetch-prices.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// .env is the source of truth (same convention as every other script here). Without this the
// generator silently ran in kernel mode even when a key was configured.
dotenv.config({ path: join(ROOT, ".env"), override: true });
const OUT = join(ROOT, "logs", "generated-market.json");
const POOLS = join(ROOT, "frontend", "public", "pools.json");

function liveTitles(): string[] {
  try {
    if (!existsSync(POOLS)) return [];
    const d = JSON.parse(readFileSync(POOLS, "utf8")) as { pools?: { title?: string }[] };
    return (d.pools ?? []).map((p) => p.title ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

const apiKey = (process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "").trim();
// DeepSeek first (DEEPSEEK_* names), generic LLM_* accepted as an override for other providers.
const baseUrl = (process.env.LLM_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
const model = process.env.LLM_MODEL ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

async function llmRewrite(kernel: ReturnType<typeof generateMarket>): Promise<ReturnType<typeof generateMarket> | null> {
  if (!apiKey) return null;
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `You are the market desk for a binary prediction protocol. Today is ${today}.

Start from this draft and produce a listing that a professional exchange would publish today. Better still: if the draft is stale relative to ${today}, replace the subject with something genuinely current in the same category. Keep it a single yes/no question.

Live market data (use these numbers, never invent a price): ${live ? `BTC $${live.btc?.toFixed(0)}, ETH $${live.eth?.toFixed(2)}, SOL $${live.sol?.toFixed(2)}, total cap $${((live.totalMarketCapUsd ?? 0) / 1e12).toFixed(2)}T, BTC dominance ${live.btcDominance?.toFixed(1)}%, Base TVL $${((live.baseTvlUsd ?? 0) / 1e9).toFixed(2)}B, as of ${live.asOf}` : "unavailable"}

Current draft:
title: ${kernel.title}
category: ${kernel.category}
description: ${kernel.description}
resolution: ${kernel.resolution}

Reply with JSON only: {"title":"...","description":"...","resolution":"..."}
Rules: title under 90 chars and must be a yes/no question; resolution must be mechanically checkable, naming a specific data source AND a hard deadline; description at most 2 sentences, no hype, no emoji.`;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 500,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { title?: string; description?: string; resolution?: string };
    if (!parsed.title || !parsed.resolution) throw new Error("model returned an incomplete market");
    return {
      ...kernel,
      title: parsed.title.slice(0, 120),
      description: (parsed.description ?? kernel.description).slice(0, 800),
      resolution: parsed.resolution.slice(0, 800),
      source: "llm",
    };
  } catch (err) {
    console.warn(`[gen-market] LLM rewrite failed (${(err as Error).message}) — keeping kernel output`);
    return null;
  }
}

/**
 * Live numbers for the listing. The generator is not allowed to embed a price it did not read:
 * a snapshot older than three hours is treated as no snapshot, and the crypto lane then only
 * offers blueprints without a strike in the title.
 */
const snap = readSnapshot();
const ageMs = snapshotAgeMs(snap);
const fresh = Boolean(snap) && ageMs < 3 * 3600_000;
const live: LiveNumbers | null = fresh && snap
  ? {
      btc: snap.assets.BTC?.usd,
      eth: snap.assets.ETH?.usd,
      sol: snap.assets.SOL?.usd,
      btcDominance: snap.global?.btcDominance,
      totalMarketCapUsd: snap.global?.totalMarketCapUsd,
      baseTvlUsd: snap.chains?.base?.tvlUsd,
      asOf: snap.updatedAt,
    }
  : null;
if (!live) {
  console.warn(`[gen-market] no usable price snapshot (${snap ? `${Math.round(ageMs / 60_000)}min old` : "missing"}) — price blueprints are skipped`);
}

const slot = Number(process.env.SLOT ?? currentSlot());
// category rotates every hour so consecutive opens never repeat a vertical
const rotation = Number(process.env.ROTATION ?? slot % 6);
const avoid = liveTitles();

let market = generateMarket({ slot, rotation, avoid, live });
const enhanced = await llmRewrite(market);
if (enhanced) market = enhanced;

mkdirSync(join(ROOT, "logs"), { recursive: true });
writeFileSync(OUT, JSON.stringify({ ...market, slot, rotation, generatedAt: new Date().toISOString() }, null, 2) + "\n");

console.log("──────────────────────────────────────────────────────────────");
console.log(`generated   : ${market.title}`);
console.log(`category    : ${market.category}`);
console.log(`live data   : ${live ? `BTC $${live.btc?.toLocaleString("en-US")} · snapshot ${live.asOf}` : "none (no price in this listing)"}`);
console.log(`duration    : ${market.durationHours}h`);
console.log(`source      : ${market.source}${apiKey ? " (API key present)" : " (kernel — no LLM key configured)"}`);
console.log(`resolution  : ${market.resolution.slice(0, 110)}…`);
console.log(`written     : ${OUT}`);
console.log("──────────────────────────────────────────────────────────────");
