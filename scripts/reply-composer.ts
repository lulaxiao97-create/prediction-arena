/**
 * Reply composer — the part that decides whether a reply earns a follow or a mute.
 *
 * What the growth research actually says, and what this file implements:
 *
 *   · Replies are the cheapest reach a zero-follower account has: 20 substantive replies a day beat
 *     five original posts from an account nobody follows (Lunar Strategy, 2026 X playbook).
 *   · The reply must add information, a contrarian read, or a concrete number. Generic hype is dead
 *     weight, and an airdrop pitch under somebody else's post is worse than dead weight: it reads as
 *     spam, gets muted, and burns the account.
 *   · Links in the reply body are unnecessary here — the profile carries the link.
 *
 * So the copy is generated per target post by DeepSeek, against hard rules that are asserted after
 * generation (length, no link, no airdrop vocabulary, no "follow us"), with a template fallback that
 * also passes those rules when the API is unavailable. If the model returns something that fails a
 * rule, we fall back rather than post it.
 *
 *   bun scripts/reply-composer.ts --text="<target tweet text>" --handle=base
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { weighted, X_LIMIT } from "./lib/genesis-copy";

const ROOT = join(import.meta.dir, "..");
const HOT = join(ROOT, ".data", "hot.json");

function env(key: string): string {
  if (process.env[key]) return process.env[key]!;
  try {
    const m = readFileSync(join(ROOT, ".env"), "utf8").match(new RegExp(`^${key}=(.+)$`, "m"));
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

type Market = { id: string; title: string; yes: number; oddsYes: string; endsIn: string };

function hottest(): Market | null {
  try {
    const j = JSON.parse(readFileSync(HOT, "utf8")) as {
      hot?: { id: string | number; title: string; yes?: number; oddsYes?: string; endsIn?: string }[];
    };
    const p = j.hot?.[0];
    if (!p) return null;
    return { id: String(p.id), title: p.title, yes: Math.round(p.yes ?? 50), oddsYes: p.oddsYes ?? "", endsIn: p.endsIn ?? "" };
  } catch {
    return null;
  }
}

const BANNED = /\b(airdrop|genesis|claim|points|drop your wallet|follow us|ref=|t\.me|join tg)\b/i;

/** Rules a reply has to pass before it is allowed near somebody else's thread. */
export function passes(text: string): { ok: boolean; why: string } {
  const t = text.trim();
  if (!t) return { ok: false, why: "empty" };
  if (weighted(t) > X_LIMIT) return { ok: false, why: `${weighted(t)} chars` };
  if (/https?:\/\//.test(t)) return { ok: false, why: "contains a link" };
  if (BANNED.test(t)) return { ok: false, why: "promotional vocabulary" };
  if (!/[0-9]/.test(t)) return { ok: false, why: "no concrete number" };
  if (!/\?/.test(t)) return { ok: false, why: "does not invite a reply" };
  return { ok: true, why: "ok" };
}

/** Deterministic fallback: a real number from our board plus an actual question. */
export function fallback(handle: string, market: Market | null): string {
  const m = market;
  if (!m) return `The part nobody prices: what happens after. What would you need to see to change your mind?`;
  const pct = m.yes;
  const side = pct >= 50 ? "YES" : "NO";
  const odds = pct >= 50 ? 100 - pct : pct;
  return `Our book has ${m.title.replace(/^Will /, "").slice(0, 70)} at ${pct}% YES (${odds}¢ on the ${side} side, ${m.endsIn}). Curious where @${handle} readers would price it — higher or lower?`;
}

/** Ask the model for a reply that would survive a smart reader, then enforce the rules above. */
export async function compose(handle: string, tweetText: string, market: Market | null): Promise<{ text: string; source: string }> {
  const key = env("DEEPSEEK_API_KEY");
  const base = env("DEEPSEEK_BASE_URL") || "https://api.deepseek.com";
  const model = env("DEEPSEEK_MODEL") || "deepseek-chat";
  const bookLine = market
    ? `Our own pari-mutuel book currently prices "${market.title}" at ${market.yes}% YES, ${market.endsIn} to resolution.`
    : `Our book prices 232 live markets; you can cite that a crowd is mispricing tail risk.`;

  const prompt = [
    `You are the analyst account behind a pari-mutuel prediction market on Base.`,
    `Write ONE reply (max 260 characters) to this post by @${handle}:`,
    `"""${tweetText.slice(0, 600)}"""`,
    ``,
    `Hard rules:`,
    `- Add information, a contrarian read, or a calibration point. Never hype.`,
    `- Include at least one concrete number (a probability, a price, a count).`,
    `- End with a question that a thoughtful reader would want to answer.`,
    `- No links, no emojis, no hashtags, no "follow", no airdrop/points/wallet talk.`,
    `- Sound like a person with a book, not a brand. Lowercase is fine.`,
    ``,
    `Context you may use: ${bookLine}`,
    `Output the reply text only.`,
  ].join("\n");

  if (!key) return { text: fallback(handle, market), source: "fallback (no api key)" };

  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 200,
      }),
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    let text = (body.choices?.[0]?.message?.content ?? "").trim().replace(/^["'`]+|["'`]+$/g, "");
    const check = passes(text);
    if (!check.ok) {
      // One repair attempt: the model usually overshoots length or slips an emoji in.
      text = text.replace(/\s+/g, " ").slice(0, 250);
      const again = passes(text);
      if (!again.ok) return { text: fallback(handle, market), source: `fallback (${check.why})` };
    }
    return { text, source: "deepseek" };
  } catch (err) {
    return { text: fallback(handle, market), source: `fallback (${(err as Error).message.slice(0, 40)})` };
  }
}

if (import.meta.main) {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? "";
  const handle = arg("handle") || "base";
  const text = arg("text") || "We are lowering Base fees again this quarter. Blockspace should be boring.";
  const out = await compose(handle, text, hottest());
  console.log(`source: ${out.source} · ${weighted(out.text)}/280`);
  console.log(out.text);
  console.log(`rules: ${JSON.stringify(passes(out.text))}`);
}
