/**
 * Referral capture — one module for "who sent this visitor".
 *
 * The contract already pays for the loop: `bet(poolId, option, amount, referrer)` splits the 4%
 * fee and credits `referrer` with its share, on-chain, with no budget on our side. What was
 * missing is that the `?ref=` parameter only lived in the address bar for one page view — close
 * the tab and the attribution was gone, and a visitor who landed on a Frame and then browsed for
 * two minutes placed their bet with a zero referrer.
 *
 * So: capture once, persist in two places, read everywhere.
 *  - `localStorage` survives navigation inside the SPA and is the fast path.
 *  - a first-party cookie survives a full reload and is what a server render could read later.
 * Both are origin-scoped, neither is a tracking cookie, and both expire in 30 days.
 *
 * Accepted shapes: an EVM address (what the contract needs) or a short handle (what a human can
 * type in a Telegram channel). Anything else is dropped rather than stored — a mangled `ref` must
 * never be forwarded into `bet()`.
 */

export const REF_STORAGE_KEY = "pa.ref";
export const REF_COOKIE = "pa_ref";
export const REF_TTL_DAYS = 30;

export type RefKind = "wallet" | "handle";
export type Ref = { kind: RefKind; value: string };

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/i;

/** `?ref=` → a ref we are willing to keep, or null. Case is normalised for handles only. */
export function parseRef(raw: string | null | undefined): Ref | null {
  if (!raw) return null;
  const value = raw.trim();
  if (WALLET_RE.test(value)) return { kind: "wallet", value };
  if (HANDLE_RE.test(value)) return { kind: "handle", value: value.toLowerCase() };
  return null;
}

function cookieAttrs(): string {
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  return `path=/; max-age=${REF_TTL_DAYS * 86_400}; SameSite=Lax${secure}`;
}

/** Persist a ref in both stores. Never throws: storage can be blocked by the browser. */
export function persistRef(ref: Ref): void {
  try {
    window.localStorage.setItem(REF_STORAGE_KEY, JSON.stringify(ref));
  } catch {
    /* storage disabled — the cookie is the fallback */
  }
  try {
    document.cookie = `${REF_COOKIE}=${encodeURIComponent(`${ref.kind}:${ref.value}`)}; ${cookieAttrs()}`;
  } catch {
    /* cookies disabled — the URL param still works for this view */
  }
}

/** Read whatever was persisted earlier, preferring localStorage. */
export function readPersistedRef(): Ref | null {
  try {
    const raw = window.localStorage.getItem(REF_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Ref;
      if (parsed?.kind === "wallet" || parsed?.kind === "handle") return parsed;
    }
  } catch {
    /* fall through to the cookie */
  }
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${REF_COOKIE}=([^;]*)`));
    if (match) {
      const [kind, ...rest] = decodeURIComponent(match[1]).split(":");
      if ((kind === "wallet" || kind === "handle") && rest.length > 0) {
        return { kind, value: rest.join(":") };
      }
    }
  } catch {
    /* nothing persisted */
  }
  return null;
}

/**
 * Resolve the visitor's ref: the URL wins (a fresh invite should overwrite an old one), then the
 * persisted value. Returns null on the server.
 */
export function resolveRef(): Ref | null {
  if (typeof window === "undefined") return null;
  try {
    const fromUrl = parseRef(new URLSearchParams(window.location.search).get("ref"));
    if (fromUrl) {
      persistRef(fromUrl);
      return fromUrl;
    }
  } catch {
    /* no window.location */
  }
  return readPersistedRef();
}

/** Only a wallet-shaped ref can be forwarded to `bet()` — a handle cannot receive USDC. */
export function referrerAddress(): `0x${string}` | undefined {
  const ref = resolveRef();
  return ref?.kind === "wallet" ? (ref.value as `0x${string}`) : undefined;
}

/**
 * The link a user hands out. Carries the same `utm_*` shape the share button uses so a referral
 * click lands in the same analytics bucket as an X share, plus `ref` for the contract.
 */
export function inviteLink(origin: string, ref: string): string {
  const base = origin.replace(/\/+$/, "");
  const params = new URLSearchParams({
    ref,
    utm_source: "invite",
    utm_medium: "referral",
    utm_campaign: "invite_earn",
  });
  return `${base}/?${params.toString()}`;
}

/** What this visitor should share: their wallet once connected, otherwise the generic handle. */
export function shareableRef(address?: string | null): string {
  if (address && WALLET_RE.test(address)) return address;
  return "predict065";
}
