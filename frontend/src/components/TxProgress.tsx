"use client";

import { Check, Link2, Loader2, PenLine, ShieldCheck } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { cn } from "@/lib/format";

/**
 * Three-stage rail for the USDC bet flow: approve allowance → sign `bet()` on Base → confirmed.
 *
 * The rail is driven by `useBet()`'s `step`, which is the only truthful source of progress: a wallet
 * signature that is still pending, a broadcast transaction that has no receipt yet, and a mined one
 * all look the same from here, so the rail never claims a stage the chain has not reached. When the
 * allowance already covers the stake the hook skips `approving` entirely — stage 1 then shows as
 * done immediately instead of flickering an approve that never happened.
 *
 * Labels: `trade.stageApprove` / `trade.stageSign` (→ `trade.stageWait` once broadcast) /
 * `trade.stageConfirmed`. Motion rides on CSS (globals.css → tx-sweep, tx-active-ring) so it keeps
 * working with the reduced-motion escape hatch and costs no bundle.
 */
export function TxProgress({
  step,
  hash,
  className,
}: {
  step: string;
  hash?: string;
  className?: string;
}) {
  const { t } = useI18n();

  const active = step === "approving" ? 0 : step === "betting" || step === "confirming" ? 1 : step === "done" ? 2 : -1;
  if (active < 0) return null;

  const done = step === "done";
  const broadcast = step === "confirming";
  const percent = active === 0 ? 18 : step === "betting" ? 52 : broadcast ? 84 : 100;

  const stages = [
    { key: "approve", label: t("trade.stageApprove"), Icon: ShieldCheck },
    { key: "sign", label: broadcast ? t("trade.stageWait") : t("trade.stageSign"), Icon: PenLine },
    { key: "confirmed", label: t("trade.stageConfirmed"), Icon: Check },
  ];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border p-3 transition-colors duration-500",
        done ? "border-profit/35 bg-profit/[0.06]" : "border-gold/25 bg-gold/[0.04]",
        className,
      )}
      aria-live="polite"
      aria-busy={!done}
    >
      <div className="mb-2.5 h-1 overflow-hidden rounded-full bg-white/8">
        <div
          className={cn(
            "relative h-full overflow-hidden rounded-full transition-[width] duration-700 ease-out",
            done
              ? "bg-gradient-to-r from-profit to-emerald-300"
              : "bg-gradient-to-r from-gold-deep via-gold to-gold-bright",
          )}
          style={{ width: `${percent}%` }}
        >
          {!done && <span className="tx-sweep absolute inset-y-0 -left-1/3 w-1/3 bg-white/50 blur-[2px]" />}
        </div>
      </div>

      <ol className="relative flex flex-col gap-2 pl-7">
        <span aria-hidden className="absolute bottom-1.5 left-[9px] top-1.5 w-px bg-white/10" />
        {stages.map((stage, i) => {
          const state = i < active || done ? "done" : i === active ? "active" : "queued";
          return (
            <li key={stage.key} className="relative flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  "absolute -left-7 grid size-5 place-items-center rounded-full border transition-colors duration-300",
                  state === "done"
                    ? "border-profit/50 bg-profit/15 text-profit"
                    : state === "active"
                      ? cn("border-gold/60 bg-gold/15 text-gold-bright", !done && "tx-active-ring")
                      : "border-white/12 bg-white/[0.02] text-muted/50",
                )}
              >
                {state === "done" ? (
                  <Check className="size-3" />
                ) : state === "active" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <stage.Icon className="size-3" />
                )}
              </span>
              <span
                className={cn(
                  "min-w-0 text-[11.5px] leading-snug transition-colors duration-300",
                  state === "done"
                    ? "text-profit/90"
                    : state === "active"
                      ? "font-medium text-ink"
                      : "text-muted/50",
                )}
              >
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>

      {hash && (
        <p className="mono mt-2 flex items-center gap-1 truncate text-[9.5px] text-muted/60">
          <Link2 className="size-2.5 shrink-0" />
          {hash.slice(0, 10)}…{hash.slice(-6)} · Base
        </p>
      )}
    </div>
  );
}
