"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Clock3, Droplets, Users } from "lucide-react";
import type { ArenaPool } from "@/lib/types";
import {
  cn,
  countdown,
  formatCountdown,
  formatEndDate,
  formatUsdc,
  impliedMultiplier,
  sideShare,
  toUsdcNumber,
} from "@/lib/format";

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

      {/* actions */}
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

      <span className="pointer-events-none absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/25 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <span className="sr-only">
        池深 {toUsdcNumber(pool.totalNetPool).toFixed(2)} USDC
      </span>
    </article>
  );
}
