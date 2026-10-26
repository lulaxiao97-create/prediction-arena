/**
 * Rewarded-ad adapter.
 *
 * The rule this file exists to enforce: **no ad, no points**. There is no simulated player and no
 * placeholder creative behind it — if a real provider is not configured, `showRewarded()` refuses
 * and the UI says so, because minting points for a video that never played is exactly the kind of
 * theatre this product cannot ship.
 *
 * Two integration paths, both real:
 *   1. HypeLab — their web SDK exposes a rewarded unit in the page after the publisher's script
 *      tag loads. We load that tag from `NEXT_PUBLIC_ADS_SCRIPT_URL` and call
 *      `window.HypeLab.showRewarded({ placement, onReward, … })`.
 *   2. Any other network — it can install `window.__paRewarded.show({ onReward, onError })`, the
 *      same envelope, without us shipping their code.
 *
 * Credentials are publisher-specific (property + placement + script URL from the HypeLab
 * dashboard), so they arrive as build-time env vars. Without them the unit is disabled, visibly.
 */

export type AdsConfig = {
  provider: string | null;
  propertyId: string | null;
  placement: string | null;
  scriptUrl: string | null;
  /** true only when everything needed to actually show an ad is present */
  ready: boolean;
};

type RewardedBridge = {
  showRewarded?: (opts: {
    placement?: string;
    propertyId?: string;
    onReward?: () => void;
    onClose?: () => void;
    onError?: (err?: unknown) => void;
  }) => void | Promise<void>;
};

declare global {
  interface Window {
    HypeLab?: RewardedBridge;
    __paRewarded?: { show: (opts: { onReward: () => void; onError: (e?: unknown) => void }) => void | Promise<void> };
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
    ready: Boolean(provider && placement && scriptUrl),
  };
}

let loading: Promise<boolean> | null = null;

/** Inject the publisher script once; resolves false when there is nothing to inject. */
export function loadAdsSdk(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  const cfg = adsConfig();
  if (!cfg.ready || !cfg.scriptUrl) return Promise.resolve(false);
  if (window.HypeLab || window.__paRewarded) return Promise.resolve(true);
  if (loading) return loading;

  loading = new Promise<boolean>((resolve) => {
    const el = document.createElement("script");
    el.src = cfg.scriptUrl as string;
    el.async = true;
    el.dataset.paAds = "1";
    const done = (ok: boolean) => resolve(ok && Boolean(window.HypeLab ?? window.__paRewarded));
    el.onload = () => done(true);
    el.onerror = () => done(false);
    document.head.appendChild(el);
    // a provider that never calls back must not hang the button forever
    window.setTimeout(() => done(Boolean(window.HypeLab ?? window.__paRewarded)), 8000);
  });
  return loading;
}

/**
 * Show a rewarded unit and resolve only when the provider fires its reward callback.
 * `ok:false` means no reward — the caller must not credit anything.
 */
export async function showRewarded(): Promise<{ ok: boolean; reason?: string }> {
  const cfg = adsConfig();
  if (!cfg.ready) return { ok: false, reason: "not-configured" };
  const loaded = await loadAdsSdk();
  if (!loaded) return { ok: false, reason: "sdk-unavailable" };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean, reason?: string) => {
      if (settled) return;
      settled = true;
      resolve({ ok, reason });
    };

    try {
      if (window.HypeLab?.showRewarded) {
        void window.HypeLab.showRewarded({
          placement: cfg.placement ?? undefined,
          propertyId: cfg.propertyId ?? undefined,
          onReward: () => finish(true),
          onClose: () => finish(false, "closed"),
          onError: () => finish(false, "provider-error"),
        });
        return;
      }
      if (window.__paRewarded?.show) {
        void window.__paRewarded.show({
          onReward: () => finish(true),
          onError: () => finish(false, "provider-error"),
        });
        return;
      }
      finish(false, "sdk-unavailable");
    } catch {
      finish(false, "provider-error");
    }
  });
}
