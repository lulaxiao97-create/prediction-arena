"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Flame } from "lucide-react";
import { money, trendPoints, type TrendPoint } from "@/lib/growth";
import { useI18n } from "@/components/LocaleProvider";
import type { ArenaPool } from "@/lib/types";

/**
 * Hot-trends rail.
 *
 * Marquee, not a carousel: a carousel hides five of six rows behind a timer the reader may never
 * wait for, while a marquee shows every line within one pass. The track is duplicated and the copy
 * is `aria-hidden`, so screen readers hear the list once and the animation has no gap.
 *
 * The scrolling track lives in its own `overflow-hidden` box. A transform moves paint, not layout,
 * so without that box the track slides *over* the "HOT" badge to its left — the first version did
 * exactly that on the live page.
 */
export function TrendTicker({ pools }: { pools: ArenaPool[] }) {
  const { t } = useI18n();
  const points = useMemo<TrendPoint[]>(() => trendPoints(pools as never, 6), [pools]);
  if (points.length === 0) return null;

  const row = (keyPrefix: string) => (
    <ul className="flex shrink-0 items-center gap-5 pr-5 sm:gap-6 sm:pr-6">
      {points.map((p, i) => (
        <li key={`${keyPrefix}-${i}`} className="flex items-center gap-5 sm:gap-6">
          <Link
            href={p.href}
            className="mono whitespace-nowrap text-[11px] text-muted transition-colors hover:text-ink sm:text-[11.5px]"
          >
            {t("growth.trendLine", {
              title: p.title,
              traders: p.traders,
              liquidity: money(p.liquidityUsdc),
              mult: p.mult.toFixed(1),
            })}
          </Link>
          <span aria-hidden className="text-gold/30">
            ·
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className="relative flex items-center gap-2 border-y border-white/6 bg-[#080C16]/90 py-1.5 sm:gap-3 sm:py-2"
      aria-label="Trending markets"
    >
      <span className="z-20 ml-2 flex shrink-0 items-center gap-1 rounded-full border border-gold/30 bg-[#0B1020] px-2 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.14em] text-gold sm:ml-3 sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-[9.5px] sm:tracking-[0.18em]">
        <Flame className="size-2.5 sm:size-3" aria-hidden /> {t("growth.hotLabel")}
      </span>

      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-[#080C16] to-transparent sm:w-10" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[#080C16] to-transparent sm:w-10" />
        <div className="pa-marquee flex">
          {row("a")}
          <div aria-hidden className="flex">
            {row("b")}
          </div>
        </div>
      </div>
    </div>
  );
}
