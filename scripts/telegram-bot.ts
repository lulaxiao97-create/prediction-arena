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
 *   bun scripts/telegram-bot.ts --report        # DM every captain their crew count + today's market
 *
 * `--self-test` exists because the token lives in GitHub secrets: the flow has to be provable
 * without it, and a bot that "should work" is not a deliverable.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://predictionarena.online").replace(/\/+$/, "");
const CONTACT = "@Predict065";

/** `--self-test` must not write to .data: an offline conversation check cannot register anyone. */
const SELF_TEST = process.argv.includes("--self-test");

/**
 * The one line every captain message carries.
 *
 * It states only what the contract does: a position that arrives through the captain's link carries
 * their address as `referrer`, and settlement pays them 30% of the 4% fee. No points, no airdrop, no
 * projected token — the previous version promised all three and the platform has no token to convert
 * into, which made every captain message a claim we could not keep.
 */
const PAYOUT_CN =
  "💸 <b>返佣是链上的</b> — 通过你的链接进来的每一笔仓位，结算时合约把这笔 4% 手续费里的 30% 直接打到你绑定的地址，可在 Basescan 逐笔核对。";
/** The whitepaper entry point, in one place: every captain-facing menu links to the same URL. */
const WHITEPAPER_BTN = { text: "📄 How the venue works", url: `${SITE}/whitepaper` };

const PAYOUT_EN =
  "💸 <b>The referral cut is on-chain</b> — every position that arrives through your link names your address as `referrer`, and settlement pays you 30% of that market's 4% fee, verifiable per tx on Basescan.";


type Chat = { id: number; type: string; username?: string };
type Message = {
  message_id: number;
  chat: Chat;
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
  date?: number;
};
type Update = { update_id: number; message?: Message; chat_member?: ChatMemberUpdate };

type ChatMemberUpdate = {
  chat: { id: number; title?: string; username?: string };
  date: number;
  old_chat_member?: { status: string };
  new_chat_member?: { status: string; user?: { id: number; username?: string; first_name?: string } };
  invite_link?: { invite_link: string; name?: string };
};

type Outgoing = {
  text: string;
  /** Inline keyboard rows; `url` buttons open, `callback_data` buttons echo back a command. */
  buttons?: { text: string; url?: string; command?: string }[][];
  parseMode?: "HTML";
};

type Session = { awaitingWallet: boolean; wallet?: string; pendingRef?: string };

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
    "🧑‍💼 That market your group argues about every day? You can trade it now (Base mainnet, USDC)",
    "",
    "Prediction Arena is a binary prediction market: the winning side takes the losing side's stake, contract escrow, 4% fee, your principal is never touched.",
    "",
    "Take a side on today's board → " + link,
    "",
    "(I take a cut of the fee: the contract pays me 30% at settlement - it never touches your payout.)",
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
    "(I get 30% of the protocol fee from this link at settlement. It comes out of the fee, not",
    "out of your payout.)",
  ].join("\n");
}

const HELP: Outgoing = {
  text: [
    "🤖 Prediction Arena captain bot",
    "",
    "/captain — get your referral link (30% of the 4% fee, paid on-chain)",
    "/link — resend the link for the wallet you already gave me",
    "/markets — where to find today's board",
    "/crew — join the channel (I verify membership against Telegram itself)",
    "/help — this message",
    "",
    "No sign-up, no KYC, no custody. The contract pays the address you give me, at settlement.",
  ].join("\n"),
  buttons: [[{ text: "🏴 Open today's board", url: SITE }], [WHITEPAPER_BTN]],
};

/**
 * Referral attribution that the bot can actually verify.
 *
 * Telegram's API has no "did you forward this to three groups" endpoint, so any bot that claims to
 * check that is lying to its users. What IS verifiable: a new wallet arrived through your deep link
 * (`/start ref_0x...`) and then bound an address of its own. That is the gate: N distinct bound wallets.
 */
const REFS_FILE = join(ROOT, ".data", "refs.json");

function readRefs(): Record<string, { ref: string; at: string }> {
  try {
    return JSON.parse(readFileSync(REFS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function recordRef(referee: string, ref: string): void {
  const refs = readRefs();
  const key = referee.toLowerCase();
  if (refs[key]) return;                     // first referrer wins, forever
  refs[key] = { ref: ref.toLowerCase(), at: new Date().toISOString() };
  mkdirSync(join(ROOT, ".data"), { recursive: true });
  writeFileSync(REFS_FILE, `${JSON.stringify(refs, null, 2)}\n`);
}

function chiefsOf(wallet: string): number {
  const key = wallet.toLowerCase();
  return Object.values(readRefs()).filter((r) => r.ref === key).length;
}

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
    const referrer = session.pendingRef && session.pendingRef.toLowerCase() !== address.toLowerCase() ? session.pendingRef : null;
    if (referrer && !SELF_TEST) recordRef(address, referrer);
    replies.push({
      text: [
        "✅ Locked in. Your payout address:",
        `\`${address}\``,
        "",
        "Your personal link (this address is the on-chain payee):",
        refLink(address),
        "",
        "📣 <b>Send this ref link to friends, or drop it in your crypto groups</b>:",
        "· On every one of their settlements the contract pays 30% of that market's 4% fee straight to the address above",
        "· Not us wiring you money - the contract pays it at settlement, every tx is on Basescan",
        "",
        PAYOUT_CN,
        "",
        "Simple rules: every position that comes in through this link pays you 30% of the market's 4% fee at settlement.",
        "No transfer from us - the contract pays directly, so you don't have to trust anyone. It's all visible on Basescan.",
        "",
        "Here's the copy for group owners / group chats - paste it straight in:",
        "——————",
        groupTemplate(address),
        "——————",
        "",
        "Shorter version (same links, less text):",
        "——————",
        groupTemplateEn(address),
        "——————",
      ].join("\n"),
      buttons: [
        [{ text: "🏴 See today's board", url: SITE }],
        [WHITEPAPER_BTN],
        [{ text: "📈 On-chain attribution", url: SITE }],
      ],
      parseMode: "HTML",
    });
    replies.push({
      text: [
        `📣 <b>Your crew so far: ${chiefsOf(address)} wallet(s)</b>`,
        "A crew member is a wallet that arrived through your link and bound a payout address - the bot counts them by reading the same register it writes.",
        "",
        `Post this in your groups (anyone who taps in and binds is your crew):`,
        `· On-site (with ref): ${refLink(address)}`,
        `· Straight into Telegram: https://t.me/predictaing_bot?start=ref_${address}`,
        "",
        `Send /crew to confirm you're in ${CREW_CHANNEL} - settlement notices and new markets land there first.`,
      ].join("\n"),
      buttons: [
        [{ text: "📣 Join the channel", url: `https://t.me/${CREW_CHANNEL.replace(/^@/, "")}` }],
        [{ text: "🏴 See today's board", url: SITE }],
      ],
    });
    return { replies, session: { awaitingWallet: false, wallet: address, pendingRef: session.pendingRef } };
  }

  if (lower.startsWith("/start") || lower.startsWith("/captain")) {
    const payload = raw.split(/\s+/)[1]?.toLowerCase();
    const refPayload = payload?.startsWith("ref") ? payload.replace(/^ref_?/, "") : "";
    const pendingRef = WALLET_RE.test(refPayload) ? refPayload : session.pendingRef;
    if (session.wallet && payload !== "captain") {
      replies.push({
        text: [
          `You're already bound to ${session.wallet.slice(0, 6)}…${session.wallet.slice(-4)}.`,
          "",
          "Link:",
          refLink(session.wallet),
          "",
          "To switch payout addresses, just send me the new one (0x + 40 chars).",
        ].join("\n"),
        buttons: [[{ text: "🏴 Today's board", url: SITE }], [WHITEPAPER_BTN]],
      });
      return { replies, session };
    }
    replies.push({
      text: [
        PAYOUT_CN,
        "",
        "🧑‍💼 Captain program - 30% of the platform's 4% fee on every position that arrives through your link, paid by the contract at settlement.",
        "",
        "The job: swap the market links in your group for your own.",
        "",
        "Step 1: send me the **Base wallet address** you want to be paid to (0x + 40 hex chars).",
        "No sign-up, no KYC, no custody of funds; the address is only used to get paid.",
      ].join("\n"),
      buttons: [
        [{ text: "See the board", url: SITE }],
        [{ text: "How do I get paid?", command: "/how" }],
      ],
    });
    return { replies, session: { ...session, awaitingWallet: true } };
  }

  if (lower === "/crew") {
    replies.push(
      session.wallet
        ? {
            text: [
              `🎟 Crew pass - join ${CREW_CHANNEL} and I verify it myself, no screenshots.`,
              "",
              "Step 1: join the channel",
              "Step 2: come back and send /crew - I ask Telegram for the member list.",
              "",
              "What you get there: new markets as they open, settlement notices with the tx, and the fee maths written out.",
            ].join("\n"),
            buttons: [
              [{ text: "📣 Join the channel", url: "https://t.me/predictionarena_hq" }],
              [{ text: "✅ I've joined - verify", command: "/crew" }],
            ],
          }
        : {
            text: "Send me your Base payout address first (0x + 40), then I'll check the channel against it.",
            buttons: [[{ text: "Start binding", command: "/start captain" }]],
          },
    );
    return { replies, session };
  }

  if (lower === "/copy") {
    replies.push(
      session.wallet
        ? {
            text: ["Copy-paste for your group (your link is inside):", "——————", groupTemplate(session.wallet), "——————"].join("\n"),
            buttons: [[{ text: "🏴 Open the board", url: refLink(session.wallet) }]],
          }
        : { text: "Send /captain to bind your payout address first, then I'll hand you the group copy.", buttons: [[{ text: "Start binding", command: "/captain" }]] },
    );
    return { replies, session };
  }

  if (lower === "/link") {
    if (session.wallet) {
      replies.push({
        text: `Your link (payee ${session.wallet}):\n\n${refLink(session.wallet)}`,
        buttons: [[{ text: "🏴 Today's board", url: SITE }], [WHITEPAPER_BTN]],
      });
    } else {
      replies.push({
        text: "No wallet bound yet. Send /captain, then send me the payout address starting with 0x.",
        buttons: [[{ text: "Start", command: "/captain" }]],
      });
    }
    return { replies, session };
  }

  if (lower === "/markets") {
    replies.push({
      text: "The board is rebuilt from live prices every 30 minutes. Today's markets are all here:",
      buttons: [[{ text: "🏴 Open the board", url: SITE }], [WHITEPAPER_BTN]],
    });
    return { replies, session };
  }

  if (lower === "/how" || lower.includes("怎么收") || lower.includes("how do i get paid")) {
    replies.push({
      text: [
        "How the payout happens (no middleman):",
        "",
        "1. When someone bets, the contract records that address as `referrer`;",
        "2. The 4% fee goes into that market's escrow;",
        "3. At settlement, 30% of it is credited to the referrer and is claimable.",
        "",
        "So: the address must be a Base wallet you control; to change it, send me the new one and future bets follow it.",
        "The amount depends on the volume you bring in - there is no floor, which is why we don't promise an income.",
      ].join("\n"),
      buttons: [[{ text: "Bind address", command: "/captain" }]],
    });
    return { replies, session };
  }

  if (lower === "/help" || lower === "/start") {
    replies.push(HELP);
    return { replies, session };
  }

  replies.push({
    text: session.awaitingWallet
      ? "I need a Base wallet address (0x + 40 hex chars) to build your referral link. Just paste it."
      : "Didn't catch that. Send /captain for your referral link, or /help to see what I do.",
    buttons: [[{ text: "Captain program", command: "/captain" }]],
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
    `🏴 New market — ${pool.title}`,
    "",
    `YES ${cells(yes)} ${yes}% → ${odds(yes)}×`,
    `NO  ${cells(no)} ${no}% → ${odds(no)}×`,
    "",
    `${pool.traders ?? 0} already took a side${left ? ` · closes in ${left}` : ""}`,
    "",
    `Bet here → ${marketRefLink(wallet, pool.id)}`,
    "",
    "(The winning side takes the losing side's stake, 4% fee, contract escrow. This link is mine - positions that come through it pay me 30% of the fee at settlement, and it never touches your payout.)",
  ].join("\n");
}

function blastOutgoing(wallet: string, pool: Pool): Outgoing {
  return {
    text: blastText(wallet, pool),
    buttons: [
      [{ text: "🏴 Trade it now", url: marketRefLink(wallet, pool.id) }],
      [{ text: "Copy group post", command: "/copy" }],
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
 * The daily crew DM: how many wallets a captain has actually brought in, and the market worth
 * forwarding today.
 *
 * Everything here is a fact the bot itself wrote: `crew` is the count of bound wallets whose first
 * referrer is this captain (.data/refs.json), and the market comes from the same manifest the site
 * renders. There is deliberately no score, no rank and no projected token — those were the parts of
 * this message that could not be verified.
 */


/**
 * The market the daily report leads with.
 *
 * Same three signals the desktop pack uses — a split crowd, a moving tape, a deadline inside a week
 * — but computed here so the DM never depends on a file some other script may not have written.
 */
type HotPool = { id: string | number; title: string; category?: string; yesShare?: number; traders?: number; endTimeUtc?: string; status?: number };

function hottestMarket(): HotPool | null {
  try {
    const board = JSON.parse(readFileSync(join(ROOT, "frontend", "public", "pools.json"), "utf8")) as { pools?: HotPool[] };
    const pools = (board.pools ?? []).filter((p) => (p.status ?? 1) === 1);
    if (!pools.length) return null;
    const score = (p: HotPool) => {
      const yes = Number(p.yesShare ?? 0.5);
      const controversy = 1 - Math.abs(yes - 0.5) * 2;
      const hoursLeft = p.endTimeUtc ? (Date.parse(p.endTimeUtc) - Date.now()) / 3.6e6 : 999;
      const urgency = hoursLeft <= 48 ? 0.3 : hoursLeft <= 24 * 7 ? 0.15 : 0;
      const crowd = Math.min(1, (p.traders ?? 0) / 320) * 0.2;
      return controversy + urgency + crowd;
    };
    return [...pools].sort((a, b) => score(b) - score(a))[0] ?? null;
  } catch {
    return null;
  }
}

async function crewReport(opts: { api: string | null; dryRun: boolean }): Promise<BroadcastResult> {
  const store = loadStore();
  const captains = Object.values(store.captains);
  if (captains.length === 0) return { sent: 0, skipped: "no registered captains yet", failed: 0 };

  let sent = 0;
  let failed = 0;
  for (const captain of captains) {
    const crew = chiefsOf(captain.wallet);
    const hot = hottestMarket();
    const text = [
      "📊 <b>Your referral report</b>",
      "",
      `Crew bound through your link: <b>${crew}</b> wallet(s)`,
      "A crew member is counted when a wallet arrives through your link and binds a payout address.",
      "",
      ...(hot
        ? [
            `🔥 Worth forwarding today: ${hot.title}`,
            `YES ${Math.round(Number(hot.yesShare ?? 0.5) * 100)}% · ${hot.traders ?? 0} in → forward this to your group:`,
            `${SITE}/market/${hot.id}?ref=${captain.wallet}&utm_source=telegram&utm_medium=referral&utm_campaign=daily`,
            "",
          ]
        : []),
      PAYOUT_CN,
      "",
      `Your link: ${refLink(captain.wallet)}`,
      "(Per-position payout only. There is no token, no points balance and no promised income - the contract pays 30% of the fee on positions your link carries.)",
    ].join("\n");

    if (opts.dryRun) {
      console.log(`\n--- crew DM → ${captain.chatId} (${captain.wallet.slice(0, 6)}…${captain.wallet.slice(-4)})\n${text}`);
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
      body: JSON.stringify({
        chat_id: captain.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        // Two taps from the daily report: read the rules, or forward the link that pays.
        reply_markup: {
          inline_keyboard: [
            [WHITEPAPER_BTN],
            [{ text: "🔗 My ref link", url: refLink(captain.wallet) }],
          ],
        },
      }),
    });
    if (res.ok) sent += 1;
    else {
      failed += 1;
      console.error(`crew DM chat ${captain.chatId} → HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    }
  }
  return { sent, skipped: null, failed };
}


/**
 * Crew: channel membership, verified rather than claimed.
 *
 * `getChatMember` answers for a user id in a channel the bot administers, so "you're in the channel"
 * is a fact Telegram states, not a screenshot. There is no reward attached to it — the answer is
 * used to decide whether the bot can tell the person what the channel is for, and nothing else.
 */
const CREW_CHANNEL = process.env.CREW_CHANNEL ?? "@predictionarena_hq";

async function channelMember(api: string, userId: number): Promise<boolean> {
  try {
    const res = await fetch(`${api}/getChatMember?chat_id=${encodeURIComponent(CREW_CHANNEL)}&user_id=${userId}`);
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean; result?: { status?: string } };
    const status = body.result?.status;
    return Boolean(body.ok) && (status === "member" || status === "administrator" || status === "creator");
  } catch {
    return false;
  }
}

async function selfTest(): Promise<void> {
  const sessions = new Map<number, Session>();
  const chat = { id: 1, type: "private", username: "captain" };
  const address = "0x1111111111111111111111111111111111111111";
  const steps = ["/start captain", "not-a-wallet", address, "/link", "/crew", "/help"];
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
    if (step === "/start captain" && !/Base wallet|wallet/i.test(joined)) {
      console.error("  ✗ did not ask for a wallet");
      failures += 1;
    }
    if (step === "not-a-wallet" && !/0x|address/i.test(joined)) {
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
      if (!/group/i.test(joined) || !joined.includes("——————")) {
        console.error("  ✗ did not include a group template");
        failures += 1;
      }
      if (/points|\$ARENA|airdrop/i.test(joined)) {
        console.error("  ✗ bind flow still promises points or a token");
        failures += 1;
      }
      if (!/crew/i.test(joined)) {
        console.error("  ✗ bind flow did not mention the crew count");
        failures += 1;
      }
    }
    if (step === "/crew" && !/channel/i.test(joined)) {
      console.error("  ✗ /crew did not explain the channel");
      failures += 1;
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
  check(!/guaranteed|we promise|\bI'?ll earn\b/i.test(blast), "no revenue promise in the forwarded text");

  const copy = respond("/copy", { awaitingWallet: false, wallet: address }, {});
  check(copy.replies[0].text.includes(`ref=${address}`), "/copy hands back a paste-ready group post");
  const copyUnbound = respond("/copy", { awaitingWallet: false }, {});
  check(/bind|captain/i.test(copyUnbound.replies[0].text), "/copy without a wallet asks to bind first");

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
  const session = sessions.get(chatId) ?? { awaitingWallet: false };

  // /crew is the one command that needs the network: membership in the channel is checked against
  // Telegram itself, so the grant is a fact rather than a screenshot from the user.
  if (text.trim().toLowerCase() === "/crew") {
    const wallet = session.wallet ?? store().captains[String(chatId)]?.wallet;
    if (!wallet) {
      await send(api, chatId, {
        text: "Send /start captain to bind your Base payout address first, then I'll check the channel against it.",
        buttons: [[{ text: "Start binding", command: "/start captain" }]],
      });
      return;
    }
    const member = await channelMember(api, chatId);
    if (!member) {
      await send(api, chatId, {
        text: `Can't see your membership in ${CREW_CHANNEL} yet. Tap below to join, then send /crew again.`,
        buttons: [
          [{ text: "📣 Join the channel", url: `https://t.me/${CREW_CHANNEL.replace(/^@/, "")}` }],
          [{ text: "✅ Check again", command: "/crew" }],
        ],
      });
      return;
    }
    // Membership is a fact Telegram just confirmed. Nothing is minted for it: the bot reports the
    // crew count it can read from the register and points at the channel's actual purpose.
    const chiefs = chiefsOf(wallet);
    await send(api, chatId, {
      text: [
        `✅ Verified: you're in ${CREW_CHANNEL}.`,
        "",
        `Crew bound through your link: <b>${chiefs}</b>`,
        "The channel carries new markets as they open and settlement notices with the tx hash.",
        "",
        "Your payout is per position, on-chain: 30% of that market's 4% fee, paid at settlement to the address you bound.",
      ].join("\n"),
      buttons: [[{ text: "🏴 Today's board", url: SITE }], [WHITEPAPER_BTN]],
    });
    console.log(`[${new Date().toISOString()}] crew verified: chat ${chatId} (${chiefs} crew)`);
    return;
  }

  const out = respond(text, session, { username, chatType: msg.chat.type });
  sessions.set(chatId, out.session);
  for (const reply of out.replies) await send(api, chatId, reply);

  if (out.session.wallet && WALLET_RE.test(out.session.wallet)) {
    bindCaptain(store(), chatId, out.session.wallet, username);
    saveStore(store());
    console.log(`[${new Date().toISOString()}] captain bound: chat ${chatId} → ${out.session.wallet}`);
  }
  console.log(`[${new Date().toISOString()}] ${chatId} · ${text.slice(0, 40)} → ${out.replies.length} repl${out.replies.length === 1 ? "y" : "ies"}`);
}

/** Append a channel join so growth can be attributed to the invite link that produced it.
 *
 *  Bot API will not list channel members, but it does deliver `chat_member` updates to a bot that
 *  is a channel admin, and that update carries the `invite_link` the person joined through. Giving
 *  every surface its own named link (x / tg / site) turns "we got three subscribers" into "two came
 *  from the X bio, one from the site footer".
 */
function recordJoin(cm: ChatMemberUpdate): void {
  const was = cm.old_chat_member?.status ?? "left";
  const now = cm.new_chat_member?.status ?? "?";
  if (now !== "member" && now !== "administrator") return;
  if (was === "member" || was === "administrator") return;
  const row = {
    at: new Date((cm.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    chat: cm.chat?.username ?? String(cm.chat?.id ?? ""),
    userId: cm.new_chat_member?.user?.id ?? null,
    username: cm.new_chat_member?.user?.username ?? null,
    name: cm.invite_link?.name ?? null,
    link: cm.invite_link?.invite_link ?? null,
  };
  const file = join(ROOT, ".data", "tg-joins.jsonl");
  try {
    mkdirSync(join(ROOT, ".data"), { recursive: true });
    appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
    console.log(`[${row.at}] join ${row.username ?? row.userId} via ${row.name ?? "direct"}`);
  } catch (err) {
    console.error(`join log failed: ${(err as Error).message}`);
  }
}

async function drainOnce(api: string, offset: number, sessions: Map<number, Session>): Promise<number> {
  const res = await fetch(`${api}/getUpdates?timeout=0&offset=${offset}&allowed_updates=["message","callback_query","chat_member"]`);
  if (!res.ok) {
    console.error(`getUpdates → HTTP ${res.status}`);
    return offset;
  }
  const data = (await res.json()) as { ok: boolean; result?: Update[] };
  if (!data.ok || !data.result?.length) return offset;
  let next = offset;
  for (const update of data.result) {
    next = Math.max(next, update.update_id + 1);
    if (update.chat_member) {
      recordJoin(update.chat_member);
      continue;
    }
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

  if (process.argv.includes("--report")) {
    const dryRun = process.argv.includes("--dry-run");
    const result = await crewReport({ api: api || null, dryRun });
    console.log(
      `report: ${result.skipped ? `skipped — ${result.skipped}` : `${result.sent} sent`}${result.failed ? `, ${result.failed} failed` : ""}`,
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
      const res = await fetch(`${api}/getUpdates?timeout=30&offset=${offset}&allowed_updates=["message","callback_query","chat_member"]`);
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 3_000));
        continue;
      }
      const data = (await res.json()) as { ok: boolean; result?: Update[] };
      for (const update of data.result ?? []) {
        offset = Math.max(offset, update.update_id + 1);
        if (update.chat_member) {
          recordJoin(update.chat_member);
          continue;
        }
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
