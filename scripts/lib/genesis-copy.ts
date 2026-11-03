/**
 * One place for the genesis copy, because the same claim was being written three times and drifting.
 *
 * The hook is as aggressive as the brief asks for — 42% of supply, no presale, no team allocation,
 * $0 TVL stated out loud — but every number in it is checkable:
 *
 *   · 42% / 1B supply / zero team reserve   → docs/TOKENOMICS.md, frontend/public/WHITEPAPER.md
 *   · "N markets live"                      → count of status=1 pools with endTime in the future
 *   · "$0 TVL"                              → usdc.balanceOf(arena), which is literally 0 today
 *   · "+500 points on bind"                 → the grant telegram-bot.ts writes to docs/points/grants.json
 *
 * What is deliberately NOT claimed, even though the brief included it:
 *   · "$ARENA airdrop is LIVE" — no token contract exists yet. What is live is the points ledger.
 *   · "USDC seed grants" — no such programme exists anywhere in the product or the docs. Inventing a
 *     grant to win a click is the kind of claim that gets screenshotted and kills the account.
 *   · "@PredictionArena" — not our handle (@Predict065); pointing followers at somebody else is worse
 *     than no funnel at all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
export const SITE = "https://predictionarena.online";
export const X_HANDLE = "@Predict065";
export const TG_BOT = "t.me/predictaing_bot";
export const TG_CHANNEL = "t.me/predictionarena_hq";
export const X_LIMIT = 280;

export type Market = { id: string; title: string; yes: number; oddsYes: string; oddsNo: string; endsIn: string };

export function weighted(s: string): number {
  let n = 0;
  for (const ch of s.replace(/https?:\/\/\S+/g, "\u0001")) {
    n += ch === "\u0001" ? 23 : (ch.codePointAt(0) ?? 0) > 0x2000 ? 2 : 1;
  }
  return n;
}

/** "Ethena above $0.1782" — the form a reply needs, not the whole question with a date in it. */
export function shortMarket(title: string): string {
  const t = title.replace(/\?$/, "");
  const m = t.match(/^Will (.+?) (?:trade|close) (above|below) (\$[\d.,]+)/i);
  if (m) return `${m[1]} ${m[2]} ${m[3]}`;
  return t.replace(/^Will /, "");
}

export function clipTitle(title: string, budget: number): string {
  if (weighted(title) <= budget) return title;
  const words = title.split(" ");
  let out = "";
  for (const w of words) {
    if (weighted(`${out} ${w}`) > budget) break;
    out = out ? `${out} ${w}` : w;
  }
  const kept = out.split(" ");
  while (kept.length > 1 && /(before|above|below|after|at|to|on|by|than|close|trade)$/i.test(kept[kept.length - 1])) kept.pop();
  return `${kept.join(" ")}…`;
}

/** Live market count, straight from the manifest: status open and endTime still in the future. */
export function liveMarketCount(): number {
  try {
    const board = JSON.parse(readFileSync(join(ROOT, "frontend", "public", "pools.json"), "utf8")) as {
      pools?: { status?: number; endTimeUtc?: string }[];
    };
    const now = Date.now();
    return (board.pools ?? []).filter((p) => {
      if ((p.status ?? 1) !== 1) return false;
      const end = p.endTimeUtc ? Date.parse(p.endTimeUtc) : NaN;
      return Number.isFinite(end) ? end > now : true;
    }).length;
  } catch {
    return 0;
  }
}

/** The three-step funnel. Identical wording everywhere so A/B numbers mean something. */
export function steps(line: string[] = []): string[] {
  return [
    `1️⃣ Follow ${X_HANDLE}`,
    `2️⃣ Base wallet 👇 in reply`,
    `3️⃣ ${TG_BOT} +500 pts`,
    ...line,
  ];
}

const PITCH = "42% of $ARENA supply goes to points holders (1:1 at launch). No presale. No team allocation.";

/**
 * The daily tweet. Greedy by priority, not "all or nothing": the funnel steps and the link are
 * mandatory, then the "$0 TVL / N markets" honesty line, then the 42% pitch, then the odds — each is
 * added only if the whole post still fits 280. The old version tried three fixed templates and fell
 * straight through to a bare four-line stub, which is how the strongest claim ended up on the floor.
 */
export function buildFunnel(m: Market | null): string {
  const live = liveMarketCount();
  const social = `📊 ${live} markets · $0 TVL · zero team allocation.`;
  const pitch = `🚀 Genesis S1 is live: 42% of $ARENA supply → points holders, 1:1 at launch.`;
  const link = m ? `${SITE}/market/${m.id}?ref=x` : `${SITE}/?ref=x`;
  const tail = [``, `🪂 3 steps:`, ...steps(), ``, link];

  if (!m) return [`🚀 Genesis Points Season 1 is live on Base.`, pitch, social, ...tail].join("\n");

  const head = `🏴 ${clipTitle(shortMarket(m.title), 84)}`;
  const odds = `YES ${m.yes}% → ${m.oddsYes}× · NO ${100 - m.yes}% → ${m.oddsNo}×${m.endsIn ? ` · ${m.endsIn}` : ""}`;

  const core = [head, ``, ...tail];
  const optional: string[][] = [[pitch], [social], [odds]];
  let lines = core;
  for (const add of optional) {
    const at = lines.length - tail.length;
    const candidate = [...lines.slice(0, at), ...add, ...lines.slice(at)];
    if (weighted(candidate.join("\n")) <= X_LIMIT) lines = candidate;
  }
  // Still over (very long title): shrink the head, keep everything else.
  for (let budget = 72; budget >= 24 && weighted(lines.join("\n")) > X_LIMIT; budget -= 8) {
    lines = [`🏴 ${clipTitle(shortMarket(m.title), budget)}`, ...lines.slice(1)];
  }
  return lines.join("\n");
}

/** Reply copy. Two variants so a sweep does not paste the same paragraph under two accounts. */
export function buildReply(m: Market | null, variant: "a" | "b"): string {
  const live = liveMarketCount();
  const head = m ? `🏴 ${clipTitle(shortMarket(m.title), 70)}${m.yes ? ` · YES ${m.yes}%` : ""}` : `🏴 Prediction Arena · Base`;
  const bodies = [
    [
      head,
      ``,
      `🚀 Genesis Points S1 is live: ${PITCH}`,
      `📊 ${live} markets · $0 TVL · 0% team reserve.`,
      ``,
      `🪂 +500 pts in 3 steps:`,
      ...steps(),
      ``,
      `${SITE}/?ref=x`,
    ].join("\n"),
    [
      head,
      ``,
      `Every $1 staked = 1 point, 1:1 at $ARENA launch. 42% of supply, no presale, no team allocation.`,
      `${live} markets live. TVL $0. First movers eat the spread.`,
      ``,
      `1️⃣ Follow ${X_HANDLE}`,
      `2️⃣ Base wallet in the reply 👇 (+500 pts)`,
      `3️⃣ ${TG_BOT} for the channel`,
      ``,
      `${SITE}/?ref=x`,
    ].join("\n"),
  ];
  const text = bodies[variant === "a" ? 0 : 1];
  if (weighted(text) <= X_LIMIT) return text;
  return [
    head,
    `🚀 Genesis Points S1 · ${PITCH}`,
    `1️⃣ Follow ${X_HANDLE}`,
    `2️⃣ Base wallet 👇 → +500 pts`,
    `3️⃣ ${TG_BOT}`,
    `${SITE}/?ref=x`,
  ].join("\n");
}
