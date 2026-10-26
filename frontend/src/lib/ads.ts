/**
 * Rewarded-ad adapter — HypeLab web SDK.
 *
 * What the real SDK actually is (read off
 * https://api.hypelab.com/v1/scripts/hp-sdk.js?v=0, 29,170 bytes):
 *
 *   window.HypeLab.initialize({ propertySlug, environment, privacy })
 *   document.createElement("hype-banner")  + attribute placement="<slug>"
 *   element events: "ready" (creative filled) | "error" (no bid / refused)
 *
 * Notes that matter for correctness:
 * - There is no rewarded-video API on web. `showRewarded` / `onReward` appear 0 times in the
 *   bundle; rewarded units ship on iOS / Android / Unity only. So "watch to earn" is a real
 *   sponsored placement held on screen, not a publisher-supplied video.
 * - `buildImpression()` hardcodes `banner: { w: 0, h: 0 }` — the 0×0 in the auction payload is the
 *   SDK's own behaviour, not a layout bug on our side.
 * - The SDK only proceeds on HTTP 200; a 204 means "auction ran, nobody bid", a 400 means the
 *   property/placement pair is unknown. The element fires `error` for all of them, so we watch the
 *   fetch status ourselves to tell the user the truth instead of one generic failure.
 */

export type AdsConfig = {
  provider: string | null;
  propertyId: string | null;
  placement: string | null;
  scriptUrl: string | null;
  ready: boolean;
};

type HypeLabSdk = {
  initialize?: (cfg: Record<string, unknown>) => void;
  setWalletAddresses?: (addrs: string[]) => void;
};

declare global {
  interface Window {
    HypeLab?: HypeLabSdk;
    __hype?: { config?: Record<string, unknown>; identity?: unknown };
  }
}

const env = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export function adsConfig(): AdsConfig {
  const provider = env(process.env.NEXT_PUBLIC_ADS_PROVIDER);
  const propertyId = env(process.env.NEXT_PUBLIC_HYPELAB_PROPERTY_ID);
  const placement = env(process.env.NEXT_PUBLIC_HYPELAB_PLACEMENT_ID);
  const scriptUrl = env(process.env.NEXT_PUBLIC_ADS_SCRIPT_URL);
  return {
    provider,
    propertyId,
    placement,
    scriptUrl,
    ready: Boolean(provider && propertyId && placement && scriptUrl),
  };
}

/** Last HTTP status seen on HypeLab's auction endpoint (200 fill / 204 no bid / 400 unknown). */
let lastAuctionStatus: number | null = null;
let fetchPatched = false;

function observeAuctions() {
  if (fetchPatched || typeof window === "undefined" || !window.fetch) return;
  fetchPatched = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await orig(input as RequestInfo, init);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/rtb_requests")) lastAuctionStatus = res.status;
    } catch {
      /* never let diagnostics break the request */
    }
    return res;
  };
}

let loading: Promise<boolean> | null = null;

/** Inject HypeLab's bundle once and initialise the property. Resolves false if it never arrives. */
export function loadAdsSdk(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  const cfg = adsConfig();
  if (!cfg.ready || !cfg.scriptUrl) return Promise.resolve(false);
  observeAuctions();

  const init = () => {
    try {
      window.HypeLab?.initialize?.({
        propertySlug: cfg.propertyId,
        environment: "production",
        // an ad impression never needs wallet detection; keep it off
        privacy: { disableWalletDetection: true },
      });
      return true;
    } catch {
      return false;
    }
  };

  if (window.HypeLab) return Promise.resolve(init());
  if (loading) return loading;

  loading = new Promise<boolean>((resolve) => {
    const el = document.createElement("script");
    el.src = cfg.scriptUrl as string;
    el.async = true;
    el.dataset.paAds = "1";
    el.onload = () => resolve(init());
    el.onerror = () => resolve(false);
    document.head.appendChild(el);
    window.setTimeout(() => resolve(init()), 9000);
  });
  return loading;
}

export type AdFailReason = "not-configured" | "sdk-unavailable" | "no-fill" | "invalid-placement" | "timeout";
export type AdMountResult = { ok: true; destroy: () => void } | { ok: false; reason: AdFailReason };

function auctionError(): AdFailReason {
  if (lastAuctionStatus === 204) return "no-fill";
  if (lastAuctionStatus === 400) return "invalid-placement";
  return "no-fill";
}

function once(host: HTMLElement, placement: string): Promise<AdMountResult> {
  return new Promise<AdMountResult>((resolve) => {
    const el = document.createElement("hype-banner");
    el.setAttribute("placement", placement);
    el.style.cssText = "display:block;width:100%;min-height:250px;";

    let settled = false;
    const done = (r: AdMountResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    el.addEventListener("ready", () => done({ ok: true, destroy: () => el.remove() }), { once: true });
    el.addEventListener("error", () => {
      const reason = auctionError();
      el.remove();
      done({ ok: false, reason });
    }, { once: true });

    host.appendChild(el);
    window.setTimeout(() => {
      if (!settled) el.remove();
      done({ ok: false, reason: "timeout" });
    }, 9_000);
  });
}

/**
 * Put a real placement into `host` and resolve when the auction fills it.
 * One silent retry on "no bid": a second auction frequently fills where the first one did not.
 */
export async function mountPlacement(host: HTMLElement): Promise<AdMountResult> {
  const cfg = adsConfig();
  if (!cfg.ready) return { ok: false, reason: "not-configured" };
  const loaded = await loadAdsSdk();
  if (!loaded) return { ok: false, reason: "sdk-unavailable" };

  lastAuctionStatus = null;
  const first = await once(host, cfg.placement as string);
  if (first.ok) return first;
  if (first.reason === "invalid-placement" || first.reason === "timeout") return first;

  await new Promise((r) => window.setTimeout(r, 2_500));
  return once(host, cfg.placement as string);
}
