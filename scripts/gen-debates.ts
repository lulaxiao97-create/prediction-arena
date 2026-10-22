/**
 * Pre-generate AI debates into a static cache.
 *
 * The browser must never call a model. This script is the only thing that does, and it runs from
 * the ops tick (or by hand), writing `frontend/public/debates.json` — which the site reads as a
 * plain static asset and also inlines at build time for the first paint.
 *
 * Design notes:
 *  · incremental — a market is skipped when its cached band matches and the entry is younger than
 *    TTL_DAYS, so a tick costs nothing for markets that have not moved
 *  · bounded — MAX_PER_RUN caps how many model calls one run may spend, so the first backfill of a
 *    crowded board cannot produce a surprise bill
 *  · fail-soft — a failed market keeps whatever cache entry it already had and the run continues
 *
 *   node --experimental-strip-types scripts/gen-debates.ts
 *   MAX_PER_RUN=3 TTL_DAYS=7 node --experimental-strip-types scripts/gen-debates.ts
 *   FORCE=1 node --experimental-strip-types scripts/gen-debates.ts     # ignore the cache
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(ROOT, ".env"), override: true });

const POOLS = join(ROOT, "frontend", "public", "pools.json");
const CACHE = join(ROOT, "frontend", "public", "debates.json");

const apiKey = (process.env.DEEPSEEK_API_KEY ?? "").trim();
const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN ?? 6);
// English only by default. Add locales (e.g. "en,zh-TW") to pay for more languages; the site
// falls back to the localised kernel for any language the cache does not cover.
const LANGS = (process.env.DEBATE_LANGS ?? "en").split(",").map((x) => x.trim()).filter(Boolean);
const LANG_LABEL: Record<string, string> = {
  en: "English", "zh-TW": "Traditional Chinese", de: "German", fr: "French", ja: "Japanese", ko: "Korean",
};
const TTL_DAYS = Number(process.env.TTL_DAYS ?? 7);
const FORCE = process.env.FORCE === "1";
const TTL_MS = TTL_DAYS * 86_400_000;

type Line = { agent: "detective" | "hawk" | "meme"; stance: "bull" | "bear"; text: string };
type Entry = { band: number; lang?: string; at: string; source: "llm" | "kernel"; model?: string; lines: Line[] };
type Cache = { version: number; generatedAt: string; model: string; debates: Record<string, Entry> };
type Pool = { id: string; title?: string; category?: string; probability?: number; source?: string };

const AGENTS = ["detective", "hawk", "meme"] as const;

function bandOf(pct: number) {
  return Math.round(pct / 10) * 10;
}

function kernelFallback(title: string, category: string, yesPct: number): Line[] {
  // Used only when the model is unavailable, so the cache still has both sides for every market.
  const bull = `Positioning on "${title}" is not what the price says it is: the marginal buyer here is patient capital, and the odds already discount the obvious bear case.`;
  const bear = `The case for "${title}" rests on a mechanism nobody has stress-tested at this size — ${yesPct.toFixed(0)}% implies a certainty the underlying data does not support.`;
  return [
    { agent: "detective", stance: "bull", text: bull },
    { agent: "hawk", stance: "bear", text: bear },
    { agent: "detective", stance: "bull", text: `In ${category} specifically, the leading indicator for this question has already turned; the market is pricing a lagging version of it.` },
    { agent: "hawk", stance: "bear", text: `Every comparable ${category} resolution in the last eighteen months resolved against the crowded side, and this book is crowded.` },
    { agent: "detective", stance: yesPct >= 50 ? "bull" : "bear", text: `Settlement favours the ${yesPct >= 50 ? "bull" : "bear"} case at these odds, or there is no trade here.` },
  ];
}

function sanitise(raw: unknown, fallback: Line[]): Line[] {
  if (!Array.isArray(raw)) return fallback;
  const out: Line[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    const stance = rec.stance === "bear" ? "bear" : rec.stance === "bull" ? "bull" : null;
    if (!stance || text.length < 40 || text.length > 700) continue;
    const agent = AGENTS.includes(rec.agent as (typeof AGENTS)[number])
      ? (rec.agent as Line["agent"])
      : stance === "bull"
        ? "detective"
        : "hawk";
    out.push({ agent, stance, text });
  }
  const bulls = out.filter((l) => l.stance === "bull").length;
  const bears = out.filter((l) => l.stance === "bear").length;
  if (bulls < 2 || bears < 2 || out.length < 4) return fallback;
  return out.slice(0, 10);
}

async function generate(pool: Pool, yesPct: number, lang = "en"): Promise<{ lines: Line[]; source: "llm" | "kernel" }> {
  if (!apiKey) return { lines: kernelFallback(pool.title ?? "", pool.category ?? "", yesPct), source: "kernel" };

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `You are the AI debate desk of a binary prediction market. Today is ${today}.

Market: "${pool.title}"
Category: ${pool.category ?? "unknown"}
Implied probability of YES: ${Math.round(yesPct)}%

Write 3 rounds of genuine disagreement between a bull and a bear, then one closing line from the
side the odds favour. Write every line in ${LANG_LABEL[lang] ?? "English"} — the whole response must be
in that language, including any quoted terms. Each line must be specific to THIS market: name the mechanism, data source,
level, counterparty or timing that would decide it. No filler, no hedging, no emoji, never repeat
an argument already made.

Reply JSON only: {"lines":[{"agent":"detective|hawk|meme","stance":"bull|bear","text":"..."}]}
Rules: 6 to 8 lines, alternate bull and bear, each 60-320 chars, last line stance must be
"${yesPct >= 50 ? "bull" : "bear"}". Cite plausible, internally consistent numbers.`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.85,
      max_tokens: 1400,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? "";
  if (process.env.DEBUG === "1") console.log("  RAW:", raw.slice(0, 600));
  const parsed = JSON.parse(raw) as { lines?: unknown };
  const fallback = kernelFallback(pool.title ?? "", pool.category ?? "", yesPct);
  const lines = sanitise(parsed.lines, fallback);
  if (process.env.DEBUG === "1") {
    const arr = Array.isArray(parsed.lines) ? parsed.lines : [];
    console.log(`  parsed lines=${arr.length} kept=${lines.length} rejected=${lines === fallback}`);
  }
  return { lines, source: lines === fallback ? "kernel" : "llm" };
}

async function main() {
  if (!existsSync(POOLS)) throw new Error(`missing ${POOLS}`);
  const pools = (JSON.parse(readFileSync(POOLS, "utf8")) as { pools?: Pool[] }).pools ?? [];

  let cache: Cache = { version: 1, generatedAt: new Date().toISOString(), model, debates: {} };
  if (existsSync(CACHE)) {
    try {
      cache = JSON.parse(readFileSync(CACHE, "utf8")) as Cache;
      cache.debates ??= {};
    } catch {
      console.warn("debates.json unreadable — starting a fresh cache");
    }
  }

  const now = Date.now();
  let spent = 0;
  let reused = 0;
  const failed: string[] = [];

  for (const pool of pools) {
    if (spent >= MAX_PER_RUN) break;
    const yesPct = Number(pool.probability ?? 50);
    const band = bandOf(yesPct);

    for (const lang of LANGS) {
      if (spent >= MAX_PER_RUN) break;
      const key = `${pool.id}:${lang}`;
      const existing = cache.debates[key];

      if (!FORCE && existing && existing.band === band && now - Date.parse(existing.at) < TTL_MS) {
        reused += 1;
        continue;
      }

      try {
        const { lines, source } = await generate(pool, yesPct, lang);
        cache.debates[key] = {
          band,
          lang,
          at: new Date().toISOString(),
          source,
          model: source === "llm" ? model : undefined,
          lines,
        };
        spent += 1;
        console.log(`  ${source.padEnd(6)} ${lang.padEnd(6)} ${pool.id}  ${(pool.title ?? "").slice(0, 54)}`);
        // keep the provider happy and the bill predictable
        if (source === "llm") await new Promise((r) => setTimeout(r, 400));
      } catch (err) {
        failed.push(`${pool.id}:${lang}`);
        console.warn(`  FAIL   ${pool.id}:${lang}  ${(err as Error).message.slice(0, 70)}`);
      }
    }
    if (spent >= MAX_PER_RUN) break;
  }

  cache.version = 1;
  cache.generatedAt = new Date().toISOString();
  cache.model = model;
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache, null, 2) + "\n");

  const total = Object.keys(cache.debates).length;
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`cached      : ${total} markets (${reused} reused, ${spent} generated this run)`);
  console.log(`model       : ${apiKey ? model : "none — kernel fallback only"}`);
  console.log(`failures    : ${failed.length ? failed.join(", ") : "none"}`);
  console.log(`written     : ${CACHE}`);
  console.log("──────────────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
