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
  /** a second network, used only when the primary auction keeps coming back empty */
  fallbackScriptUrl: string | null;
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
  const fallbackScriptUrl = env(process.env.NEXT_PUBLIC_FALLBACK_ADS_SCRIPT_URL);
  return {
    provider,
    propertyId,
    placement,
    scriptUrl,
    fallbackScriptUrl,
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
export type AdMountResult = { ok: true; provider: string; destroy: () => void } | { ok: false; reason: AdFailReason };

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

    el.addEventListener("ready", () => done({ ok: true, provider: "hypelab", destroy: () => el.remove() }), { once: true });
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

/* ── fallback network ─────────────────────────────────────────────────────────
 * A second network only needs to honour this contract, and the rest of the app keeps working:
 *
 *   window.PAAdFallback = {
 *     mount(host: HTMLElement, opts: { placement: string }): Promise<"filled" | "nofill">,
 *     unmount?(host: HTMLElement): void,
 *   }
 *
 * The script named by NEXT_PUBLIC_FALLBACK_ADS_SCRIPT_URL is loaded lazily, only after the primary
 * auction came back empty, so a healthy HypeLab never pays for the extra request. Adsterra and
 * PropellerAds both expose "load script → render into a div → poll for creative" adapters that fit
 * this shape; wiring one is a ~40-line shim here plus its script URL in the env, no UI change.
 */
type FallbackBridge = {
  mount: (host: HTMLElement, opts: { placement: string }) => Promise<"filled" | "nofill">;
  unmount?: (host: HTMLElement) => void;
};

declare global {
  interface Window {
    PAAdFallback?: FallbackBridge;
  }
}

let fallbackLoading: Promise<boolean> | null = null;

function loadFallback(url: string): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.PAAdFallback) return Promise.resolve(true);
  if (fallbackLoading) return fallbackLoading;
  fallbackLoading = new Promise<boolean>((resolve) => {
    const el = document.createElement("script");
    el.src = url;
    el.async = true;
    el.dataset.paAdsFallback = "1";
    el.onload = () => resolve(Boolean(window.PAAdFallback));
    el.onerror = () => resolve(false);
    document.head.appendChild(el);
    window.setTimeout(() => resolve(Boolean(window.PAAdFallback)), 8_000);
  });
  return fallbackLoading;
}

async function viaFallback(host: HTMLElement, url: string, placement: string): Promise<AdMountResult> {
  const loaded = await loadFallback(url);
  const bridge = window.PAAdFallback;
  if (!loaded || !bridge) return { ok: false, reason: "no-fill" };
  try {
    const outcome = await bridge.mount(host, { placement });
    if (outcome === "filled") {
      return {
        ok: true,
        provider: "fallback",
        destroy: () => {
          try {
            bridge.unmount?.(host);
          } catch {
            /* the shim owns its own teardown */
          }
          host.innerHTML = "";
        },
      };
    }
  } catch {
    /* a broken shim must not take the dialog down with it */
  }
  return { ok: false, reason: "no-fill" };
}

/**
 * Put a real placement into `host` and resolve when the auction fills it.
 *
 * Order: HypeLab (one silent retry, because a second auction often fills where the first did not)
 * → the configured fallback network. `probe` mounts into a detached 1px node so the auto-retry
 * loop can check for demand without disturbing the panel the user is looking at.
 */
export async function mountPlacement(host: HTMLElement, opts: { probe?: boolean; retries?: number } = {}): Promise<AdMountResult> {
  const cfg = adsConfig();
  if (!cfg.ready) return { ok: false, reason: "not-configured" };
  const loaded = await loadAdsSdk();
  if (!loaded) return { ok: false, reason: "sdk-unavailable" };

  lastAuctionStatus = null;
  const target = opts.probe ? probeHost() : host;
  const first = await once(target, cfg.placement as string);
  if (first.ok) {
    if (opts.probe) {
      first.destroy();
      return first;
    }
    return first;
  }
  const retryable = first.reason === "no-fill" || first.reason === "timeout";
  const budget = opts.retries ?? 2;
  if (!retryable || budget < 2) {
    // no second auction on this path; the modal shows the empty state straight away and its
    // background probe keeps trying, so the user never stares at a spinner for the whole chain
    if (cfg.fallbackScriptUrl) {
      const fb = await viaFallback(opts.probe ? probeHost() : host, cfg.fallbackScriptUrl, cfg.placement as string);
      if (fb.ok && opts.probe) fb.destroy();
      if (fb.ok) return fb;
    }
    return first;
  }

  if (!opts.probe) await new Promise((r) => window.setTimeout(r, 2_000));
  const second = await once(target, cfg.placement as string);
  if (second.ok) {
    if (opts.probe) second.destroy();
    return second;
  }

  if (cfg.fallbackScriptUrl) {
    const fb = await viaFallback(opts.probe ? probeHost() : host, cfg.fallbackScriptUrl, cfg.placement as string);
    if (fb.ok && opts.probe) fb.destroy();
    if (fb.ok) return fb;
  }
  return second;
}

/** a 1px, off-screen, unattached-looking host: a real auction, invisible to the user */
function probeHost(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 20_000);
  return el;
}
