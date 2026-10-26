"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Play, ShieldAlert, X, Zap } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { useRewards } from "@/components/RewardsProvider";
import { adsConfig, mountPlacement } from "@/lib/ads";
import { AD_SECONDS } from "@/lib/rewards";

/**
 * Watch-to-earn surface, wired to HypeLab's real web SDK.
 *
 * Flow: server signs a receipt → the sponsored placement is auctioned into this dialog → the
 * element only counts once HypeLab fires `ready` (a filled creative) → it stays on screen for
 * AD_SECONDS → the receipt is redeemed and points land. Any other path pays nothing:
 * a refused auction shows the provider's own error, closing early cancels, and a build without
 * credentials says so instead of playing a stand-in.
 */
export function AdModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { startAd, completeAd, view } = useRewards();
  const [phase, setPhase] = useState<"intro" | "mounting" | "viewing" | "credited" | "error">("intro");
  const [left, setLeft] = useState(AD_SECONDS);
  const [awarded, setAwarded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const destroyRef = useRef<(() => void) | null>(null);

  const cfg = adsConfig();
  const adsLeft = view?.rates.adsLeftToday ?? 0;

  const cleanup = useCallback(() => {
    destroyRef.current?.();
    destroyRef.current = null;
    if (hostRef.current) hostRef.current.innerHTML = "";
  }, []);

  const run = useCallback(async () => {
    cleanup();
    setAwarded(0);
    setError(null);
    setPhase("mounting");

    const receipt = await startAd();
    if ("error" in receipt) {
      setError(receipt.error === "daily-cap" ? t("rewards.dailyCap") : t("rewards.unavailable"));
      setPhase("error");
      return;
    }
    if (!hostRef.current) {
      setError(t("rewards.unavailable"));
      setPhase("error");
      return;
    }

    const mount = await mountPlacement(hostRef.current);
    if (!mount.ok) {
      setError(mount.reason === "timeout" ? t("rewards.adTimeout") : mount.reason === "not-configured" ? t("rewards.adUnconfiguredBody") : mount.reason);
      setPhase("error");
      return;
    }
    destroyRef.current = mount.destroy;
    setLeft(AD_SECONDS);
    setPhase("viewing");

    // dwell: the creative has to stay on screen before the receipt can be redeemed
    const started = Date.now();
    const tick = window.setInterval(async () => {
      const remain = Math.max(0, AD_SECONDS - Math.floor((Date.now() - started) / 1000));
      setLeft(remain);
      if (remain > 0) return;
      window.clearInterval(tick);
      const res = await completeAd(receipt.token);
      if (res.ok) {
        setAwarded(res.awarded ?? 0);
        setPhase("credited");
      } else {
        setError(t("rewards.adProviderError"));
        setPhase("error");
      }
    }, 500);
  }, [cleanup, startAd, completeAd, t]);

  useEffect(() => {
    if (!open) {
      cleanup();
      setPhase("intro");
      setError(null);
      setAwarded(0);
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
