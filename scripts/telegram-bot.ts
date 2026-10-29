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
 * Token resolution (first hit wins): TELEGRAM_BOT_TOKEN, ~/.hermes/.tg_bot_token, repo `.env`.
 *
 *   bun scripts/telegram-bot.ts                 # long-poll and serve
 *   bun scripts/telegram-bot.ts --self-test     # run the conversation offline, print the replies
 *   bun scripts/telegram-bot.ts --once          # drain one batch and exit (cron-friendly)
 *
 * `--self-test` exists because the token lives in GitHub secrets: the flow has to be provable
 * without it, and a bot that "should work" is not a deliverable.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://predictionarena.online").replace(/\/+$/, "");
const CONTACT = "@Predict065";

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
        "规则很简单：通过这个链接进来的每一笔仓位，结算时合约把平台 4% 手续费的 30% 记给你。",
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

async function selfTest(): Promise<void> {
  const sessions = new Map<number, Session>();
  const chat = { id: 1, type: "private", username: "captain" };
  const address = "0x1111111111111111111111111111111111111111";
  const steps = ["/start captain", "not-a-wallet", address, "/link", "/help"];
  let failures = 0;
  let session: Session = { awaitingWallet: false };

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
  sessions.clear();
  console.log(
    failures === 0
      ? "\nself-test: OK — /start captain → wallet → own ref link + group template, invalid input re-asked"
      : `\nself-test: ${failures} failure(s)`,
  );
  if (failures > 0) process.exit(1);
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
    const msg = update.message;
    if (!msg?.text) continue;
    const chatId = msg.chat.id;
    const out = respond(msg.text, sessions.get(chatId) ?? { awaitingWallet: false }, {
      username: msg.from?.username,
      chatType: msg.chat.type,
    });
    sessions.set(chatId, out.session);
    for (const reply of out.replies) await send(api, chatId, reply);
    console.log(`[${new Date().toISOString()}] ${chatId} · ${msg.text.slice(0, 40)} → ${out.replies.length} repl${out.replies.length === 1 ? "y" : "ies"}`);
  }
  return next;
}

async function main(): Promise<void> {
  if (process.argv.includes("--self-test")) {
    await selfTest();
    return;
  }
  const tok = token();
  if (!tok) {
    console.error(
      "TELEGRAM_BOT_TOKEN is not set.\n" +
        "  put the token in ~/.hermes/.tg_bot_token (chmod 600) or export TELEGRAM_BOT_TOKEN, then rerun.\n" +
        "  the conversation itself can be verified offline: bun scripts/telegram-bot.ts --self-test",
    );
    process.exit(2);
  }
  const api = `https://api.telegram.org/bot${tok}`;
  const me = await fetch(`${api}/getMe`).then((r) => r.json() as Promise<{ ok: boolean; result?: { username?: string } }>);
  if (!me.ok) {
    console.error("getMe failed — token rejected");
    process.exit(2);
  }
  console.log(`bot @${me.result?.username ?? "?"} polling…`);

  const sessions = new Map<number, Session>();
  let offset = 0;
  if (process.argv.includes("--once")) {
    await drainOnce(api, offset, sessions);
    return;
  }
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
        const msg = update.message;
        if (!msg?.text) continue;
        const chatId = msg.chat.id;
        const out = respond(msg.text, sessions.get(chatId) ?? { awaitingWallet: false }, {
          username: msg.from?.username,
          chatType: msg.chat.type,
        });
        sessions.set(chatId, out.session);
        for (const reply of out.replies) await send(api, chatId, reply);
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
