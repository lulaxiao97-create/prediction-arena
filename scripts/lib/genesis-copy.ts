/**
 * One place for the X copy, because the same claim was being written six times and drifting.
 *
 * Every number here is checkable, and every one of them is about the venue rather than about a
 * future token:
 *
 *   · "N markets live"     → count of status=1 pools with endTime in the future
 *   · "4% fee" / "30% to the referrer" / "claimable" → PredictionArena.sol, basescan
 *   · "rule published before you bet" → each pool carries its resolution source in the manifest
 *
 * What is deliberately NOT claimed any more (removed 2026-11-10):
 *   · "$ARENA", "points", "airdrop", "42% of supply" — no token contract exists, the points ledger
 *     is gone, and the ad venue never onboarded us. Every one of those lines was a promise with no
 *     counterparty; they are replaced below with what the contract actually does.
 *   · "USDC seed grants" — no such programme exists anywhere in the product or the docs.
 *   · "@PredictionArena" — not our handle (@Predict065).
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
    `2️⃣ Read the resolution rule, then take a side`,
    `3️⃣ ${TG_BOT} for settlement notices`,
    ...line,
  ];
}

const PITCH = "USDC escrow, 4% fee on the losing side, winnings claimable on-chain. No KYC, no custody.";

/**
 * The daily tweet. Greedy by priority, not "all or nothing": the funnel steps and the link are
 * mandatory, then the "N markets / rule published" line, then the fee pitch, then the odds — each is
 * added only if the whole post still fits 280. The old version tried three fixed templates and fell
 * straight through to a bare four-line stub, which is how the strongest claim ended up on the floor.
 */
export function buildFunnel(m: Market | null): string {
  const live = liveMarketCount();
  const social = `📊 ${live} markets · every resolution rule published before you bet.`;
  const pitch = `🏦 ${PITCH}`;
  const link = m ? `${SITE}/market/${m.id}?ref=x` : `${SITE}/?ref=x`;
  const tail = [``, `How it works:`, ...steps(), ``, link];

  if (!m) return [`🏴 ${live} binary markets on Base, priced by the crowd.`, pitch, social, ...tail].join("\n");

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
      `🏦 ${PITCH}`,
      `📊 ${live} 个盘口 · 结算上链 · 每条结算规则下注前公开。`,
      ``,
      `How it works:`,
      ...steps(),
      ``,
      `${SITE}/?ref=x`,
    ].join("\n"),
    [
      head,
      ``,
      `Binary market, USDC escrow: the losing side's stake pays the winners, minus a 4% fee.`,
      `${live} markets live. Every resolution rule is published before you bet — read it first.`,
      ``,
      `1️⃣ Follow ${X_HANDLE}`,
      `2️⃣ Take a side on Base (no KYC, no custody)`,
      `3️⃣ ${TG_BOT} for settlement notices`,
      ``,
      `${SITE}/?ref=x`,
    ].join("\n"),
  ];
  const text = bodies[variant === "a" ? 0 : 1];
  if (weighted(text) <= X_LIMIT) return text;
  return [
    head,
    `🏦 USDC escrow · 4% fee on the losing side · winnings claimable on-chain.`,
    `1️⃣ Follow ${X_HANDLE}`,
    `2️⃣ Take a side on Base`,
    `3️⃣ ${TG_BOT}`,
    `${SITE}/?ref=x`,
  ].join("\n");
}

/**
 * The vampire lane's copy: blunt, DeGen, no brand voice. Same funnel, same facts, one opening line
 * that names the thing the reader is actually doing (chasing dead memes) instead of describing us.
 *
 * Every number is the same checkable set as the rest of the file, and none of them is a token: the
 * claim is what a bet does — escrow, a 4% fee on the losing side, a published resolution rule.
 */
export function buildVampire(marketId: string | null): string {
  const core =
    "Still chasing dead memes? Trade an actual yes/no on Base instead: USDC escrow, 4% fee on the losing side, the resolution rule is published before you bet. No KYC, no custody — " +
    `${SITE}/?ref=x`;
  const link = marketId ? `${SITE}/market/${marketId}?ref=x` : `${SITE}/?ref=x`;
  const withMarket = marketId ? `🏴 ${shortMarket(marketTitle(marketId) ?? "")}` : "";

  const candidates = [
    [withMarket, core, link],
    [core, link],
  ];
  for (const parts of candidates) {
    const text = parts.filter(Boolean).join("\n");
    // Two characters of headroom: X's own count and ours disagree at the margin (variation selectors),
    // and a post that fails the limit fails silently in the composer.
    if (weighted(text) <= X_LIMIT - 2) return text;
  }
  return `${core.slice(0, 200)}… ${link}`;
}

/** Title for a pool id, read from the hot board (the only place we keep a live shortlist). */
function marketTitle(id: string): string | null {
  try {
    const hot = JSON.parse(readFileSync(join(ROOT, ".data", "hot.json"), "utf8")) as {
      hot?: { id: string | number; title: string }[];
    };
    const p = (hot.hot ?? []).find((x) => String(x.id) === String(id));
    return p ? String(p.title) : null;
  } catch {
    return null;
  }
}
