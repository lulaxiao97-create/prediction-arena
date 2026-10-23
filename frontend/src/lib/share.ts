/**
 * Sharing helpers — one place that knows how a market becomes a link, a tweet or a
 * clipboard entry, so the desktop panel, the mobile sheet and the market header cannot
 * drift apart.
 */

/**
 * Canonical, absolute market URL.
 *
 * The order matters for hydration: the build-time origin is the same string on the server and
 * in the browser, while `window.location.origin` is not (127.0.0.1 vs localhost, a preview
 * alias, a proxy). Reading the env first keeps the share link identical in both renders — and
 * makes the copied link the public origin rather than whatever host the tab happens to use.
 */
export function marketUrl(id: string | number | bigint, origin?: string): string {
  const base = (
    origin ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    (typeof window !== "undefined" ? window.location.origin : undefined) ??
    "http://localhost:3000"
  ).replace(/\/+$/, "");
  return `${base}/market/${id}`;
}

/**
 * X/Twitter web intent. `text` carries the pitch and the mention; `url` is separate so X
 * renders its own card preview from the market's Open Graph tags (title + shield artwork).
 */
export function tweetIntent({
  title,
  yes,
  no,
  url,
}: {
  title: string;
  yes: number;
  no: number;
  url: string;
}): string {
  const text = `I'm predicting on "${title}"! Current probability: ${yes}% YES / ${no}% NO. Check it out on @PredictionArena`;
  const params = new URLSearchParams({ text, url });
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
