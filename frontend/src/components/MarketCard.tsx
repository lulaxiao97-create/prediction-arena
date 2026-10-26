"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Coins,
  Loader2,
  ShieldAlert,
  Undo2,
  Users,
} from "lucide-react";
import type { ArenaPool } from "@/lib/types";
import {
  cn,
  countdown,
  explorerTx,
  formatCompactUsdc,
  formatCountdown,
  formatProbability,
  formatUsdc,
  impliedMultiplier,
  sideShare,
} from "@/lib/format";
import { categoryI18nKey } from "@/lib/categories";
import { useMounted } from "@/hooks/useMounted";
import { MarketCover } from "@/components/MarketCover";
import { coverOf } from "@/lib/covers";
import { useI18n } from "@/components/LocaleProvider";
import {
  EMERGENCY_REFUND_DELAY_SECONDS,
  hasArena,
  useClaimRefund,
  useClaimRewards,
  useEmergencyRefund,
  usePendingRefund,
  usePendingRewards,
} from "@/hooks/usePredictionArena";

export function MarketCard({
  pool,
  onBet,
  index = 0,
}: {
  pool: ArenaPool;
  onBet: (pool: ArenaPool, option: 0 | 1) => void;
  index?: number;
}) {
  const { t } = useI18n();
  const mounted = useMounted();

  const share0 = useMemo(() => sideShare(pool.option0Pool, pool.option1Pool), [pool]);
  const share1 = 1 - share0;
  const multiplier0 = useMemo(() => impliedMultiplier(pool.totalNetPool, pool.option0Pool), [pool]);
  const multiplier1 = useMemo(() => impliedMultiplier(pool.totalNetPool, pool.option1Pool), [pool]);

  const cd = mounted ? countdown(pool.endTime) : null;
  const open = pool.status === 1 && !cd?.ended;
  const ended = pool.status === 1 && Boolean(cd?.ended);

  const { address } = useAccount();
  const queryClient = useQueryClient();
  const onChain = hasArena && pool.source === "chain";
  const { data: rewardData } = usePendingRewards(pool.id, onChain ? address : undefined);
  const { data: refundData } = usePendingRefund(pool.id, onChain ? address : undefined);
  const claimRewards = useClaimRewards();
  const claimRefund = useClaimRefund();
  const protection = useEmergencyRefund();

  const reward = (rewardData as bigint | undefined) ?? 0n;
  const refundable = (refundData as bigint | undefined) ?? 0n;
  const emergencyAt = pool.endTime + EMERGENCY_REFUND_DELAY_SECONDS;
  const nowSec = mounted ? Math.floor(Date.now() / 1000) : 0;
  const canProtection = pool.status === 1 && ended && nowSec >= emergencyAt;
  const daysToProtection = Math.max(0, Math.ceil((emergencyAt - nowSec) / 86_400));

  const refresh = () => queryClient.invalidateQueries();
  const busy = claimRewards.pending || claimRefund.pending || protection.pending;
  const actionError = claimRewards.error ?? claimRefund.error ?? protection.error;
  const actionHash = claimRewards.hash ?? claimRefund.hash ?? protection.hash;
  const href = `/market/${pool.id.toString()}`;

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      refresh();
    } catch {
      /* surfaced inline */
    }
  }

  const cover = coverOf(pool);

  return (
    <article
      style={{ animationDelay: `${Math.min(index * 0.04, 0.2)}s` }}
      className="glass glass-hover card-edge rise-in group relative flex flex-col overflow-hidden rounded-2xl"
    >
      {/* Subject band: the photograph + motif + the entity this market is actually about.
          It replaces the old full-card wash, which read as "every card is the same grey tile". */}
      <div className="relative h-[112px] w-full shrink-0 overflow-hidden border-b border-white/[0.07]">
        <MarketCover spec={cover} variant="card" />
        {cover.metric && (
          <span className="mono absolute right-2.5 top-2.5 rounded-md border border-white/12 bg-void/60 px-1.5 py-0.5 text-[10px] text-ink/90 backdrop-blur-sm">
            {cover.metric}
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <p className="mono truncate text-[8.5px] uppercase tracking-[0.22em]" style={{ color: cover.accent }}>
            {cover.kicker}
          </p>
          <p className="mt-0.5 truncate text-[14px] font-bold leading-none tracking-tight text-ink">
            {cover.entity}
          </p>
        </div>
      </div>

      <div className="relative flex flex-1 flex-col gap-3 p-4">
      {/* clickable surface → detail page */}
      <Link href={href} className="absolute inset-0 z-0" aria-label={t("card.view")} />

      {/* header */}
      <div className="pointer-events-none relative z-10 flex flex-wrap items-center gap-1.5">
        <span className="chip chip-gold">{t(categoryI18nKey(pool.category))}</span>
        {(pool.tags ?? []).slice(0, 1).map((tag) => (
          <span key={tag} className="chip border-white/10 text-[10px] text-muted/85">
            {tag}
          </span>
        ))}
        {pool.status === 2 && (
          <span className="chip border-profit/25 bg-profit/8 text-[10px] text-profit">{t("card.settled")}</span>
        )}
        {pool.status === 3 && (
          <span className="chip border-loss/25 bg-loss/8 text-[10px] text-loss">{t("card.voided")}</span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10px] text-muted">
          <Clock3 className="size-2.5" />
          <span className="mono tabular-nums">{cd ? (cd.ended ? "Ended" : formatCountdown(cd)) : "—"}</span>
        </span>
      </div>

      {/* question */}
      <h3 className="pointer-events-none relative z-10 line-clamp-2 text-[15px] font-semibold leading-snug text-ink transition-colors group-hover:text-gold-bright/95">
        {pool.title}
      </h3>

      {/* probability */}
      <div className="pointer-events-none relative z-10 space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="mono text-[13px] font-semibold text-profit">
            {t("card.yes")} {formatProbability(share0)}
          </span>
          <span className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.14em] text-muted/55">
            {t("card.implied")}
            {/* Payout on the cheap side — the number the "Highest Yield" sort orders by. */}
            {share0 > 0 && share0 < 1 && (
              <span className="mono rounded border border-gold/25 bg-gold/8 px-1 py-0.5 text-[9px] normal-case tracking-normal text-gold-bright">
                {`${(1 / Math.min(share0, 1 - share0)).toFixed(1)}×`}
              </span>
            )}
          </span>
          <span className="mono text-[13px] font-semibold text-loss">
            {formatProbability(share1)} {t("card.no")}
          </span>
        </div>
        <div className="odds-track flex">
          <div
            className="h-full rounded-l-full bg-gradient-to-r from-profit/70 to-profit transition-[width] duration-700"
            style={{ width: `${Math.max(2, share0 * 100)}%` }}
          />
          <div className="h-full flex-1 rounded-r-full bg-gradient-to-r from-loss to-loss/70" />
        </div>
      </div>

      {/* AI stances — one compact line per side */}
      {pool.aiStances && (
        <div className="pointer-events-none relative z-10 grid grid-cols-2 gap-1.5">
          <div className="rounded-lg border border-profit/12 bg-profit/[0.03] px-2 py-1.5">
            <p className="truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-profit/85">
              ◎ {pool.aiStances.yes.agent}
            </p>
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted/90">{pool.aiStances.yes.take}</p>
          </div>
          <div className="rounded-lg border border-loss/12 bg-loss/[0.03] px-2 py-1.5">
            <p className="truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-loss/85">
              ◎ {pool.aiStances.no.agent}
            </p>
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted/90">{pool.aiStances.no.take}</p>
          </div>
        </div>
      )}

      {/* stats line */}
      <div className="pointer-events-none relative z-10 flex items-center justify-between text-[10.5px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="text-[9px] uppercase tracking-[0.1em] text-muted/55">{t("card.liquidity")}</span>
          <span className="mono font-semibold text-ink">${formatCompactUsdc(pool.totalNetPool)}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="size-2.5" />
          {(pool.traders ?? 0).toLocaleString("en-US")}
        </span>
      </div>

      {/* quick trade buttons */}
      <div className="relative z-10 mt-auto grid grid-cols-2 gap-2">
        <button
          disabled={!open}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onBet(pool, 0);
          }}
          className={cn(
            "group/btn flex items-center justify-between rounded-xl border px-2.5 py-2 transition-all",
            open
              ? "border-profit/35 bg-profit/[0.08] hover:border-profit/70 hover:bg-profit/15"
              : "cursor-not-allowed border-white/6 bg-white/[0.02] opacity-45"
          )}
        >
          <span className="flex flex-col items-start leading-none">
            <span className="text-[9.5px] uppercase tracking-[0.08em] text-muted">{t("card.yes")}</span>
            <span className="mono mt-0.5 text-[14px] font-semibold text-profit">
              {multiplier0 > 0 ? `${multiplier0.toFixed(2)}x` : "—"}
            </span>
          </span>
          <ArrowUpRight className="size-3.5 text-profit/70 transition-transform group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5" />
        </button>
        <button
          disabled={!open}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onBet(pool, 1);
          }}
          className={cn(
            "group/btn flex items-center justify-between rounded-xl border px-2.5 py-2 transition-all",
            open
              ? "border-loss/35 bg-loss/[0.07] hover:border-loss/70 hover:bg-loss/15"
              : "cursor-not-allowed border-white/6 bg-white/[0.02] opacity-45"
          )}
        >
          <span className="flex flex-col items-start leading-none">
            <span className="text-[9.5px] uppercase tracking-[0.08em] text-muted">{t("card.no")}</span>
            <span className="mono mt-0.5 text-[14px] font-semibold text-loss">
              {multiplier1 > 0 ? `${multiplier1.toFixed(2)}x` : "—"}
            </span>
          </span>
          <ArrowUpRight className="size-3.5 text-loss/70 transition-transform group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5" />
        </button>
      </div>

      {/* chain-only state actions */}
      {onChain && (
        <div className="relative z-10 space-y-2">
          {pool.status === 2 && (
            <div className="rounded-lg border border-profit/20 bg-profit/[0.05] p-2">
              {!address ? (
                <p className="text-[10.5px] text-muted">{t("state.connectToSee")}</p>
              ) : reward > 0n ? (
                <button
                  onClick={() => run(() => claimRewards.claim(pool.id))}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-profit/40 bg-profit/12 py-1.5 text-[11px] font-semibold text-profit hover:bg-profit/20 disabled:opacity-60"
                >
                  {claimRewards.pending ? <Loader2 className="size-3 animate-spin" /> : <Coins className="size-3" />}
                  {t("state.claimWinnings")} <span className="mono">${formatUsdc(reward)}</span>
                </button>
              ) : (
                <p className="text-[10.5px] text-muted">{t("state.noWinnings")}</p>
              )}
            </div>
          )}

          {pool.status === 3 && (
            <div className="rounded-lg border border-loss/20 bg-loss/[0.05] p-2">
              {!address ? (
                <p className="text-[10.5px] text-muted">{t("state.claimHint")}</p>
              ) : refundable > 0n ? (
                <button
                  onClick={() => run(() => claimRefund.refund(pool.id))}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gold/40 bg-gold/12 py-1.5 text-[11px] font-semibold text-gold-bright hover:bg-gold/20 disabled:opacity-60"
                >
                  {claimRefund.pending ? <Loader2 className="size-3 animate-spin" /> : <Undo2 className="size-3" />}
                  {t("state.claimRefund")} <span className="mono">${formatUsdc(refundable)}</span>
                </button>
              ) : (
                <p className="text-[10.5px] text-muted">{t("state.noRefund")}</p>
              )}
            </div>
          )}

          {ended && pool.status === 1 && (
            <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
              {canProtection ? (
                <button
                  onClick={() => run(() => protection.forceCancel(pool.id))}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gold/40 bg-gold/12 py-1.5 text-[11px] font-semibold text-gold-bright hover:bg-gold/20 disabled:opacity-60"
                >
                  {protection.pending ? <Loader2 className="size-3 animate-spin" /> : <ShieldAlert className="size-3" />}
                  {t("state.protection")}
                </button>
              ) : (
                <p className="text-[10.5px] text-muted">{t("state.awaiting", { days: daysToProtection })}</p>
              )}
            </div>
          )}

          {actionError && (
            <p className="rounded-md border border-loss/30 bg-loss/10 px-2 py-1.5 text-[10.5px] text-loss">{actionError}</p>
          )}
          {actionHash && !actionError && (
            <a
              href={explorerTx(actionHash)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-[10.5px] text-profit hover:underline"
            >
              <CheckCircle2 className="size-3" /> {t("state.confirmed")}
            </a>
          )}
        </div>
      )}
      </div>
    </article>
  );
}
