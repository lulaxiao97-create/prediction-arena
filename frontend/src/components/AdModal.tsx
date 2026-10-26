"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Play, X, Zap } from "lucide-react";
import { cn } from "@/lib/format";
import { useI18n } from "@/components/LocaleProvider";
import { useRewards } from "@/components/RewardsProvider";

/**
 * Rewarded-ad surface.
 *
 * The shape follows the standard rewarded-video contract: the server hands out a signed receipt
 * when the unit starts, the client shows the creative for `AD_SECONDS`, and only then does the
 * completion call happen. Closing early cancels — no receipt, no points. That is what makes the
 * "+10" trustworthy: the number is never computed on the client.
 *
 * The creative itself is a placeholder: no ad partner is connected yet. It is labelled as such
 * rather than dressing a fake brand up as a sponsor. Swapping in HypeLab (or any rewarded SDK)
 * means calling their `show()` inside the same start/complete envelope — the ledger does not care
 * where the video came from, only that the receipt timeline is real.
 */

const SPOTS = [
  { brand: "LEDGER LABS", line: "Hardware wallets, shipped from Lisbon", tone: "#22D3EE", glyph: "◈" },
  { brand: "DRIFT PROTOCOL", line: "Perpetuals with on-chain funding", tone: "#FBBF24", glyph: "◎" },
  { brand: "NORTHWIND RPC", line: "Base endpoints, 40ms p50", tone: "#34D399", glyph: "⇌" },
];

export function AdModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { startAd, completeAd, view } = useRewards();
  const [phase, setPhase] = useState<"idle" | "playing" | "done" | "error">("idle");
  const [remaining, setRemaining] = useState(0);
  const [awarded, setAwarded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [spot, setSpot] = useState(0);
  const tokenRef = useRef<string | null>(null);
  const finished = useRef(false);

  const seconds = view?.rates.adSeconds ?? 15;
  const totalSteps = 10;

  const begin = useCallback(async () => {
    finished.current = false;
    setAwarded(0);
    setError(null);
    setPhase("idle");
    const res = await startAd();
    if ("error" in res) {
      setError(res.error === "daily-cap" ? t("rewards.dailyCap") : t("rewards.unavailable"));
      setPhase("error");
      return;
    }
    tokenRef.current = res.token;
    setSpot((s) => (s + 1) % SPOTS.length);
    setRemaining(res.seconds);
    setPhase("playing");
  }, [startAd, t]);

  // open → begin; close → reset everything so a reopen never resumes a half-watched ad
  useEffect(() => {
    if (open) void begin();
    else {
      setPhase("idle");
      setRemaining(0);
      tokenRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // one tick per second; completion fires exactly once, off the receipt we were given
  useEffect(() => {
    if (!open || phase !== "playing") return;
    const id = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          window.clearInterval(id);
          if (!finished.current && tokenRef.current) {
            finished.current = true;
            void completeAd(tokenRef.current).then((res) => {
              if (res.ok) {
                setAwarded(res.awarded ?? 0);
                setPhase("done");
              } else {
                setError(res.error === "too-fast" ? t("rewards.tooFast") : t("rewards.unavailable"));
                setPhase("error");
              }
            });
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [open, phase, completeAd, t]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const elapsed = Math.min(seconds, seconds - remaining);
  const steps = Math.floor((elapsed / seconds) * totalSteps);
  const creative = SPOTS[spot % SPOTS.length];
  const left = view?.rates.adsLeftToday ?? 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t("rewards.watchTitle")}>
      <button aria-label={t("rewards.close")} onClick={onClose} className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm" />
      <div className="panel-in relative z-10 w-full max-w-md overflow-hidden rounded-t-3xl border border-white/12 bg-void-elevated/98 shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)] sm:rounded-2xl">
        {/* header */}
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <Play className="size-3.5 text-gold" /> {t("rewards.watchTitle")}
            </p>
            <p className="mono mt-0.5 text-[9.5px] uppercase tracking-[0.16em] text-muted/70">
              {t("rewards.dailyLeft", { n: left })}
            </p>
          </div>
          <button onClick={onClose} aria-label={t("rewards.close")} className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 text-muted transition-colors hover:border-white/25 hover:text-ink">
            <X className="size-3.5" />
          </button>
        </div>

        {/* creative */}
        <div className="relative aspect-video w-full overflow-hidden bg-[#05080f]">
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(120% 110% at 20% 0%, ${creative.tone}55 0%, transparent 62%), linear-gradient(140deg, #0b1220 0%, #05080f 100%)`,
            }}
          />
          <div className="absolute inset-0 opacity-[0.18]" style={{ backgroundImage: "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)", backgroundSize: "42px 42px" }} />
          <div className="relative flex h-full flex-col justify-between p-4">
            <div className="flex items-center justify-between">
              <span className="mono rounded border border-white/15 bg-black/30 px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.18em] text-muted">
                {t("rewards.sponsored")}
              </span>
              <span className="mono rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-[9.5px] text-ink/85">
                {phase === "playing" ? `0:${String(remaining).padStart(2, "0")}` : phase === "done" ? "✓" : "—"}
              </span>
            </div>

            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="mono text-[9px] uppercase tracking-[0.22em]" style={{ color: creative.tone }}>
                  {t("rewards.demoCreative")}
                </p>
                <p className="mt-1 truncate text-[22px] font-black leading-none tracking-tight text-ink">{creative.brand}</p>
                <p className="mt-1 truncate text-[11px] text-muted">{creative.line}</p>
              </div>
              <span className="select-none text-[54px] leading-none" style={{ color: creative.tone, opacity: 0.55 }}>{creative.glyph}</span>
            </div>
          </div>

          {phase === "done" && (
            <div className="absolute inset-0 grid place-items-center bg-void/80 backdrop-blur-[2px]">
              <div className="text-center">
                <CheckCircle2 className="mx-auto size-8 text-profit" />
                <p className="mt-2 text-[15px] font-semibold text-ink">{t("rewards.credited", { n: awarded })}</p>
              </div>
            </div>
          )}
        </div>

        {/* progress + actions */}
        <div className="flex flex-col gap-3 px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-1 items-center gap-1">
              {Array.from({ length: totalSteps }, (_, i) => (
                <span
                  key={i}
                  className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", i < steps ? "bg-gold" : "bg-white/10")}
                />
              ))}
            </div>
            <span className="mono shrink-0 text-[10.5px] text-muted">
              {steps}/{totalSteps}
            </span>
          </div>

          {phase === "error" && <p className="rounded-lg border border-loss/25 bg-loss/8 px-2.5 py-2 text-[11px] text-loss">{error}</p>}

          {phase === "playing" && (
            <p className="text-[10.5px] leading-relaxed text-muted/70">
              {t("rewards.playingHint", { s: remaining })}
            </p>
          )}

          {phase === "done" && (
            <div className="flex items-center gap-2">
              <button onClick={() => void begin()} disabled={left <= 0} className="btn-gold flex-1 py-2 text-[12.5px] disabled:opacity-50">
                <Zap className="size-3.5" /> {t("rewards.watchAnother")}
              </button>
              <button onClick={onClose} className="btn-ghost flex-1 py-2 text-[12.5px]">
                {t("rewards.done")}
              </button>
            </div>
          )}

          {left <= 0 && phase !== "playing" && (
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
