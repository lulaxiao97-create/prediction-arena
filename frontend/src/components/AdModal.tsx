"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Play, ShieldAlert, X, Zap } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { useRewards } from "@/components/RewardsProvider";
import { adsConfig, showRewarded } from "@/lib/ads";

/**
 * Rewarded-ad surface.
 *
 * There is no simulated player here any more. When a provider is configured the real SDK is
 * invoked and the reward only lands after its `onReward` callback; when it is not configured the
 * dialog says exactly that and refuses to mint anything. A fake 15-second video with fake brands
 * would have produced real-looking points for zero ad revenue — the one thing this feature must
 * never do.
 *
 * Server-side stays as it was: a receipt is signed before the request, and points are only
 * credited against it, once, after the provider's callback.
 */
export function AdModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { startAd, completeAd, view } = useRewards();
  const [phase, setPhase] = useState<"idle" | "requesting" | "playing" | "credited" | "error">("idle");
  const [awarded, setAwarded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const cfg = adsConfig();
  const left = view?.rates.adsLeftToday ?? 0;

  const run = useCallback(async () => {
    started.current = true;
    setAwarded(0);
    setError(null);
    setPhase("requesting");

    const receipt = await startAd();
    if ("error" in receipt) {
      setError(receipt.error === "daily-cap" ? t("rewards.dailyCap") : t("rewards.unavailable"));
      setPhase("error");
      return;
    }

    setPhase("playing");
    const shown = await showRewarded();
    if (!shown.ok) {
      setError(
        shown.reason === "closed"
          ? t("rewards.adClosed")
          : shown.reason === "sdk-unavailable"
            ? t("rewards.adSdkUnavailable")
            : t("rewards.adProviderError"),
      );
      setPhase("error");
      return;
    }

    const res = await completeAd(receipt.token);
    if (res.ok) {
      setAwarded(res.awarded ?? 0);
      setPhase("credited");
    } else {
      setError(res.error === "too-fast" ? t("rewards.adProviderError") : t("rewards.unavailable"));
      setPhase("error");
    }
  }, [startAd, completeAd, t]);

  useEffect(() => {
    if (!open) {
      setPhase("idle");
      started.current = false;
      return;
    }
    setPhase("idle");
    setAwarded(0);
    setError(null);
    started.current = false;
  }, [open]);

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
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("rewards.watchTitle")}
    >
      <button aria-label={t("rewards.close")} onClick={onClose} className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm" />
      <div className="panel-in relative z-10 w-full max-w-md overflow-hidden rounded-t-3xl border border-white/12 bg-void-elevated/98 shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)] sm:rounded-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <Play className="size-3.5 text-gold" /> {t("rewards.watchTitle")}
            </p>
            {cfg.ready && (
              <p className="mono mt-0.5 text-[9.5px] uppercase tracking-[0.16em] text-muted/70">
                {t("rewards.dailyLeft", { n: left })}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t("rewards.close")}
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 text-muted transition-colors hover:border-white/25 hover:text-ink"
          >
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
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 className="size-8 text-profit" />
              <p className="text-[14px] font-semibold text-ink">{t("rewards.credited", { n: awarded })}</p>
              <div className="mt-1 flex w-full items-center gap-2">
                <button onClick={() => void run()} disabled={left <= 0} className="btn-gold flex-1 py-2 text-[12.5px] disabled:opacity-50">
                  <Zap className="size-3.5" /> {t("rewards.watchAnother")}
                </button>
                <button onClick={onClose} className="btn-ghost flex-1 py-2 text-[12.5px]">
                  {t("rewards.done")}
                </button>
              </div>
            </div>
          ) : phase === "error" ? (
            <div className="flex flex-col gap-2">
              <p className="rounded-lg border border-loss/25 bg-loss/8 px-2.5 py-2 text-[11px] leading-relaxed text-loss">{error}</p>
              <button onClick={() => void run()} className="btn-ghost py-2 text-[12.5px]" disabled={left <= 0}>
                {t("rewards.retry")}
              </button>
            </div>
          ) : phase === "requesting" || phase === "playing" ? (
            <div className="flex flex-col items-center gap-2 py-5 text-center">
              <Loader2 className="size-6 animate-spin text-gold" />
              <p className="text-[12.5px] font-medium text-ink">
                {phase === "requesting" ? t("rewards.adRequesting") : t("rewards.adPlaying")}
              </p>
              <p className="text-[10.5px] leading-relaxed text-muted/70">{t("rewards.adPlayingHint")}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[11.5px] leading-relaxed text-muted">{t("rewards.adIntro")}</p>
              <button onClick={() => void run()} disabled={left <= 0} className="btn-gold py-2.5 text-[13px] disabled:opacity-50">
                <Play className="size-3.5" /> {t("rewards.adStart")}
              </button>
            </div>
          )}

          {left <= 0 && phase !== "requesting" && phase !== "playing" && (
            <p className="rounded-lg border border-gold/25 bg-gold/[0.06] px-2.5 py-2 text-[10.5px] text-gold-bright/90">
              {t("rewards.dailyCap")}
            </p>
          )}

          <p className="text-[9.5px] leading-relaxed text-muted/45">{t("rewards.adFootnote")}</p>
        </div>
      </div>
    </div>
  );
}
