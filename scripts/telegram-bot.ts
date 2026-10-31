/**
 * Telegram captain bot — the passive recruiting half of the referral loop.
 *
 * The daily post in @predictionarena_hq ends with a button. Tapping it opens this bot with the
 * deep-link payload `captain`; from there the bot does the whole conversation a human would
 * otherwise repeat:
 *
 *   /start captain  →  "send the Base wallet you want to be paid to"
 *   0x…            →  their own `?ref=<address>` link + a copy-paste group post + a share button
 *   /captain       →  same, on demand
 *
 * Why the bot and not a form: the payout is per referred position, forever, so the reply has to
 * live somewhere the captain can come back to. A chat is that place, and it costs nothing.
 *
 * Registered captains are kept in a store (`CAPTAINS_FILE`, default `.data/captains.json`) so the
 * bot can act *first* instead of waiting to be asked: `--broadcast` pushes the newest market to
 * every captain with their own `?ref=` link, already written as a group post.
 *
 * Token resolution (first hit wins): TELEGRAM_BOT_TOKEN, ~/.hermes/.tg_bot_token, repo `.env`.
 *
 *   bun scripts/telegram-bot.ts                 # long-poll and serve
 *   bun scripts/telegram-bot.ts --self-test     # run the conversation offline, print the replies
 *   bun scripts/telegram-bot.ts --once          # drain one batch and exit (cron-friendly)
 *   bun scripts/telegram-bot.ts --broadcast     # DM the newest market to every captain
 *   bun scripts/telegram-bot.ts --captains      # who is registered (masked wallets)
 *   bun scripts/telegram-bot.ts --leaderboard   # DM every captain their points + projected airdrop
 *
 * `--self-test` exists because the token lives in GitHub secrets: the flow has to be provable
 * without it, and a bot that "should work" is not a deliverable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://predictionarena.online").replace(/\/+$/, "");
const CONTACT = "@Predict065";

/**
 * The one line every captain message carries while the genesis season is open.
 *
 * It says three things and stops: points exist, bets and referrals earn them, and they convert at
 * genesis. It does NOT promise a price — the ledger is a scoreboard until a token actually exists,
 * and the disclaimer in docs/TOKENOMICS.md is the long version of that.
 */
const AIRDROP_CN =
  "🔥 <b>Arena Points 创世空投季</b> — 每一笔下注、每一个通过你链接进来的人，都在给你累积积分；积分在创世时 1:1 兑换 $ARENA。";
const AIRDROP_EN =
  "🔥 <b>Arena Points genesis airdrop</b> — every bet and every referral earns points; points convert 1:1 into $ARENA at genesis.";


type Chat = { id: number; type: string; username?: string };
type Message = {
  message_id: number;
  chat: Chat;
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
  date?: number;
};
type Update = { update_id: number; message?: Message };

type Outgoing = {
  text: string;
  /** Inline keyboard rows; `url` buttons open, `callback_data` buttons echo back a command. */
  buttons?: { text: string; url?: string; command?: string }[][];
  parseMode?: "HTML";
};

type Session = { awaitingWallet: boolean; wallet?: string };

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * The captain register.
 *
 * In-memory sessions lose everything on restart, and a captain whose link is forgotten is a captain
 * who never posts. One small JSON file is enough: it is written on every binding and read at boot,
 * and it carries the last market pushed to each chat so a broadcast never repeats itself.
 */
const CAPTAINS_FILE = process.env.CAPTAINS_FILE ?? join(ROOT, ".data", "captains.json");

type Captain = {
  chatId: number;
  wallet: string;
  username?: string;
  createdAt: string;
  updatedAt: string;
  pushes: number;
};

type Store = {
  captains: Record<string, Captain>;
  lastBroadcast?: { marketId: string; at: string };
};

function loadStore(path = CAPTAINS_FILE): Store {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Store;
    return { captains: parsed.captains ?? {}, lastBroadcast: parsed.lastBroadcast };
  } catch {
    return { captains: {} };
  }
}

function saveStore(store: Store, path = CAPTAINS_FILE): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

/** Binding is idempotent: the same wallet twice updates the chat, never duplicates the captain. */
function bindCaptain(store: Store, chatId: number, wallet: string, username?: string): Captain {
  const key = String(chatId);
  const existing = store.captains[key];
  const captain: Captain = existing
    ? { ...existing, wallet, username: username ?? existing.username, updatedAt: new Date().toISOString() }
    : { chatId, wallet, username, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pushes: 0 };
  store.captains[key] = captain;
  return captain;
}

function token(): string | null {
  const fromEnv = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  for (const path of [join(homedir(), ".hermes", ".tg_bot_token"), join(ROOT, ".env")]) {
    if (!existsSync(path)) continue;
    if (path.endsWith(".env")) {
      const match = readFileSync(path, "utf8").match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    } else {
      const raw = readFileSync(path, "utf8").trim();
      if (raw) return raw;
    }
  }
  return null;
}

/** Who this wallet's referrals pay. The contract only ever sees an address. */
function refLink(address: string): string {
  const url = new URL(SITE);
  url.searchParams.set("ref", address);
  url.searchParams.set("utm_source", "invite");
  url.searchParams.set("utm_medium", "referral");
  url.searchParams.set("utm_campaign", "captain");
  return url.toString();
}

/** The post a captain actually sends. Numbers are left out on purpose: theirs will differ. */
function groupTemplate(address: string): string {
  const link = refLink(address);
  return [
    "🧑‍💼 群里每天吵的那个盘口，现在可以押了（Base 主网，USDC）",
    "",
    "Prediction Arena 二元预测市场：赢的一边拿走输的一边的仓位，合约托管，4% 手续费，不碰你的本金。",
    "",
    "今天可以站队的盘口 → " + link,
    "",
    "（我在拿他们的手续费分成，用这个链接下注，结算时合约会分我 30% 的手续费——不影响你的赔付。）",
  ].join("\n");
}

function groupTemplateEn(address: string): string {
  const link = refLink(address);
  return [
    "🏴 The market your group is already arguing about is now tradable (Base, USDC).",
    "",
    "Binary markets, non-custodial escrow, 4% fee, the losing side pays the winning side.",
    "",
    "Take a side → " + link,
    "",
    "(I get 30% of the protocol fee on positions from this link, paid by the contract at settlement.",
    "It comes out of the fee, not out of your payout.)",
  ].join("\n");
}

const HELP: Outgoing = {
  text: [
    "🤖 Prediction Arena captain bot",
    "",
    "/captain — get your referral link (30% of the 4% fee, paid on-chain)",
    "/link — resend the link for the wallet you already gave me",
    "/markets — where to find today's board",
    "/help — this message",
    "",
    "No sign-up, no KYC, no custody. The contract pays the address you give me, at settlement.",
  ].join("\n"),
  buttons: [[{ text: "🏴 Open today's board", url: SITE }]],
};

/**
 * The whole conversation, as a pure function of (text, session). Keeping it pure is what makes
 * `--self-test` meaningful: the same code path answers a real update and a synthetic one.
 */
function respond(
  text: string,
  session: Session,
  ctx: { username?: string; chatType?: string },
): { replies: Outgoing[]; session: Session } {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  const replies: Outgoing[] = [];

  // A bare address is the answer to the wallet question, whatever else is in the message.
  if (WALLET_RE.test(raw)) {
    const address = raw;
    replies.push({
      text: [
        "✅ 记下了。你的分润地址：",
        `\`${address}\``,
        "",
        "你的专属链接（这个地址就是链上收款人）：",
        refLink(address),
        "",
        AIRDROP_CN,
        "",
        "规则很简单：通过这个链接进来的每一笔仓位，结算时合约把平台 4% 手续费的 30% 记给你。",
        "积分规则：每 $1 下注 10 分，冷门方向 ×2，48 小时内到期的盘口 ×1.5；你的团长积分 = 团员积分的 20%。",
        "不是我们转账给你，是合约直接付——所以不用信任任何人，Basescan 上能看到。",
        "",
        "下面是给群主/群聊用的话术，直接复制发群：",
        "——————",
        groupTemplate(address),
        "——————",
        "",
        "英文版（发给海外群）：",
        "——————",
        groupTemplateEn(address),
        "——————",
      ].join("\n"),
      buttons: [
        [{ text: "🏴 看今天的盘口", url: SITE }],
        [{ text: "📈 查看链上归因", url: SITE }],
      ],
      parseMode: "HTML",
    });
    return { replies, session: { awaitingWallet: false, wallet: address } };
  }

  if (lower.startsWith("/start") || lower.startsWith("/captain")) {
    const payload = raw.split(/\s+/)[1]?.toLowerCase();
    if (session.wallet && payload !== "captain") {
      replies.push({
        text: [
          `你已经绑定过 ${session.wallet.slice(0, 6)}…${session.wallet.slice(-4)}。`,
          "",
          "链接：",
          refLink(session.wallet),
          "",
          "要换收款地址，直接把新地址发给我（0x + 40 位）。",
        ].join("\n"),
        buttons: [[{ text: "🏴 今天的盘口", url: SITE }]],
      });
      return { replies, session };
    }
    replies.push({
      text: [
        AIRDROP_CN,
        "",
        "🧑‍💼 团长计划 — 平台 4% 手续费的 30%，结算时由合约直接付给你。",
        "",
        "要做的事：把你群里的盘口链接换成你的专属链接。",
        "",
        "第一步：把你收款的 **Base 钱包地址** 发给我（0x 开头，40 位十六进制）。",
        "不需要注册、不需要 KYC、不托管资金；地址只用来收款。",
      ].join("\n"),
      buttons: [
        [{ text: "先看盘口", url: SITE }],
        [{ text: "怎么收款？", command: "/how" }],
      ],
    });
    return { replies, session: { ...session, awaitingWallet: true } };
  }

  if (lower === "/copy") {
    replies.push(
      session.wallet
        ? {
            text: ["直接复制发群（里面是你的链接）：", "——————", groupTemplate(session.wallet), "——————"].join("\n"),
            buttons: [[{ text: "🏴 打开盘口", url: refLink(session.wallet) }]],
          }
        : { text: "先发 /captain 绑定收款地址，我再给你群发话术。", buttons: [[{ text: "开始绑定", command: "/captain" }]] },
    );
    return { replies, session };
  }

  if (lower === "/link") {
    if (session.wallet) {
      replies.push({
        text: `你的链接（收款人 ${session.wallet}）：\n\n${refLink(session.wallet)}`,
        buttons: [[{ text: "🏴 今天的盘口", url: SITE }]],
      });
    } else {
      replies.push({
        text: "还没有绑定钱包。发 /captain，然后把 0x 开头的收款地址发给我。",
        buttons: [[{ text: "开始", command: "/captain" }]],
      });
    }
    return { replies, session };
  }

  if (lower === "/markets") {
    replies.push({
      text: "盘口每 30 分钟用实时行情重建一次。今天的盘口都在这里：",
      buttons: [[{ text: "🏴 打开盘口看板", url: SITE }]],
    });
    return { replies, session };
  }

  if (lower === "/how" || lower.includes("怎么收") || lower.includes("how do i get paid")) {
    replies.push({
      text: [
        "收款是怎么发生的（没有中间人）：",
        "",
        "1. 下注时合约会记下 `referrer` 这个地址；",
        "2. 4% 手续费进该盘口的托管；",
        "3. 盘口结算时，其中 30% 直接记到 referrer 名下，可领取。",
        "",
        "所以：地址必须是你能控制的 Base 钱包；换地址就重新发给我，之后的下注跟新地址走。",
        "金额取决于你带来的下注量——没有任何保底，这也是我们不承诺收入的原因。",
      ].join("\n"),
      buttons: [[{ text: "绑定地址", command: "/captain" }]],
    });
    return { replies, session };
  }

  if (lower === "/help" || lower === "/start") {
    replies.push(HELP);
    return { replies, session };
  }

  replies.push({
    text: session.awaitingWallet
      ? "我需要一个 Base 钱包地址（0x + 40 位十六进制）才能生成你的分润链接。直接贴地址就行。"
      : "没看懂这条。发 /captain 拿分润链接，或 /help 看能做什么。",
    buttons: [[{ text: "团长计划", command: "/captain" }]],
  });
  return { replies, session };
}

/** Render an Outgoing into Telegram's sendMessage payload (exported for the self-test). */
function payload(out: Outgoing, chatId: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: out.text,
    disable_web_page_preview: false,
  };
  if (out.parseMode) body.parse_mode = "HTML";
  if (out.buttons?.length) {
    body.reply_markup = {
      inline_keyboard: out.buttons.map((row) =>
        row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.command ?? "/captain" })),
      ),
    };
  }
  return body;
}

async function send(api: string, chatId: number, out: Outgoing): Promise<void> {
  const res = await fetch(`${api}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload(out, chatId)),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`sendMessage → HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------- captain broadcast
//
// The daily channel post is one message to strangers. This is the part that makes it compound: the
// people who already registered get the new market pushed at them, already written as a group post
// with their own `?ref=` in it, so forwarding costs them one tap. Numbers come from the same
// manifest the site renders, so a captain can never quote a price the board does not have.

type Pool = {
  id: string | number;
  title: string;
  status?: number;
  endTimeUtc?: string;
  traders?: number;
  yesShare?: number;
};

function openPools(): Pool[] {
  const path = join(ROOT, "frontend", "public", "pools.json");
  const board = JSON.parse(readFileSync(path, "utf8")) as { pools?: Pool[] };
  return (board.pools ?? []).filter((p) => (p.status ?? 1) === 1).filter((p) => !p.endTimeUtc || new Date(p.endTimeUtc).getTime() > Date.now());
}

/** Ids are monotonic on this venue, so the highest open id is the newest market. */
function newestPool(pools = openPools()): Pool | null {
  if (pools.length === 0) return null;
  return [...pools].sort((a, b) => Number(b.id) - Number(a.id))[0];
}

function share(pool: Pool): number {
  const raw = Number(pool.yesShare ?? Number.NaN);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.5;
}

function cells(pct: number, n = 8): string {
  const filled = Math.max(0, Math.min(n, Math.round((pct / 100) * n)));
  return "█".repeat(filled) + "░".repeat(n - filled);
}

function odds(pct: number): string {
  return (1 / Math.max(0.02, pct / 100)).toFixed(1);
}

function hoursLeft(endTimeUtc?: string): string {
  if (!endTimeUtc) return "";
  const ms = new Date(endTimeUtc).getTime() - Date.now();
  if (ms <= 0) return "";
  const h = Math.round(ms / 3_600_000);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** Landing on the market being promoted, not the home page — a click that needs a second search is lost. */
function marketRefLink(address: string, id: string | number): string {
  const url = new URL(`${SITE}/market/${id}`);
  url.searchParams.set("ref", address);
  url.searchParams.set("utm_source", "invite");
  url.searchParams.set("utm_medium", "referral");
  url.searchParams.set("utm_campaign", "captain_market");
  return url.toString();
}

/** What the captain forwards. Their link, the duel, and the fee wording — nothing else. */
function blastText(wallet: string, pool: Pool): string {
  const yes = Math.round(share(pool) * 100);
  const no = 100 - yes;
  const left = hoursLeft(pool.endTimeUtc);
  return [
    `🏴 新盘口：${pool.title}`,
    "",
    `YES ${cells(yes)} ${yes}% → ${odds(yes)}×`,
    `NO  ${cells(no)} ${no}% → ${odds(no)}×`,
    "",
    `${pool.traders ?? 0} 人已经站队${left ? ` · ${left} 后结束` : ""}`,
    "",
    `押这里 → ${marketRefLink(wallet, pool.id)}`,
    "",
    "（赢的一边拿走输的一边的仓位，4% 手续费，合约托管。这个链接是我自己的，通过它下的仓位，结算时合约把手续费里的 30% 记给我——不影响你的赔付。）",
  ].join("\n");
}

function blastOutgoing(wallet: string, pool: Pool): Outgoing {
  return {
    text: blastText(wallet, pool),
    buttons: [
      [{ text: "🏴 直接下注", url: marketRefLink(wallet, pool.id) }],
      [{ text: "复制群发话术", command: "/copy" }],
    ],
  };
}

type BroadcastResult = { sent: number; skipped: string | null; failed: number };

async function broadcast(opts: { api: string | null; dryRun: boolean; force?: boolean; chat?: number }): Promise<BroadcastResult> {
  const store = loadStore();
  const pool = newestPool();
  if (!pool) return { sent: 0, skipped: "no open market in the manifest", failed: 0 };
  if (!opts.force && store.lastBroadcast?.marketId === String(pool.id)) {
    return { sent: 0, skipped: `market ${pool.id} was already broadcast at ${store.lastBroadcast.at}`, failed: 0 };
  }
  const captains = Object.values(store.captains).filter((c) => !opts.chat || c.chatId === opts.chat);
  if (captains.length === 0) return { sent: 0, skipped: "no registered captains yet", failed: 0 };

  let sent = 0;
  let failed = 0;
  for (const captain of captains) {
    const out = blastOutgoing(captain.wallet, pool);
    if (opts.dryRun) {
      console.log(`\n--- DM → ${captain.chatId} (${captain.wallet.slice(0, 6)}…${captain.wallet.slice(-4)})\n${out.text}`);
      sent += 1;
      continue;
    }
    if (!opts.api) {
      failed += 1;
      continue;
    }
    const res = await fetch(`${opts.api}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload(out, captain.chatId)),
    });
    if (res.ok) {
      sent += 1;
      captain.pushes += 1;
      captain.updatedAt = new Date().toISOString();
    } else {
      failed += 1;
      console.error(`chat ${captain.chatId} → HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    }
  }
  if (!opts.dryRun) {
    store.lastBroadcast = { marketId: String(pool.id), at: new Date().toISOString() };
    saveStore(store);
  }
  return { sent, skipped: null, failed };
}

/**
 * The daily points DM: every captain gets their own score, their rank and their projected slice of
 * the genesis allocation. This is the FOMO loop — a captain who can see the number moving posts more
 * than one who was told "there is a referral programme somewhere".
 *
 * Reads the ledger scripts/sync-points.ts writes (frontend/public/points.json). No ledger file (or an
 * empty one) is not an error: the message still goes out, honestly reading zero.
 */
type PointsLedger = {
  totals?: { points?: number; wallets?: number; bets?: number };
  holders?: Record<string, { points?: number; fromReferrals?: number; bets?: number }>;
  generatedAt?: string;
};

function readPointsLedger(): PointsLedger {
  try {
    return JSON.parse(readFileSync(join(ROOT, "frontend", "public", "points.json"), "utf8")) as PointsLedger;
  } catch {
    return {};
  }
}

async function leaderboardPush(opts: { api: string | null; dryRun: boolean }): Promise<BroadcastResult> {
  const store = loadStore();
  const captains = Object.values(store.captains);
  if (captains.length === 0) return { sent: 0, skipped: "no registered captains yet", failed: 0 };
  const ledger = readPointsLedger();
  const holders = ledger.holders ?? {};
  const total = ledger.totals?.points ?? 0;
  const ranked = Object.entries(holders)
    .sort((a, b) => (b[1].points ?? 0) - (a[1].points ?? 0))
    .map(([addr]) => addr);

  let sent = 0;
  let failed = 0;
  for (const captain of captains) {
    const key = captain.wallet.toLowerCase();
    const row = holders[key];
    const points = row?.points ?? 0;
    const rank = ranked.indexOf(key) + 1;
    const est = total > 0 ? Math.floor((points / total) * 420_000_000) : 0;
    const text = [
      "📊 <b>Arena Points · 24h 战报</b>",
      "",
      `你的积分：<b>${points.toLocaleString("en-US")}</b>${rank > 0 ? `（第 ${rank} 名 / 共 ${ranked.length} 人）` : ""}`,
      `其中来自团员的 20% 分润：${(row?.fromReferrals ?? 0).toLocaleString("en-US")}`,
      `预估创世份额：<b>${est.toLocaleString("en-US")} $ARENA</b>`,
      "",
      `全站：${(ledger.totals?.wallets ?? 0)} 个钱包、${total.toLocaleString("en-US")} 分、${(ledger.totals?.bets ?? 0)} 笔下注。`,
      "",
      AIRDROP_CN,
      "想涨分：把带 ?ref= 的链接发到群里，每一笔团员下注都给你加 20%。",
      "",
      `你的链接：${refLink(captain.wallet)}`,
      "（积分是对早期参与的记录，暂无代币、不可购买、不承诺价值；上线时按 1:1 兑换。）",
    ].join("\n");

    if (opts.dryRun) {
      console.log(`\n--- points DM → ${captain.chatId} (${captain.wallet.slice(0, 6)}…${captain.wallet.slice(-4)})\n${text}`);
      sent += 1;
      continue;
    }
    if (!opts.api) {
      failed += 1;
      continue;
    }
    const res = await fetch(`${opts.api}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: captain.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (res.ok) sent += 1;
    else {
      failed += 1;
      console.error(`points DM chat ${captain.chatId} → HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    }
  }
  return { sent, skipped: null, failed };
}

async function selfTest(): Promise<void> {
  const sessions = new Map<number, Session>();
  const chat = { id: 1, type: "private", username: "captain" };
  const address = "0x1111111111111111111111111111111111111111";
  const steps = ["/start captain", "not-a-wallet", address, "/link", "/help"];
  let failures = 0;
  let session: Session = { awaitingWallet: false };
  const check = (ok: boolean, label: string) => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) failures += 1;
  };

  for (const step of steps) {
    const out = respond(step, session, { username: chat.username, chatType: chat.type });
    session = out.session;
    console.log(`\n=== user: ${step}`);
    for (const reply of out.replies) {
      console.log(reply.text.split("\n").slice(0, 4).join("\n") + (reply.text.split("\n").length > 4 ? "\n  …" : ""));
      if (reply.buttons) console.log("  buttons: " + reply.buttons.flat().map((b) => b.text).join(" | "));
    }
    const joined = out.replies.map((r) => r.text).join("\n");
    if (step === "/start captain" && !/Base 钱包|wallet/i.test(joined)) {
      console.error("  ✗ did not ask for a wallet");
      failures += 1;
    }
    if (step === "not-a-wallet" && !/0x|地址/.test(joined)) {
      console.error("  ✗ did not re-ask for an address");
      failures += 1;
    }
    if (step === address) {
      if (!joined.includes(`ref=${address}`)) {
        console.error("  ✗ link is missing the captain's address as ref");
        failures += 1;
      }
      if (!/30%/.test(joined)) {
        console.error("  ✗ did not state the 30% cut");
        failures += 1;
      }
      if (!/群/.test(joined)) {
        console.error("  ✗ did not include a group template");
        failures += 1;
      }
    }
    if (step === "/link" && !joined.includes(`ref=${address}`)) {
      console.error("  ✗ /link did not resend the bound link");
      failures += 1;
    }
  }
  // ---- register + proactive broadcast -------------------------------------------------------
  // These two are the difference between a bot that answers and a bot that recruits: the register
  // must survive a restart, and the push must carry each captain's own link.
  console.log("\ncaptain register");
  const tmp = join(tmpdir(), `pa-captains-${Date.now()}.json`);
  const reg: Store = { captains: {} };
  bindCaptain(reg, 42, address, "captain");
  bindCaptain(reg, 42, address, "captain"); // idempotent: same chat, same wallet
  saveStore(reg, tmp);
  const reloaded = loadStore(tmp);
  check(Object.keys(reloaded.captains).length === 1, "binding twice keeps one captain");
  check(reloaded.captains["42"].wallet === address, "the register survives a restart");

  console.log("\nbroadcast copy");
  const pool: Pool = {
    id: "700099",
    title: "Will AERO close above $0.7000 before October 31, 2026?",
    status: 1,
    endTimeUtc: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    traders: 311,
    yesShare: 0.166,
  };
  const blast = blastText(address, pool);
  check(blast.includes(`ref=${address}`), "the DM carries this captain's own ref");
  check(/30%/.test(blast), "the DM states the 30% cut");
  check(/YES █|░/.test(blast) && /NO/.test(blast), "the DM shows both sides with bars");
  check(blast.includes(`/market/${pool.id}?ref=${address}`), "the DM links the promoted market with this captain's ref, not the home page");
  check(!/weight:|source:|ref:|market:/.test(blast.replace(/ref=/g, "")), "no operator noise in the forwarded text");
  check(!blast.includes("我要") && !blast.includes("我们承诺"), "no revenue promise in the forwarded text");

  const copy = respond("/copy", { awaitingWallet: false, wallet: address }, {});
  check(copy.replies[0].text.includes(`ref=${address}`), "/copy hands back a paste-ready group post");
  const copyUnbound = respond("/copy", { awaitingWallet: false }, {});
  check(/绑定|captain/.test(copyUnbound.replies[0].text), "/copy without a wallet asks to bind first");

  sessions.clear();
  console.log(
    failures === 0
      ? "\nself-test: OK — /start captain → wallet → own ref link + group template, invalid input re-asked, register persists, broadcast carries the captain's link"
      : `\nself-test: ${failures} failure(s)`,
  );
  if (failures > 0) process.exit(1);
}

/** One lazily-loaded register, shared by the poll loop and the broadcast command. */
let STORE: Store | null = null;
function store(): Store {
  if (!STORE) STORE = loadStore();
  return STORE;
}

/**
 * One update → replies, plus the side effect that matters: a wallet that arrived is a captain.
 * Buttons send `callback_data`, which arrives as a callback_query, not a message — a bot that only
 * reads `message` looks alive and responds to nothing a user taps.
 */
async function handleUpdate(api: string, update: Update, sessions: Map<number, Session>): Promise<void> {
  const callback = (update as { callback_query?: { data?: string; from?: { username?: string }; message?: Message } }).callback_query;
  const msg = update.message ?? callback?.message;
  const text = update.message?.text ?? callback?.data;
  if (!msg || !text) return;

  const chatId = msg.chat.id;
  const username = (update.message?.from ?? callback?.from)?.username;
  const out = respond(text, sessions.get(chatId) ?? { awaitingWallet: false }, { username, chatType: msg.chat.type });
  sessions.set(chatId, out.session);
  for (const reply of out.replies) await send(api, chatId, reply);

  if (out.session.wallet && WALLET_RE.test(out.session.wallet)) {
    bindCaptain(store(), chatId, out.session.wallet, username);
    saveStore(store());
    console.log(`[${new Date().toISOString()}] captain bound: chat ${chatId} → ${out.session.wallet}`);
  }
  console.log(`[${new Date().toISOString()}] ${chatId} · ${text.slice(0, 40)} → ${out.replies.length} repl${out.replies.length === 1 ? "y" : "ies"}`);
}

async function drainOnce(api: string, offset: number, sessions: Map<number, Session>): Promise<number> {
  const res = await fetch(`${api}/getUpdates?timeout=0&offset=${offset}&allowed_updates=["message","callback_query"]`);
  if (!res.ok) {
    console.error(`getUpdates → HTTP ${res.status}`);
    return offset;
  }
  const data = (await res.json()) as { ok: boolean; result?: Update[] };
  if (!data.ok || !data.result?.length) return offset;
  let next = offset;
  for (const update of data.result) {
    next = Math.max(next, update.update_id + 1);
    await handleUpdate(api, update, sessions);
  }
  return next;
}

async function main(): Promise<void> {
  if (process.argv.includes("--self-test")) {
    await selfTest();
    return;
  }

  // Read-only / no-token commands first: they are how an operator checks the register without
  // holding the credential that the bot itself runs on.
  if (process.argv.includes("--captains")) {
    const captains = Object.values(store().captains);
    console.log(`${captains.length} captain(s) registered`);
    for (const c of captains) {
      console.log(`  chat ${c.chatId} · ${c.wallet} · pushes ${c.pushes} · bound ${c.createdAt.slice(0, 10)}${c.username ? ` · @${c.username}` : ""}`);
    }
    return;
  }

  const tok = token();
  const wantsBroadcast = process.argv.includes("--broadcast");
  if (!tok && !wantsBroadcast) {
    console.error(
      "TELEGRAM_BOT_TOKEN is not set.\n" +
        "  put the token in ~/.hermes/.tg_bot_token (chmod 600) or export TELEGRAM_BOT_TOKEN, then rerun.\n" +
        "  the conversation itself can be verified offline: bun scripts/telegram-bot.ts --self-test",
    );
    process.exit(2);
  }
  const api = tok ? `https://api.telegram.org/bot${tok}` : "";

  if (process.argv.includes("--leaderboard")) {
    const dryRun = process.argv.includes("--dry-run");
    const result = await leaderboardPush({ api: api || null, dryRun });
    console.log(
      `leaderboard: ${result.skipped ? `skipped — ${result.skipped}` : `${result.sent} sent`}${result.failed ? `, ${result.failed} failed` : ""}`,
    );
    return;
  }

  if (wantsBroadcast) {
    const dryRun = process.argv.includes("--dry-run");
    const result = await broadcast({ api: api || null, dryRun, force: process.argv.includes("--force") });
    console.log(
      `broadcast: ${result.skipped ? `skipped — ${result.skipped}` : `${result.sent} sent`}${result.failed ? `, ${result.failed} failed` : ""}`,
    );
    return;
  }

  const me = await fetch(`${api}/getMe`).then((r) => r.json() as Promise<{ ok: boolean; result?: { username?: string } }>);
  if (!me.ok) {
    console.error("getMe failed — token rejected");
    process.exit(2);
  }
  console.log(`bot @${me.result?.username ?? "?"} polling… (${Object.keys(store().captains).length} captains on file)`);

  const sessions = new Map<number, Session>();
  let offset = 0;
  if (process.argv.includes("--once")) {
    await drainOnce(api, offset, sessions);
    return;
  }

  // While serving, the bot also acts on its own schedule: every `--broadcast-every` minutes it
  // checks whether the board produced a market it has not pushed yet, and DMs it to every captain
  // with their own link. That is the difference between a bot that waits to be asked and one that
  // keeps putting the next market in front of the people who distribute it.
  const everyArg = process.argv.find((a) => a.startsWith("--broadcast-every="));
  const everyMinutes = everyArg ? Math.max(5, Number(everyArg.split("=")[1]) || 15) : 15;
  let nextBroadcast = Date.now() + 45_000;

  // Long-poll loop. A single failed request must not kill a process that is meant to run for weeks.
  for (;;) {
    try {
      const res = await fetch(`${api}/getUpdates?timeout=30&offset=${offset}&allowed_updates=["message","callback_query"]`);
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 3_000));
        continue;
      }
      const data = (await res.json()) as { ok: boolean; result?: Update[] };
      for (const update of data.result ?? []) {
        offset = Math.max(offset, update.update_id + 1);
        await handleUpdate(api, update, sessions);
      }
      if (Date.now() >= nextBroadcast) {
        nextBroadcast = Date.now() + everyMinutes * 60_000;
        const result = await broadcast({ api, dryRun: false });
        if (result.sent || result.failed) {
          console.log(`[${new Date().toISOString()}] broadcast: ${result.sent} sent${result.failed ? `, ${result.failed} failed` : ""}`);
        }
      }
    } catch (err) {
      console.error(`poll error: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}

main().catch((err) => {
  console.error(`telegram-bot failed: ${(err as Error).message}`);
  process.exit(1);
});
