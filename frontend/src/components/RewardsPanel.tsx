"use client";

import Link from "next/link";
import { Banknote, Loader2, Play, Ticket, Trophy } from "lucide-react";
import { cn } from "@/lib/format";
import { useI18n } from "@/components/LocaleProvider";
import { useRewards } from "@/components/RewardsProvider";
import { adsConfig } from "@/lib/ads";
import { POINTS_PER_TICKET, usd } from "@/lib/rewards";

/**
 * The rewards half of the asset panel.
 *
 * Three numbers, in the order a user asks for them: how many points, how many tickets, what the
 * tickets are worth. The ticket book is deliberately separated from the USDC book — a ticket is a
 * virtual $1 position tracked in this ledger, it never touches the arena contract, and the panel
 * says so rather than letting the two blur together.
 */
export function RewardsPanel({ onOpenAd }: { onOpenAd?: () => void }) {
  const { t } = useI18n();
  const { view, loading, redeem, requestCashout, openAd } = useRewards();

  const goAd = onOpenAd ?? openAd;

  if (loading && !view) {
    return (
      <div className="glass flex items-center gap-2 rounded-2xl p-3 text-[11px] text-muted">
        <Loader2 className="size-3.5 animate-spin" /> {t("rewards.loading")}
      </div>
    );
  }
  if (!view) return null;

  const toNext = view.points % POINTS_PER_TICKET;
  const canRedeem = view.points >= POINTS_PER_TICKET;
  const profitUsd = view.settledProfitCents / 100;
  const openUsd = view.openValueCents / 100;
  const progress = (toNext / POINTS_PER_TICKET) * 100;

  return (
    <div className="glass flex flex-col gap-3 rounded-2xl border-white/10 p-3.5">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
          <Trophy className="size-3.5 text-gold" /> {t("rewards.title")}
        </p>
        <span className="mono text-[9px] uppercase tracking-[0.14em] text-muted/55">{t("rewards.demoTag")}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label={t("rewards.points")} value={String(view.points)} tone="text-gold-bright" />
        <Stat label={t("rewards.tickets")} value={String(view.tickets)} tone="text-cyan-bright" />
        <Stat
          label={t("rewards.profit")}
          value={usd(view.settledProfitCents)}
          tone={view.settledProfitCents > 0 ? "text-profit" : "text-ink"}
        />
      </div>

      {/* progress to the next ticket */}
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
          <div className="h-full rounded-full bg-gradient-to-r from-cyan to-gold transition-[width] duration-500" style={{ width: `${progress}%` }} />
        </div>
        <span className="mono shrink-0 text-[9.5px] text-muted/70">
          {toNext}/{POINTS_PER_TICKET}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={goAd} className="btn-gold flex-1 py-1.5 text-[11.5px]">
          <Play className="size-3" /> {adsConfig().ready ? t("rewards.watch") : t("rewards.unconfiguredShort")}
        </button>
        <button
          onClick={() => void redeem(1)}
          disabled={!canRedeem}
          className={cn("flex-1 rounded-xl border px-2 py-1.5 text-[11.5px] font-medium transition-colors", canRedeem
            ? "border-cyan/40 bg-cyan/10 text-cyan-bright hover:bg-cyan/20"
            : "cursor-not-allowed border-white/8 bg-white/[0.02] text-muted/45")}
        >
          <Ticket className="mr-1 inline size-3" /> {t("rewards.redeem")}
        </button>
      </div>

      {openUsd > 0 && (
        <p className="rounded-lg border border-white/8 bg-white/[0.02] px-2 py-1.5 text-[10px] leading-relaxed text-muted/80">
          {t("rewards.openValue", { amount: usd(view.openValueCents) })}
        </p>
      )}

      {/* ticket positions */}
      {view.stakes.length > 0 ? (
        <ul className="flex flex-col divide-y divide-white/[0.05] rounded-lg border border-white/6 bg-white/[0.015]">
          {view.stakes.slice(0, 4).map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-2 py-1.5">
              <span
                className={cn(
                  "mono rounded border px-1 py-0.5 text-[8.5px] uppercase",
                  s.option === 0 ? "border-profit/30 bg-profit/10 text-profit" : "border-loss/30 bg-loss/10 text-loss",
                )}
              >
                {s.option === 0 ? t("card.yes") : t("card.no")}
              </span>
              <Link href={`/market/${s.poolId}`} className="min-w-0 flex-1 truncate text-[10.5px] text-ink/85 hover:text-gold-bright">
                {s.title}
              </Link>
              <span className={cn("mono shrink-0 text-[10px]", s.state === "won" ? "text-profit" : s.state === "lost" ? "text-loss/70" : "text-muted")}>
                {s.state === "open" ? usd(s.markCents) : s.state === "won" ? `+${usd(s.markCents - s.cents)}` : `-${usd(s.cents)}`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[10.5px] leading-relaxed text-muted/60">{t("rewards.noStakes")}</p>
      )}

      {/* cashout gate */}
      <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-2">
        <Banknote className={cn("size-3.5 shrink-0", view.canWithdraw ? "text-profit" : "text-muted/45")} />
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] text-ink/85">
            {view.cashout
              ? t("rewards.cashoutQueued", { amount: usd(view.cashout.cents) })
              : view.canWithdraw
                ? t("rewards.cashoutReady", { amount: usd(view.settledProfitCents) })
                : t("rewards.cashoutLocked", { amount: usd(view.withdrawMinCents) })}
          </p>
          {!view.cashout && !view.canWithdraw && (
            <p className="mt-0.5 text-[9.5px] leading-relaxed text-muted/55">{t("rewards.cashoutHint")}</p>
          )}
        </div>
        <button
          onClick={() => void requestCashout()}
          disabled={!view.canWithdraw}
          className={cn(
            "shrink-0 rounded-lg border px-2 py-1 text-[10.5px] transition-colors",
            view.canWithdraw
              ? "border-profit/40 bg-profit/12 text-profit hover:bg-profit/20"
              : "cursor-not-allowed border-white/8 text-muted/35",
          )}
        >
          {view.cashout ? t("rewards.queued") : t("rewards.cashoutBtn")}
        </button>
      </div>

      <p className="text-[9px] leading-relaxed text-muted/40">{t("rewards.ledgerNote")}</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/6 bg-white/[0.025] px-2 py-1.5">
      <p className="truncate text-[8.5px] uppercase tracking-[0.1em] text-muted/60">{label}</p>
      <p className={cn("mono mt-0.5 truncate text-[15px] font-semibold", tone)}>{value}</p>
    </div>
  );
}
