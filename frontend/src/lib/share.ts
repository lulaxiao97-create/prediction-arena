/**
 * Sharing helpers — one place that knows how a market becomes a link, a tweet or a
 * clipboard entry, so the desktop panel, the mobile sheet and the market header cannot
 * drift apart.
 */

import { X_HANDLE } from "@/lib/social";

const X_HANDLE_TAG = `@${X_HANDLE}`;
import { SITE_URL } from "@/lib/site";

/**
 * Canonical, absolute market URL.
 *
 * The origin comes from the one build-time constant (`@/lib/site`), which is the same string
 * on the server and in the browser — `window.location.origin` is not (127.0.0.1 vs localhost,
 * a preview alias, a proxy). Reading it first keeps the share link identical in both renders
 * and makes the copied link the public origin rather than whatever host the tab happens to use.
 */
export function marketUrl(id: string | number | bigint, origin?: string): string {
  const base = (origin ?? SITE_URL).replace(/\/+$/, "");
  return `${base}/market/${id}`;
}

export type ShareChannel = "x" | "telegram" | "copy";

/**
 * The market URL with attribution attached.
 *
 * Every place a human can hand our link to someone else gets a channel marker: `utm_*` for any
 * analytics that reads the landing page, plus a short `ref` that survives copy-paste into a chat
 * that strips query strings from the preview. It changes nothing about how the page resolves —
 * `/market/12?ref=x` renders the same market — so the link is safe to paste anywhere.
 */
export function trackedMarketUrl(
  id: string | number | bigint,
  channel: ShareChannel = "x",
  origin?: string,
): string {
  const url = new URL(marketUrl(id, origin));
  url.searchParams.set("utm_source", channel);
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", "market_share");
  url.searchParams.set("utm_content", String(id));
  url.searchParams.set("ref", channel);
  return url.toString();
}

/**
 * Numbers behind a data-driven market. Mirrors `MarketData` in lib/types; declared structurally
 * here so the share helpers stay usable from a route handler that only has the manifest row.
 */
export type ShareMarketData = {
  asset: string;
  spotUsd: number;
  strikeUsd: number;
  direction: "above" | "below";
  windowDays: number;
  source: string;
  asOf: string;
};

const MAX_TITLE = 92;

/** X truncates a post at 280; every URL counts as 23 no matter how long it really is. */
const MAX_WEIGHT = 272;

const HOOKS = [
  "Two AI agents argued this one. Here is where the crowd landed:",
  "This market is closer than the headline sounds:",
  "Odds just moved — the crowd is leaning one way:",
  "One side is paying better than 2× right now:",
];

function weight(text: string): number {
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  return urls.reduce((n, u) => n + 23 - u.length, text.length);
}

/** Stable 0..3 from the id string — same market, same hook, no randomness between renders. */
function hookIndex(id: string | number | bigint): number {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return h % HOOKS.length;
}

function compactMoney(v: number): string {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1_000) return `$${Math.round(v).toLocaleString("en-US")}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toPrecision(3)}`;
}

/** Payout multiple on the side you are buying: 30% YES pays 3.3×. */
export function payoutMultiple(yesPct: number, side: "yes" | "no" = "yes"): number {
  const p = side === "yes" ? yesPct / 100 : 1 - yesPct / 100;
  return 1 / Math.max(0.02, Math.min(1, Math.max(0, p)));
}

/**
 * X/Twitter web intent.
 *
 * The tweet answers "why would anyone click this" in one line: the live spot, the strike being
 * argued over, the probability and the payout multiple, plus which feed verified the numbers.
 * `url` is passed separately so X still renders the market's own Open Graph card underneath.
 *
 * Length is bounded on purpose — X truncates at 280 characters and a truncated number reads as a
 * typo, so the title is clipped before the numbers ever are.
 */
export function tweetIntent({
  title,
  yes,
  no,
  url,
  market,
  id,
}: {
  title: string;
  yes: number;
  no: number;
  url: string;
  market?: ShareMarketData | null;
  /** Market id — only used to pick which preset hook the tweet opens with. */
  id?: string | number | bigint;
}): string {
  const short = title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1).trimEnd()}…` : title;

  // The title usually already states the strike; repeating it wastes half the tweet. Say the
  // number the title cannot know — where spot actually is — and fall back to the full pair only
  // when the strike is somehow missing from the copy.
  const strikeText = market ? compactMoney(market.strikeUsd) : "";
  const head = market
    ? short.includes(strikeText)
      ? `"${short}" — ${market.asset} at ${compactMoney(market.spotUsd)} right now.`
      : `"${short}" — ${market.asset} ${market.direction === "above" ? "above" : "below"} ${strikeText}, spot ${compactMoney(market.spotUsd)}.`
    : `"${short}"`;
  const odds = `${yes}% YES · pays ${payoutMultiple(yes).toFixed(1)}×`;
  const tail = market ? `Verified ${market.source} feed. ${X_HANDLE_TAG}` : X_HANDLE_TAG;

  // A preset first line is what turns a link into a post: it gives the reader a reason to open the
  // market instead of scrolling past a bare odds string. Four variants, picked deterministically
  // from the market id so two people sharing the same market say the same thing and the feed does
  // not read like a bot repeating itself.
  const body = `${head} ${odds} · ${no}% NO. ${tail}`;
  const hook = id === undefined ? "" : HOOKS[hookIndex(id)];
  const withHook = hook ? `${hook}\n\n${body}` : body;
  const text = weight(withHook) <= MAX_WEIGHT ? withHook : body;

  const params = new URLSearchParams({ text, url });
  // `via` credits the official account; the handle is read from lib/social so a rename is one edit.
  params.set("via", X_HANDLE);
  return `https://x.com/intent/tweet?${params.toString()}`;
}

/**
 * Clipboard write with a fallback for insecure contexts: `navigator.clipboard` only exists
 * on HTTPS/localhost, and a shared link from a LAN preview should still copy.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }

  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
