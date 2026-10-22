import { NextResponse, type NextRequest } from "next/server";
import { generateDebate, resolveCategory, type DebateLine } from "@/lib/auto-gen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side debate generation.
 *
 * The DeepSeek key must never reach the browser, so the client renders the deterministic kernel
 * instantly and then asks this route for a better version. Any failure (no key, timeout, bad JSON,
 * quota) returns the kernel output with `source: "kernel"` — the caller never sees an error page.
 */
type Body = {
  poolId?: string;
  category?: string;
  title?: string;
  yesPct?: number;
  netPoolUsdc?: number;
};

const AGENTS = ["detective", "hawk", "meme"] as const;

function sanitise(raw: unknown, fallback: DebateLine[]): DebateLine[] {
  if (!Array.isArray(raw)) return fallback;
  const out: DebateLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    const stance = rec.stance === "bear" ? "bear" : rec.stance === "bull" ? "bull" : null;
    if (!stance || text.length < 40 || text.length > 700) continue;
    const agent = AGENTS.includes(rec.agent as (typeof AGENTS)[number])
      ? (rec.agent as DebateLine["agent"])
      : stance === "bull"
        ? "detective"
        : "hawk";
    out.push({ agent, stance, text });
  }
  // a real exchange needs both sides and at least two rounds
  const bulls = out.filter((l) => l.stance === "bull").length;
  const bears = out.filter((l) => l.stance === "bear").length;
  if (bulls < 2 || bears < 2 || out.length < 4) return fallback;
  return out.slice(0, 10);
}

async function llmDebate(key: string, input: Required<Pick<Body, "poolId" | "category" | "title">> & Body) {
  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const today = new Date().toISOString().slice(0, 10);
  const yesPct = Math.round(Number(input.yesPct ?? 50));

  const prompt = `You are running the AI debate desk of a binary prediction market. Today is ${today}.

Market: "${input.title}"
Category: ${input.category}
Implied probability of YES: ${yesPct}%
Liquidity: ${Math.round(Number(input.netPoolUsdc ?? 0))} USDC

Write 3 rounds of genuine disagreement between a bull and a bear, then one closing line from the
side the odds favour. Each line must be specific to THIS market: cite the mechanism, the data source,
the level, the counterparty or the timing that would decide it. No generic "could go up or down"
filler, no emoji, no hedging, no repeating an argument already made.

Reply JSON only:
{"lines":[{"agent":"detective|hawk|meme","stance":"bull|bear","text":"..."}]}

Rules: 6 to 8 lines; alternate bull and bear; each text 60-320 characters; the last line's stance must
be "${yesPct >= 50 ? "bull" : "bear"}"; numbers you cite must be plausible and internally consistent.`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.85,
      max_tokens: 1400,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`deepseek HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(content) as { lines?: unknown };
  return parsed.lines;
}

export async function POST(req: NextRequest) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const input = {
    poolId: String(body.poolId ?? "unknown"),
    category: body.category ?? "Crypto",
    title: body.title ?? "",
    yesPct: Number(body.yesPct ?? 50),
    netPoolUsdc: Number(body.netPoolUsdc ?? 0),
  };

  const kernel = generateDebate(input);
  const key = (process.env.DEEPSEEK_API_KEY ?? "").trim();
  if (!key) {
    return NextResponse.json({ lines: kernel, source: "kernel", reason: "no-key" });
  }

  try {
    const raw = await llmDebate(key, input);
    const lines = sanitise(raw, kernel);
    const source = lines === kernel ? "kernel" : "llm";
    return NextResponse.json(
      { lines, source, meta: { category: resolveCategory(input.category, input.title), yesPct: input.yesPct } },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json({
      lines: kernel,
      source: "kernel",
      reason: String((err as Error).message ?? err).slice(0, 120),
    });
  }
}
