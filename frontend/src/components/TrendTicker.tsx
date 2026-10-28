"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Flame } from "lucide-react";
import { trendLines, type TrendLine } from "@/lib/growth";
import type { ArenaPool } from "@/lib/types";

/**
 * Hot-trends rail.
 *
 * Marquee, not a carousel: a carousel hides five of six rows behind a timer the reader may never
 * wait for, while a marquee shows every line within one pass. The track is duplicated and the
 * copy is `aria-hidden`, so screen readers hear the list once and the animation has no gap.
 *
 * The scrolling track lives in its own `overflow-hidden` box. A transform moves paint, not layout,
 * so without that box the track slides *over* the "HOT" badge that sits to its left — the first
 * version did exactly that on the live page. Numbers come from `trendLines()`, which reads the
 * same manifest the cards do, so the rail and the grid never disagree.
 */
export function TrendTicker({ pools }: { pools: ArenaPool[] }) {
  const lines = useMemo<TrendLine[]>(() => trendLines(pools as never, 6), [pools]);
  if (lines.length === 0) return null;

  const row = (keyPrefix: string) => (
    <ul className="flex shrink-0 items-center gap-6 pr-6">
      {lines.map((line, i) => (
        <li key={`${keyPrefix}-${i}`} className="flex items-center gap-6">
          <Link
            href={line.href}
            className="mono whitespace-nowrap text-[11.5px] text-muted transition-colors hover:text-ink"
          >
            {line.text}
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
      className="relative flex items-center gap-3 border-y border-white/6 bg-[#080C16]/90 py-2"
      aria-label="Trending markets"
    >
      <span className="z-20 ml-3 flex shrink-0 items-center gap-1.5 rounded-full border border-gold/30 bg-[#0B1020] px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-gold">
        <Flame className="size-3" aria-hidden /> Hot
      </span>

      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-[#080C16] to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-[#080C16] to-transparent" />
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
