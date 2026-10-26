"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Play, RefreshCw, ShieldAlert, X, Zap } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { useRewards } from "@/components/RewardsProvider";
import { adsConfig, mountPlacement } from "@/lib/ads";
import { AD_SECONDS } from "@/lib/rewards";

/**
 * Watch-to-earn surface, wired to HypeLab's real web SDK.
 *
 * Flow: server signs a receipt → the placement is auctioned into this dialog → the element must
 * fire `ready` (a filled creative) → it stays on screen for AD_SECONDS → the receipt is redeemed
 * and points land. Everything else pays nothing.
 *
 * When the auction comes back empty (HTTP 204 — the common case on a young property) the dialog
 * does not dead-end: the user can re-auction on demand, and a silent off-screen probe re-checks
 * demand every 15s up to 3 times. A probe that fills triggers a visible mount without the user
 * touching anything.
 */
const RETRY_EVERY_MS = 15_000;
const MAX_AUTO_RETRIES = 3;

export function AdModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { startAd, completeAd, view } = useRewards();
  const [phase, setPhase] = useState<"intro" | "mounting" | "viewing" | "credited" | "nofill" | "error">("intro");
  const [left, setLeft] = useState(AD_SECONDS);
  const [awarded, setAwarded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [autoLeft, setAutoLeft] = useState<number | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const destroyRef = useRef<(() => void) | null>(null);
  const timers = useRef<number[]>([]);
  const cancelled = useRef(false);
  const probing = useRef(false);

  const cfg = adsConfig();
  const adsLeft = view?.rates.adsLeftToday ?? 0;

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    setAutoLeft(null);
  }, []);

  const cleanup = useCallback(() => {
    cancelled.current = true;
    probing.current = false;
    clearTimers();
    destroyRef.current?.();
    destroyRef.current = null;
    if (hostRef.current) hostRef.current.innerHTML = "";
  }, [clearTimers]);

  const failWith = useCallback((reason: string) => {
    const message =
      reason === "invalid-placement"
        ? t("rewards.adInvalidPlacement", { property: cfg.propertyId ?? "", placement: cfg.placement ?? "" })
        : reason === "sdk-unavailable"
          ? t("rewards.unavailable")
          : reason === "daily-cap"
            ? t("rewards.dailyCap")
            : reason === "provider"
              ? t("rewards.adProviderError")
              : t("rewards.adNoFill");
    setError(message);
    setPhase("error");
  }, [t, cfg.propertyId, cfg.placement]);

  /** put a real placement on screen and, once filled, run the dwell + credit */
  const mount = useCallback(
    async (receiptToken: string) => {
      if (!hostRef.current) {
        failWith("sdk-unavailable");
        return;
      }
      setPhase("mounting");
      const res = await mountPlacement(hostRef.current, { retries: 1 });
      if (!res.ok) {
        if (res.reason === "no-fill" || res.reason === "timeout") {
          setPhase("nofill");
          return;
        }
        failWith(res.reason);
        return;
      }

      destroyRef.current = res.destroy;
      setLeft(AD_SECONDS);
      setPhase("viewing");

      const started = Date.now();
      const tick = window.setInterval(async () => {
        const remain = Math.max(0, AD_SECONDS - Math.floor((Date.now() - started) / 1000));
        setLeft(remain);
        if (remain > 0) return;
        window.clearInterval(tick);
        const credited = await completeAd(receiptToken);
        if (credited.ok) {
          setAwarded(credited.awarded ?? 0);
          setPhase("credited");
        } else {
          failWith("provider");
        }
      }, 500);
    },
    [completeAd, failWith],
  );

  /** one full attempt: receipt → auction → (dwell) */
  const run = useCallback(async () => {
    cleanup();
    cancelled.current = false;
    probing.current = false;
    clearTimers();
    setError(null);
    setAwarded(0);
    setPhase("mounting");

    const receipt = await startAd();
    if ("error" in receipt) {
      failWith(receipt.error === "daily-cap" ? "daily-cap" : "sdk-unavailable");
      return;
    }
    await mount(receipt.token);
  }, [cleanup, clearTimers, startAd, mount, failWith]);

  /**
   * Silent demand check: a real auction, mounted 1px off-screen. A fill means demand is back, so
   * we immediately run the visible flow; empty means we wait another 15s, up to MAX_AUTO_RETRIES.
   * Written as one cancellable loop — a recursive callback would trip the hooks lint rule and is
   * harder to stop cleanly when the dialog closes mid-wait.
   */
  const startProbing = useCallback(
    async (from: number) => {
      if (probing.current) return;
      probing.current = true;
      let attempt = from;
      while (attempt < MAX_AUTO_RETRIES && !cancelled.current) {
        for (let s = Math.round(RETRY_EVERY_MS / 1000); s > 0; s--) {
          if (cancelled.current) return;
          setAutoLeft(s);
          await new Promise((r) => window.setTimeout(r, 1_000));
        }
        if (cancelled.current) return;
        setAutoLeft(null);
        const host = hostRef.current ?? document.createElement("div");
        const probe = await mountPlacement(host, { probe: true });
        if (cancelled.current) return;
        if (probe.ok) {
          probing.current = false;
          await run();
          return;
        }
        attempt += 1;
        setAttempts(attempt);
      }
      probing.current = false;
    },
    [run],
  );

  // kick off the probe chain the first time we land in "no fill"
  useEffect(() => {
    if (phase === "nofill" && attempts < MAX_AUTO_RETRIES && !cancelled.current) {
      void startProbing(attempts);
    }
  }, [phase, attempts, startProbing]);

  useEffect(() => {
    if (!open) {
      cleanup();
      setPhase("intro");
      setError(null);
      setAwarded(0);
      setAttempts(0);
      setAutoLeft(null);
    }
  }, [open, cleanup]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t("rewards.watchTitle")}>
      <button aria-label={t("rewards.close")} onClick={onClose} className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm" />
      <div className="panel-in relative z-10 w-full max-w-md overflow-hidden rounded-t-3xl border border-white/12 bg-void-elevated/98 shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)] sm:rounded-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <Play className="size-3.5 text-gold" /> {t("rewards.watchTitle")}
            </p>
            {cfg.ready && (
              <p className="mono mt-0.5 text-[9.5px] uppercase tracking-[0.16em] text-muted/70">
                {t("rewards.dailyLeft", { n: adsLeft })}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label={t("rewards.close")} className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 text-muted transition-colors hover:border-white/25 hover:text-ink">
            <X className="size-3.5" />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-4">
          {!cfg.ready ? (
            <>
              <div className="flex items-start gap-2 rounded-xl border border-gold/25 bg-gold/[0.06] px-3 py-3">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-gold-bright" />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-gold-bright">{t("rewards.adUnconfiguredTitle")}</p>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-muted">{t("rewards.adUnconfiguredBody")}</p>
                </div>
              </div>
              <p className="mono rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-2 text-[9.5px] leading-relaxed text-muted/70">
                NEXT_PUBLIC_ADS_PROVIDER=hypelab
                <br />
                NEXT_PUBLIC_ADS_SCRIPT_URL=…
                <br />
                NEXT_PUBLIC_HYPELAB_PROPERTY_ID=…
                <br />
                NEXT_PUBLIC_HYPELAB_PLACEMENT_ID=…
              </p>
            </>
          ) : phase === "credited" ? (
            <div className="flex flex-col items-center gap-2 py-3 text-center">
              <CheckCircle2 className="size-8 text-profit" />
              <p className="text-[14px] font-semibold text-ink">{t("rewards.credited", { n: awarded })}</p>
              <div className="mt-1 flex w-full items-center gap-2">
                <button onClick={() => void run()} disabled={adsLeft <= 0} className="btn-gold flex-1 py-2 text-[12.5px] disabled:opacity-50">
                  <Zap className="size-3.5" /> {t("rewards.watchAnother")}
                </button>
                <button onClick={onClose} className="btn-ghost flex-1 py-2 text-[12.5px]">
                  {t("rewards.done")}
                </button>
              </div>
            </div>
          ) : phase === "error" ? (
            <div className="flex flex-col gap-2">
              <p className="rounded-lg border border-loss/25 bg-loss/8 px-2.5 py-2 text-[10.5px] leading-relaxed text-loss">{error}</p>
              <button onClick={() => void run()} disabled={adsLeft <= 0} className="btn-ghost py-2 text-[12.5px]">
                {t("rewards.retry")}
              </button>
            </div>
          ) : phase === "nofill" ? (
            <div className="flex flex-col gap-2.5">
              <p className="rounded-lg border border-gold/25 bg-gold/[0.06] px-2.5 py-2 text-[10.5px] leading-relaxed text-gold-bright/90">
                {t("rewards.adNoFill")}
              </p>
              {autoLeft !== null ? (
                <p className="flex items-center gap-1.5 text-[10.5px] text-muted">
                  <Loader2 className="size-3 animate-spin" />
                  {t("rewards.autoRetryIn", { n: autoLeft, i: attempts + 1, max: MAX_AUTO_RETRIES })}
                </p>
              ) : attempts >= MAX_AUTO_RETRIES ? (
                <p className="text-[10.5px] text-muted/70">{t("rewards.autoRetryDone", { max: MAX_AUTO_RETRIES })}</p>
              ) : null}
              <div className="flex items-center gap-2">
                <button onClick={() => void run()} disabled={adsLeft <= 0} className="btn-gold flex-1 py-2 text-[12.5px] disabled:opacity-50">
                  <RefreshCw className="size-3.5" /> {t("rewards.retryAuction")}
                </button>
                <button onClick={onClose} className="btn-ghost flex-1 py-2 text-[12.5px]">
                  {t("rewards.done")}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* the real placement renders here */}
              <div
                ref={hostRef}
                className="grid min-h-[250px] w-full place-items-center overflow-hidden rounded-xl border border-white/8 bg-[#080d16]"
              >
                {phase === "mounting" && (
                  <span className="flex items-center gap-2 text-[11px] text-muted">
                    <Loader2 className="size-3.5 animate-spin" /> {t("rewards.adRequesting")}
                  </span>
                )}
              </div>

              {phase === "viewing" ? (
                <p className="flex items-center justify-between text-[11px] text-muted">
                  <span>{t("rewards.adPlayingHint")}</span>
                  <span className="mono text-ink">{left}s</span>
                </p>
              ) : (
                phase === "intro" && (
                  <>
                    <p className="text-[11.5px] leading-relaxed text-muted">{t("rewards.adIntro")}</p>
                    <button onClick={() => void run()} disabled={adsLeft <= 0} className="btn-gold py-2.5 text-[13px] disabled:opacity-50">
                      <Play className="size-3.5" /> {t("rewards.adStart")}
                    </button>
                  </>
                )
              )}
            </>
          )}

          {cfg.ready && adsLeft <= 0 && phase !== "viewing" && phase !== "mounting" && (
            <p className="rounded-lg border border-gold/25 bg-gold/[0.06] px-2.5 py-2 text-[10.5px] text-gold-bright/90">{t("rewards.dailyCap")}</p>
          )}

          <p className="text-[9.5px] leading-relaxed text-muted/45">{t("rewards.adFootnote")}</p>
        </div>
      </div>
    </div>
  );
}
