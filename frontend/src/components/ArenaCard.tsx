"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Coins,
  Droplets,
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
  formatCountdown,
  formatEndDate,
  formatUsdc,
  impliedMultiplier,
  sideShare,
  toUsdcNumber,
} from "@/lib/format";
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

  const minorityShare = Math.min(share0, share1);
  const dominantIsYes = share0 > share1;
  const dominantLabel = dominantIsYes ? pool.optionLabels[0] : pool.optionLabels[1];
  const reverseLabel = dominantIsYes ? pool.optionLabels[1] : pool.optionLabels[0];
  const reverseMultiplier = dominantIsYes ? multiplier1 : multiplier0;
  // "严重倾斜" = the losing side holds under 30% of the pool; 60/40 is normal market noise.
  const showSkewBanner = pool.status === 1 && pool.totalNetPool > 0n && minorityShare < 0.3;

  const cd = mounted ? countdown(pool.endTime) : null;
  const open = pool.status === 1 && !cd?.ended;
  const ended = pool.status === 1 && Boolean(cd?.ended);

  // ── state machine: claim / refund / force-cancel ───────────────────────────
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const onChain = hasArena && pool.source === "chain";
  const { data: rewardData } = usePendingRewards(pool.id, onChain ? address : undefined);
  const { data: refundData } = usePendingRefund(pool.id, onChain ? address : undefined);
  const claimRewards = useClaimRewards();
  const claimRefund = useClaimRefund();
  const forceRefund = useEmergencyRefund();

  const reward = (rewardData as bigint | undefined) ?? 0n;
  const refundable = (refundData as bigint | undefined) ?? 0n;
  const emergencyAt = pool.endTime + EMERGENCY_REFUND_DELAY_SECONDS;
  const nowSec = mounted ? Math.floor(Date.now() / 1000) : 0;
  const canForceVoid = pool.status === 1 && ended && nowSec >= emergencyAt;
  const daysToForce = Math.max(0, Math.ceil((emergencyAt - nowSec) / 86_400));

  function refresh() {
    queryClient.invalidateQueries();
  }

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
  async function handleForceVoid() {
    if (!onChain) return;
    if (!window.confirm("强制取消后本盘作废，所有下注按本金 100% 退回。确认执行？")) return;
    try {
      await forceRefund.forceCancel(pool.id);
      refresh();
    } catch {
      /* surfaced inline */
    }
  }

  const busy = claimRewards.pending || claimRefund.pending || forceRefund.pending;
  const actionError = claimRewards.error ?? claimRefund.error ?? forceRefund.error;
  const actionHash = claimRewards.hash ?? claimRefund.hash ?? forceRefund.hash;

  return (
    <article
      style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
      className="glass glass-hover rise-in group relative flex flex-col gap-4 overflow-hidden rounded-2xl p-4 sm:p-5"
    >
      <div className="pointer-events-none absolute -right-16 -top-20 size-44 rounded-full bg-gold/10 blur-3xl transition-opacity duration-500 group-hover:opacity-80" />

      {/* header */}
      <div className="flex items-center gap-2">
        <span className="chip chip-gold">{pool.category}</span>
        {pool.source === "demo" && (
          <span className="chip border-white/10 text-[10px] text-muted/80">DEMO</span>
        )}
        {pool.status === 2 && (
          <span className="chip border-profit/25 bg-profit/8 text-[10px] text-profit">已结算</span>
        )}
        {pool.status === 3 && (
          <span className="chip border-loss/25 bg-loss/8 text-[10px] text-loss">已取消</span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted">
          <Clock3 className="size-3" />
          <span className="mono tabular-nums">
            {cd ? (cd.ended ? "已关盘" : formatCountdown(cd)) : "—"}
          </span>
        </span>
      </div>

      {/* question */}
      <h3 className="line-clamp-2 text-[15px] font-semibold leading-relaxed text-ink sm:text-base">
        {pool.title}
      </h3>

      {/* money */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-muted">总彩池 · USDC</p>
          <p className="mono mt-0.5 text-2xl font-semibold text-ink">
            ${formatUsdc(pool.totalNetPool)}
          </p>
        </div>
        <div className="flex items-center gap-3 pb-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" />
            {(pool.traders ?? 0).toLocaleString()} 人
          </span>
          <span className="inline-flex items-center gap-1">
            <Droplets className="size-3" />
            {formatEndDate(pool.endTime)} 截止
          </span>
        </div>
      </div>

      {/* odds bar */}
      <div className="space-y-2">
        <div className="odds-track flex">
          <div
            className="h-full rounded-l-full bg-gradient-to-r from-profit/80 to-profit shadow-[0_0_18px_rgba(16,185,129,0.35)] transition-[width] duration-700"
            style={{ width: `${Math.max(2, share0 * 100)}%` }}
          />
          <div
            className="h-full flex-1 rounded-r-full bg-gradient-to-r from-loss to-loss/80 shadow-[0_0_18px_rgba(239,68,68,0.3)] transition-[width] duration-700"
          />
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-profit">
            {pool.optionLabels[0]} {(share0 * 100).toFixed(0)}%
          </span>
          <span className="text-muted">{(Math.abs(share0 - 0.5) * 200).toFixed(1)} 偏差</span>
          <span className="text-loss">
            {(share1 * 100).toFixed(0)}% {pool.optionLabels[1]}
          </span>
        </div>
      </div>

      {/* squeeze banner */}
      {showSkewBanner && (
        <div className="relative overflow-hidden rounded-xl border border-gold/35 bg-gradient-to-r from-gold/14 via-gold/8 to-transparent px-3 py-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-gold-bright" />
            <p className="text-[11.5px] leading-relaxed text-gold-bright/95">
              ⚠️ <span className="font-semibold">{dominantLabel}</span> 侧挤压严重，反向押注
              <span className="font-semibold"> {reverseLabel} </span>
              享 <span className="mono font-bold text-gold-bright">{reverseMultiplier.toFixed(2)}x</span> 暴利！
            </p>
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-gold/10 to-transparent" />
        </div>
      )}

      {/* bet actions */}
      <div className="mt-auto grid grid-cols-2 gap-2">
        <button
          disabled={!open}
          onClick={() => onBet(pool, 0)}
          className={cn(
            "group/btn flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-all",
            open
              ? "border-profit/30 bg-profit/[0.07] hover:border-profit/60 hover:bg-profit/12"
              : "cursor-not-allowed border-white/6 bg-white/[0.02] opacity-50"
          )}
        >
          <span className="text-[11px] text-muted">{pool.optionLabels[0]}</span>
          <span className="flex w-full items-center justify-between">
            <span className="mono text-sm font-semibold text-profit">
              {multiplier0 ? `${multiplier0.toFixed(2)}x` : "—"}
            </span>
            <ArrowUpRight className="size-3.5 text-profit/70 transition-transform group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5" />
          </span>
        </button>

        <button
          disabled={!open}
          onClick={() => onBet(pool, 1)}
          className={cn(
            "group/btn flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-all",
            open
              ? "border-loss/30 bg-loss/[0.06] hover:border-loss/60 hover:bg-loss/12"
              : "cursor-not-allowed border-white/6 bg-white/[0.02] opacity-50"
          )}
        >
          <span className="text-[11px] text-muted">{pool.optionLabels[1]}</span>
          <span className="flex w-full items-center justify-between">
            <span className="mono text-sm font-semibold text-loss">
              {multiplier1 ? `${multiplier1.toFixed(2)}x` : "—"}
            </span>
            <ArrowUpRight className="size-3.5 text-loss/70 transition-transform group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5" />
          </span>
        </button>
      </div>

      {/* settled footer */}
      {pool.status === 2 && (
        <div className="flex items-center justify-between rounded-lg border border-white/6 bg-white/[0.03] px-2.5 py-1.5 text-[10.5px] text-muted">
          <span>
            已结算 · 胜出 <span className="text-gold-bright">{pool.optionLabels[pool.winningOption]}</span>
          </span>
          {pool.settlementHash && (
            <span className="mono text-[10px] text-muted/70">
              {pool.settlementHash.slice(0, 8)}…{pool.settlementHash.slice(-6)}
            </span>
          )}
        </div>
      )}

      {/* ── state-machine action row ─────────────────────────────────────── */}
      {onChain && pool.status === 2 && (
        <div className="rounded-xl border border-profit/20 bg-profit/[0.05] p-2.5">
          {!address ? (
            <p className="text-[11px] text-muted">连接钱包后可查看并领取你的奖励。</p>
          ) : reward > 0n ? (
            <button
              onClick={handleClaim}
              disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-profit/40 bg-profit/12 py-2 text-[12px] font-semibold text-profit transition-colors hover:bg-profit/20 disabled:opacity-60"
            >
              {claimRewards.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Coins className="size-3.5" />}
              领取奖励 <span className="mono">{formatUsdc(reward)}</span> USDC
            </button>
          ) : (
            <p className="text-[11px] text-muted">本盘你没有待领奖励（未中奖或已领取）。</p>
          )}
        </div>
      )}

      {onChain && pool.status === 3 && (
        <div className="rounded-xl border border-loss/20 bg-loss/[0.05] p-2.5">
          {!address ? (
            <p className="text-[11px] text-muted">盘口已取消，连接钱包后可领回 100% 本金。</p>
          ) : refundable > 0n ? (
            <button
              onClick={handleRefund}
              disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gold/40 bg-gold/12 py-2 text-[12px] font-semibold text-gold-bright transition-colors hover:bg-gold/20 disabled:opacity-60"
            >
              {claimRefund.pending ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
              领取退款 <span className="mono">{formatUsdc(refundable)}</span> USDC（含 4% 手续费）
            </button>
          ) : (
            <p className="text-[11px] text-muted">本盘你没有待退本金（未参与或已领取）。</p>
          )}
        </div>
      )}

      {onChain && ended && pool.status === 1 && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-2.5">
          {canForceVoid ? (
            <>
              <p className="mb-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-gold-bright/90">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                关盘已超过 30 天仍未结算。任何人可强制取消本盘，所有本金 100% 退回。
              </p>
              <button
                onClick={handleForceVoid}
                disabled={busy}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gold/40 bg-gold/12 py-2 text-[12px] font-semibold text-gold-bright transition-colors hover:bg-gold/20 disabled:opacity-60"
              >
                {forceRefund.pending ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldAlert className="size-3.5" />}
                强制取消并解锁退款
              </button>
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              <Clock3 className="size-3" />
              已关盘，等待结算。{daysToForce > 0 ? `${daysToForce} 天后` : "即将"}任何人可强制退款。
            </p>
          )}
        </div>
      )}

      {actionError && (
        <p className="rounded-lg border border-loss/30 bg-loss/10 px-2.5 py-2 text-[11px] text-loss">
          {actionError}
        </p>
      )}
      {actionHash && !actionError && (
        <a
          href={explorerTx(actionHash)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-[11px] text-profit hover:underline"
        >
          <CheckCircle2 className="size-3.5" /> 已上链，查看交易
        </a>
      )}

      <span className="pointer-events-none absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/25 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <span className="sr-only">
        池深 {toUsdcNumber(pool.totalNetPool).toFixed(2)} USDC
      </span>
    </article>
  );
}
