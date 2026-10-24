/**
 * The one place that knows the app's public origin.
 *
 * Every absolute URL the codebase emits — `metadataBase` (OG cards, canonical), the
 * WalletConnect / RainbowKit `appUrl` + `appIcon`, share and tweet links, the docs URL
 * handed to the wallet modal — reads from here, so a domain change is one env var and a
 * redeploy instead of a hunt through the tree.
 *
 * `NEXT_PUBLIC_*` is inlined at build time: the value below is what shipped in the bundle,
 * which is why the deploy config (render.yaml / the CI build step) pins the production
 * domain rather than leaving it to the host's runtime environment.
 *
 * The production fallback matters. If the variable is missing on a production build, an
 * honest absolute fallback keeps OG tags and the wallet metadata on the real domain;
 * defaulting to localhost in that case is how a live site ends up advertising
 * `http://localhost:3000` to every wallet and crawler. In development the same fallback
 * would be a lie, so it stays localhost there.
 */
const FALLBACK = process.env.NODE_ENV === "production" ? "https://predictionarena.online" : "http://localhost:3000";

const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim() || FALLBACK;

/** Absolute origin, no trailing slash: `https://predictionarena.online`. */
export const SITE_URL = raw.replace(/\/+$/, "");

/** Host only, no scheme: `predictionarena.online`. */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

/** Absolute URL for a path: `siteUrl("/icon-512.png")`. */
export function siteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * True when the visitor is on a shared/preview host rather than the canonical domain —
 * the only situation where the trust note has something to explain. The canonical host
 * itself is never "shared", old Render/Vercel/tunnel names always are.
 */
export function isPreviewHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h || h === SITE_HOST.toLowerCase()) return false;
  return (
    h.endsWith(".onrender.com") ||
    h.endsWith(".trycloudflare.com") ||
    h.endsWith(".vercel.app")
  );
}
