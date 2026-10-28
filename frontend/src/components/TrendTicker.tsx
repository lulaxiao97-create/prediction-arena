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
 * Numbers come from the manifest via `trendLines()`, so the rail and the cards agree.
 */
export function TrendTicker({ pools }: { pools: ArenaPool[] }) {
  const lines = useMemo<TrendLine[]>(() => trendLines(pools as never, 6), [pools]);
  if (lines.length === 0) return null;

  const row = (keyPrefix: string) => (
    <ul className="flex shrink-0 items-center gap-8 pr-8">
      {lines.map((line, i) => (
        <li key={`${keyPrefix}-${i}`} className="flex items-center gap-8">
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
      className="relative overflow-hidden border-y border-white/6 bg-[#080C16]/90"
      aria-label="Trending markets"
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-14 bg-gradient-to-r from-[#05080F] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-14 bg-gradient-to-l from-[#05080F] to-transparent" />
      <div className="flex items-center gap-4 py-2">
        <span className="ml-3 flex shrink-0 items-center gap-1.5 rounded-full border border-gold/30 bg-gold/[0.08] px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-gold">
          <Flame className="size-3" aria-hidden /> Hot
        </span>
        <div className="pa-marquee flex min-w-0">
          {row("a")}
          <div aria-hidden className="flex">
            {row("b")}
          </div>
        </div>
      </div>
    </div>
  );
}
