/**
 * Daily funnel copy — the one tweet the X daemon posts each day.
 *
 * The formula is fixed by the boss and must not drift:
 *
 *   1. follow @Predict065
 *   2. drop your Base address in the comments
 *   3. t.me/predictaing_bot            →  +500 points on bind, then the channel
 *
 * Only the market it hangs off changes: the hottest live pool on the board (.data/hot.json, written by
 * hot-board.ts, which now excludes pools whose endTime has passed). The claim text itself lives in
 * scripts/lib/genesis-copy.ts so the daily tweet and the replies cannot disagree.
 *
 *   bun scripts/funnel-copy.ts            # writes .data/daily-funnel.txt (+ -cn.txt), prints lengths
 *   bun scripts/funnel-copy.ts --print    # print only, touch nothing
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFunnel, liveMarketCount, SITE, TG_BOT, TG_CHANNEL, X_HANDLE, weighted, type Market } from "./lib/genesis-copy";

const ROOT = join(import.meta.dir, "..");
const HOT = join(ROOT, ".data", "hot.json");
const OUT_EN = join(ROOT, ".data", "daily-funnel.txt");
const OUT_CN = join(ROOT, ".data", "daily-funnel-cn.txt");
const LIMIT = 280;
const printOnly = process.argv.includes("--print");

type Hot = { hot?: { id: string | number; title: string; yes?: number; oddsYes?: string; oddsNo?: string; endsIn?: string }[] };

function top(): Market | null {
  try {
    const j = JSON.parse(readFileSync(HOT, "utf8")) as Hot;
    const p = j.hot?.[0];
    if (!p) return null;
    return {
      id: String(p.id),
      title: String(p.title),
      yes: typeof p.yes === "number" ? Math.round(p.yes) : 0,
      oddsYes: p.oddsYes ?? "",
      oddsNo: p.oddsNo ?? "",
      endsIn: p.endsIn ?? "",
    };
  } catch {
    return null;
  }
}

const m = top();
const en = buildFunnel(m);
const live = liveMarketCount();
const cn = m
  ? [
      `🏴 ${m.title}`,
      m.yes ? `YES ${m.yes}% · NO ${100 - m.yes}%` : "",
      ``,
      `🚀 $ARENA 创世积分季 已开：42% 总供应给积分持有者（上线 1:1），零预售、零团队预留。`,
      `📊 ${live} 个盘口在线 · 每条结算规则都写在链上。`,
      ``,
      `🪂 三步领 500 分：`,
      `1️⃣ 关注 ${X_HANDLE}`,
      `2️⃣ 评论区留下你的 Base 地址`,
      `3️⃣ ${TG_BOT} → 绑定即 +500 分（频道 ${TG_CHANNEL}）`,
      ``,
      `${SITE}/market/${m.id}?ref=x`,
    ]
      .filter((l) => l !== "")
      .join("\n")
  : `🪂 创世积分季：关注 ${X_HANDLE} · 评论区留 Base 地址 · ${TG_BOT} 领 500 分\n${SITE}?ref=x`;

console.log(`market: ${m ? `${m.id} · ${m.title}` : "(no hot board — generic copy)"}`);
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
