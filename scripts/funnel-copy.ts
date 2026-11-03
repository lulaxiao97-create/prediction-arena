/**
 * Daily funnel copy — the one tweet the X daemon posts each day.
 *
 * The formula is fixed by the boss and must not drift:
 *
 *   1. follow @Predict065
 *   2. drop your Base address in the comments
 *   3. join the Telegram channel            →  genesis airdrop
 *
 * Only the market it hangs off changes: the hottest pool on the board (scripts/hot-board.ts writes
 * .data/hot.json). Rewriting this file every cycle is what stops the daemon from posting the same
 * frozen text forever, which is what happened when the copy was hand-written once on 2026-11-02.
 *
 *   bun scripts/funnel-copy.ts            # writes .data/daily-funnel.txt (+ -cn.txt), prints lengths
 *   bun scripts/funnel-copy.ts --print    # print only, touch nothing
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const HOT = join(ROOT, ".data", "hot.json");
const OUT_EN = join(ROOT, ".data", "daily-funnel.txt");
const OUT_CN = join(ROOT, ".data", "daily-funnel-cn.txt");
const SITE = "https://predictionarena.online";
const X_HANDLE = "@Predict065";
const TG = "t.me/predictaing_bot";
const TG_CHANNEL = "t.me/predictionarena_hq";
const LIMIT = 280;
const printOnly = process.argv.includes("--print");

type Hot = {
  hot?: { id: string | number; title: string; lane?: string; yes?: number; oddsYes?: string; oddsNo?: string; endsIn?: string; url?: string }[];
};

function loadTop(): { title: string; yes: number | null; oddsYes: string; oddsNo: string; endsIn: string; id: string; url: string } | null {
  try {
    const j = JSON.parse(readFileSync(HOT, "utf8")) as Hot;
    const p = j.hot?.[0];
    if (!p) return null;
    return {
      title: String(p.title),
      yes: typeof p.yes === "number" ? Math.round(p.yes) : null,
      oddsYes: p.oddsYes ?? "",
      oddsNo: p.oddsNo ?? "",
      endsIn: p.endsIn ?? "",
      id: String(p.id),
      url: `https://${p.url ?? `${SITE.replace(/^https?:\/\//, "")}/market/${p.id}?ref=x`}`,
    };
  } catch {
    return null;
  }
}

/** X counts a URL as 23 chars and any non-Latin char as 2, so budget against that, not `.length`. */
function weighted(s: string): number {
  let n = 0;
  for (const ch of s.replace(/https?:\/\/\S+/g, "\u0001")) {
    n += ch === "\u0001" ? 23 : (ch.codePointAt(0) ?? 0) > 0x2000 ? 2 : 1;
  }
  return n;
}

/** Trim a market title at a word boundary so the whole post fits the 280 budget. */
function fitTitle(title: string, budget: number): string {
  if (weighted(title) <= budget) return title;
  const words = title.replace(/\?$/, "").split(" ");
  let out = "";
  for (const w of words) {
    if (weighted(`${out} ${w}`) > budget) break;
    out = out ? `${out} ${w}` : w;
  }
  // A title cut after "before" / "above" reads like a broken sentence — drop the dangling
  // preposition so the ellipsis lands where a human would have stopped.
  const dangling = /(before|above|below|after|at|to|on|by|than|close|trade)$/i;
  const kept = out.split(" ");
  while (kept.length > 1 && dangling.test(kept[kept.length - 1])) kept.pop();
  return `${kept.join(" ")}…`;
}

function build(top: ReturnType<typeof loadTop>): string {
  const steps = [
    ``,
    `🪂 Genesis airdrop = 3 steps:`,
    `1. Follow ${X_HANDLE}`,
    `2. Drop your Base address in the comments`,
    `3. ${TG} → +500 pts (channel: ${TG_CHANNEL})`,
    ``,
  ];
  const point = `Every $1 staked = 1 genesis point.`;
  const link = top ? top.url : `${SITE}?ref=x`;

  if (!top) return `🏴 The board is live.\n${[...steps, point, link].join("\n")}`;

  const odds =
    top.yes === null
      ? ""
      : `YES ${top.yes}% → ${top.oddsYes}× · NO ${100 - top.yes}% → ${top.oddsNo}×${top.endsIn ? ` · ends in ${top.endsIn}` : ""}\n`;

  // The link is not negotiable — a funnel post with no landing page is just a billboard. So the
  // title is what absorbs the overflow: trim it first, then drop the points line as a last resort.
  for (const withPoint of [true, false]) {
    for (let budget = 100; budget >= 30; budget -= 10) {
      const title = fitTitle(top.title, budget);
      const lines = [...steps, ...(withPoint ? [point] : []), link];
      const text = `🏴 ${title}\n${odds}${lines.join("\n")}`;
      if (weighted(text) <= LIMIT) return text;
    }
  }
  // Pathological case (a very long title): keep the link, cut the steps to one line.
  return `🏴 ${top.title.slice(0, 60)}…\n🪂 Follow ${X_HANDLE} · Base address in the comments · ${TG}\n${link}`;
}

const top = loadTop();
const en = build(top);
const cnOdds = top && top.yes !== null ? `YES ${top.yes}% · NO ${100 - top.yes}%\n` : "";
const cn = top
  ? `🏴 ${top.title}\n${cnOdds}\n🪂 创世空投 3 步：\n1. 关注 @Predict065\n2. 评论区留下你的 Base 地址\n3. 进 ${TG}\n\n每下注 $1 = 1 创世积分\n${top.url}`
  : `🪂 创世空投 3 步：关注 @Predict065 · 评论区留 Base 地址 · ${TG} 领 500 分（频道 ${TG_CHANNEL}）\n${SITE}?ref=x`;

console.log(`market: ${top ? `${top.id} · ${top.title}` : "(no hot board — generic copy)"}`);
console.log(`EN weighted ${weighted(en)}/${LIMIT}`);
console.log(en);
console.log("---");
console.log(`CN weighted ${weighted(cn)}/${LIMIT}`);

if (!printOnly) {
  if (weighted(en) > LIMIT) throw new Error(`funnel copy is ${weighted(en)} chars, over the ${LIMIT} limit`);
  writeFileSync(OUT_EN, en + "\n");
  writeFileSync(OUT_CN, cn + "\n");
  console.log(`written: ${OUT_EN}\n         ${OUT_CN}`);
}
