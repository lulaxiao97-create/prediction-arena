/**
 * Copy kit — the formatting primitives every marketing surface shares.
 *
 * The cloud content factory (`scripts/auto-market.ts`) and the desktop package
 * (`scripts/push-desktop-marketing.ts`) must produce the *same* numbers in the same shape: a tweet
 * that says 6.7× in one place and 6.6× in another is how a channel loses trust. So the maths and
 * the formatting live here, once.
 *
 * Rules encoded below:
 *  - prices get their own formatter (a meme token at $0.000140 must not render as "$0");
 *  - a share bar is ASCII cells, one character each, because X counts every emoji as two;
 *  - every URL is weighted at 23 characters, which is what X does regardless of real length.
 */

export const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://predictionarena.online").replace(/\/+$/, "");
export const X_HANDLE = "@Predict065";

/** X counts every URL as 23 characters. */
export function weight(text: string): number {
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  return urls.reduce((n, u) => n + 23 - u.length, text.length);
}

export function money(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

/** Prices need more precision than a liquidity figure: "$0" for TOSHI is worse than no number. */
export function price(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "$—";
  if (v >= 1_000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${Number(v.toPrecision(4))}`;
}

export function clipped(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/** Human time-to-close: "11h" / "3d". The caller decides what a closed market means. */
export function timeLeft(endTimeUtc?: string): string {
  if (!endTimeUtc) return "soon";
  const ms = new Date(endTimeUtc).getTime() - Date.now();
  if (ms <= 0) return "closed";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** 8-cell share bar. Blocks, not emoji: one character per cell in JS length. */
export function bar(sharePct: number, cells = 8): string {
  const filled = Math.max(0, Math.min(cells, Math.round((sharePct / 100) * cells)));
  return "█".repeat(filled) + "░".repeat(cells - filled);
}

/** Both sides, always: one number is a stat, two numbers are a fight. */
export function bothOdds(yes: number): { y: string; n: string } {
  return {
    y: (1 / Math.max(0.02, yes / 100)).toFixed(1),
    n: (1 / Math.max(0.02, (100 - yes) / 100)).toFixed(1),
  };
}

/** Market URL with the attribution shape every channel uses. */
export function trackedUrl(
  id: string | number,
  source: "x" | "telegram" | "farcaster",
  site: string = SITE,
): string {
  const url = new URL(`${site}/market/${id}`);
  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", source === "farcaster" ? "cast" : "social");
  url.searchParams.set("utm_campaign", "auto_market");
  url.searchParams.set("utm_content", String(id));
  url.searchParams.set("ref", source === "farcaster" ? "fc" : source);
  return url.toString();
}
