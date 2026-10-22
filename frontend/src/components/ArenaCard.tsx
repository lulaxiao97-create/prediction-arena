"use client";

import { useEffect, useMemo, useState } from "react";
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
  formatDateShort,
  formatProbability,
  formatUsdc,
  impliedMultiplier,
  sideShare,
} from "@/lib/format";
import { categoryLabel } from "@/lib/categories";
import {
  EMERGENCY_REFUND_DELAY_SECONDS,
  hasArena,
  useClaimRefund,
  useClaimRewards,
  useEmergencyRefund,
  usePendingRefund,
  usePendingRewards,
} from "@/hooks/usePredictionArena";

export function ArenaCard({
  pool,
  onBet,
  index = 0,
}: {
  pool: ArenaPool;
  onBet: (pool: ArenaPool, option: 0 | 1) => void;
  index?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const share0 = useMemo(() => sideShare(pool.option0Pool, pool.option1Pool), [pool]);
  const share1 = 1 - share0;
  const multiplier0 = useMemo(() => impliedMultiplier(pool.totalNetPool, pool.option0Pool), [pool]);
  const multiplier1 = useMemo(() => impliedMultiplier(pool.totalNetPool, pool.option1Pool), [pool]);

  const cd = mounted ? countdown(pool.endTime) : null;
  const open = pool.status === 1 && !cd?.ended;
  const ended = pool.status === 1 && Boolean(cd?.ended);

  // ── state machine: claim / refund / protection withdrawal ──────────────────
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
  const canProtectionWithdraw = pool.status === 1 && ended && nowSec >= emergencyAt;
  const daysToProtection = Math.max(0, Math.ceil((emergencyAt - nowSec) / 86_400));

  const refresh = () => queryClient.invalidateQueries();

  async function handleClaim() {
    if (!onChain) return;
    try {
      await claimRewards.claim(pool.id);
      refresh();
    } catch {
      /* surfaced inline */
    }
  }
  async function handleRefund() {
    if (!onChain) return;
    try {
      await claimRefund.refund(pool.id);
      refresh();
    } catch {
      /* surfaced inline */
    }
  }
  async function handleProtection() {
    if (!onChain) return;
    if (!window.confirm("This voids the market and refunds every position at 100% of stake. Continue?"))
      return;
    try {
      await protection.forceCancel(pool.id);
      refresh();
    } catch {
      /* surfaced inline */
    }
  }

  const busy = claimRewards.pending || claimRefund.pending || protection.pending;
  const actionError = claimRewards.error ?? claimRefund.error ?? protection.error;
  const actionHash = claimRewards.hash ?? claimRefund.hash ?? protection.hash;

  const stances = pool.aiStances;

  return (
    <article
      style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
      className="glass glass-hover rise-in group relative flex flex-col gap-3.5 overflow-hidden rounded-2xl p-4 sm:p-[18px]"
    >
      {/* header: category + tags + countdown */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="chip chip-gold">{categoryLabel(pool.category)}</span>
        {(pool.tags ?? []).slice(0, 2).map((tag) => (
          <span key={tag} className="chip border-white/10 text-[10px] text-muted/85">
            {tag}
          </span>
        ))}
        {pool.status === 2 && (
          <span className="chip border-profit/25 bg-profit/8 text-[10px] text-profit">Settled</span>
        )}
        {pool.status === 3 && (
          <span className="chip border-loss/25 bg-loss/8 text-[10px] text-loss">Voided</span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10.5px] text-muted">
          <Clock3 className="size-2.5" />
          <span className="mono tabular-nums">
            {cd ? (cd.ended ? "Ended" : formatCountdown(cd)) : "—"}
          </span>
        </span>
      </div>

      {/* question */}
      <h3 className="line-clamp-2 text-[15.5px] font-semibold leading-snug text-ink">{pool.title}</h3>

      {/* AI debate stances */}
      {stances && (
        <div className="grid grid-cols-2 gap-1.5">
          <div className="rounded-lg border border-profit/15 bg-profit/[0.04] px-2.5 py-2">
            <p className="flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-profit/90">
              <span>◎</span> {stances.yes.agent} · Yes
            </p>
            <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-muted">{stances.yes.take}</p>
          </div>
          <div className="rounded-lg border border-loss/15 bg-loss/[0.04] px-2.5 py-2">
            <p className="flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-loss/90">
              <span>◎</span> {stances.no.agent} · No
            </p>
            <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-muted">{stances.no.take}</p>
          </div>
        </div>
      )}

      {/* implied probability */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="mono text-[13px] font-semibold text-profit">
            Yes {formatProbability(share0)}
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted/60">Implied</span>
          <span className="mono text-[13px] font-semibold text-loss">
            {formatProbability(share1)} No
          </span>
        </div>
        <div className="odds-track flex">
          <div
            className="h-full rounded-l-full bg-gradient-to-r from-profit/70 to-profit shadow-[0_0_18px_rgba(16,185,129,0.3)] transition-[width] duration-700"
            style={{ width: `${Math.max(2, share0 * 100)}%` }}
          />
          <div className="h-full flex-1 rounded-r-full bg-gradient-to-r from-loss to-loss/70 shadow-[0_0_18px_rgba(239,68,68,0.25)] transition-[width] duration-700" />
        </div>
      </div>

      {/* liquidity + participants */}
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted/60">Total Liquidity</span>
          <span className="mono font-semibold text-ink">${formatCompactUsdc(pool.totalNetPool)}</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" />
            {(pool.traders ?? 0).toLocaleString("en-US")}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-3" />
            {formatDateShort(pool.endTime)}
          </span>
        </span>
      </div>

      {/* trade buttons */}
      <div className="mt-auto grid grid-cols-2 gap-2">
        <button
          disabled={!open}
          onClick={() => onBet(pool, 0)}
          className={cn(
            "group/btn flex items-center justify-between rounded-xl border px-3 py-2.5 transition-all",
            open
              ? "border-profit/35 bg-profit/[0.08] hover:border-profit/70 hover:bg-profit/15"
              : "cursor-not-allowed border-white/6 bg-white/[0.02] opacity-50"
          )}
        >
          <span className="flex flex-col items-start leading-none">
            <span className="text-[10px] uppercase tracking-[0.1em] text-muted">Yes</span>
            <span className="mono mt-1 text-[15px] font-semibold text-profit">
              {multiplier0 > 0 ? `${multiplier0.toFixed(2)}x` : "—"}
            </span>
          </span>
          <ArrowUpRight className="size-4 text-profit/70 transition-transform group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5" />
        </button>

        <button
          disabled={!open}
          onClick={() => onBet(pool, 1)}
          className={cn(
            "group/btn flex items-center justify-between rounded-xl border px-3 py-2.5 transition-all",
            open
              ? "border-loss/35 bg-loss/[0.07] hover:border-loss/70 hover:bg-loss/15"
              : "cursor-not-allowed border-white/6 bg-white/[0.02] opacity-50"
          )}
        >
          <span className="flex flex-col items-start leading-none">
            <span className="text-[10px] uppercase tracking-[0.1em] text-muted">No</span>
            <span className="mono mt-1 text-[15px] font-semibold text-loss">
              {multiplier1 > 0 ? `${multiplier1.toFixed(2)}x` : "—"}
            </span>
          </span>
          <ArrowUpRight className="size-4 text-loss/70 transition-transform group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5" />
        </button>
      </div>

      {/* settled summary */}
      {pool.status === 2 && (
        <div className="flex items-center justify-between rounded-lg border border-white/6 bg-white/[0.03] px-2.5 py-1.5 text-[10.5px] text-muted">
          <span>
            Settled · Resolved{" "}
            <span className="text-gold-bright">{pool.optionLabels[pool.winningOption]}</span>
          </span>
          {pool.settlementHash && (
            <span className="mono text-[10px] text-muted/70">
              {pool.settlementHash.slice(0, 8)}…{pool.settlementHash.slice(-6)}
            </span>
          )}
        </div>
      )}

      {/* ── action rows ─────────────────────────────────────────────── */}
      {onChain && pool.status === 2 && (
        <div className="rounded-xl border border-profit/20 bg-profit/[0.05] p-2.5">
          {!address ? (
            <p className="text-[11px] text-muted">Connect a wallet to check and claim your winnings.</p>
          ) : reward > 0n ? (
            <button
              onClick={handleClaim}
              disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-profit/40 bg-profit/12 py-2 text-[12px] font-semibold text-profit transition-colors hover:bg-profit/20 disabled:opacity-60"
            >
              {claimRewards.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Coins className="size-3.5" />}
              Claim Winnings <span className="mono">${formatUsdc(reward)}</span>
            </button>
          ) : (
            <p className="text-[11px] text-muted">No winnings to claim on this market (no winning position, or already claimed).</p>
          )}
        </div>
      )}

      {onChain && pool.status === 3 && (
        <div className="rounded-xl border border-loss/20 bg-loss/[0.05] p-2.5">
          {!address ? (
            <p className="text-[11px] text-muted">Market voided — connect a wallet to reclaim 100% of your stake.</p>
          ) : refundable > 0n ? (
            <button
              onClick={handleRefund}
              disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gold/40 bg-gold/12 py-2 text-[12px] font-semibold text-gold-bright transition-colors hover:bg-gold/20 disabled:opacity-60"
            >
              {claimRefund.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
              Claim Refund <span className="mono">${formatUsdc(refundable)}</span>
            </button>
          ) : (
            <p className="text-[11px] text-muted">No refund available (no position, or already refunded).</p>
          )}
        </div>
      )}

      {onChain && ended && pool.status === 1 && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-2.5">
          {canProtectionWithdraw ? (
            <>
              <p className="mb-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-gold-bright/90">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                Not resolved 30 days after close. Anyone can trigger Protection Withdrawal — every position is refunded at 100%.
              </p>
              <button
                onClick={handleProtection}
                disabled={busy}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gold/40 bg-gold/12 py-2 text-[12px] font-semibold text-gold-bright transition-colors hover:bg-gold/20 disabled:opacity-60"
              >
                {protection.pending ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldAlert className="size-3.5" />}
                Protection Withdrawal
              </button>
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              <Clock3 className="size-3" />
              Awaiting resolution · protection withdrawal unlocks in {daysToProtection}d
            </p>
          )}
        </div>
      )}

      {actionError && (
        <p className="rounded-lg border border-loss/30 bg-loss/10 px-2.5 py-2 text-[11px] text-loss">{actionError}</p>
      )}
      {actionHash && !actionError && (
        <a
          href={explorerTx(actionHash)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-[11px] text-profit hover:underline"
        >
          <CheckCircle2 className="size-3.5" /> Confirmed on-chain — view transaction
        </a>
      )}

      <span className="pointer-events-none absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/25 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
    </article>
  );
}
