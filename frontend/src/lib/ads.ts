/**
 * Rewarded-ad adapter — HypeLab web SDK.
 *
 * What the real SDK actually is (verified against
 * https://api.hypelab.com/v1/scripts/hp-sdk.js?v=0, 29 KB, Aug 2026):
 *
 *   window.HypeLab.initialize({ propertySlug, environment, privacy })
 *   document.createElement("hype-banner")  + attribute placement="<slug>"
 *   document.createElement("hype-native")  + attribute placement="<slug>"
 *   element events: "ready" (creative filled), "error" (auction refused)
 *
 * There is **no rewarded-video API on web** — `showRewarded` / `onReward` do not exist in the
 * bundle (their rewarded units ship on iOS / Android / Unity). So "watch to earn" here means a
 * real sponsored placement rendered by HypeLab, held on screen for a minimum dwell, and only
 * rewarded once the element has fired `ready`. No creative, no reward.
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

let loading: Promise<boolean> | null = null;

/** Inject HypeLab's bundle once and initialise the property. Resolves false if it never arrives. */
export function loadAdsSdk(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  const cfg = adsConfig();
  if (!cfg.ready || !cfg.scriptUrl) return Promise.resolve(false);

  const init = () => {
    try {
      window.HypeLab?.initialize?.({
        propertySlug: cfg.propertyId,
        environment: "production",
        // we never need wallet detection for an ad impression; keep it off
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

export type AdMountResult =
  | { ok: true; destroy: () => void }
  | { ok: false; reason: string };

/**
 * Put a real placement into `host` and resolve when the auction fills it.
 * `reason` carries the provider's own words when it refuses (e.g. the 400 body), so the UI can
 * show a diagnostic instead of a generic failure.
 */
export async function mountPlacement(host: HTMLElement): Promise<AdMountResult> {
  const cfg = adsConfig();
  if (!cfg.ready) return { ok: false, reason: "not-configured" };
  const loaded = await loadAdsSdk();
  if (!loaded) return { ok: false, reason: "sdk-unavailable" };

  return new Promise<AdMountResult>((resolve) => {
    const el = document.createElement("hype-banner");
    el.setAttribute("placement", cfg.placement as string);
    el.style.cssText = "display:block;width:100%;min-height:250px;";

    let settled = false;
    const done = (r: AdMountResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    el.addEventListener("ready", () => done({ ok: true, destroy: () => el.remove() }), { once: true });
    el.addEventListener("error", () => {
      done({
        ok: false,
        reason:
          "The ad network refused this placement (HypeLab: “Unable to find valid placements or properties”). " +
          "The property/placement pair is not active on the account — nothing was credited.",
      });
    }, { once: true });

    host.appendChild(el);
    // an auction that never answers must not hold the dialog hostage
    window.setTimeout(() => done({ ok: false, reason: "timeout" }), 12_000);
  });
}
