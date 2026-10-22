"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Live-ticking probability series.
 *
 * The contract has no time series (pools are pari-mutuel snapshots), so the chart would be a dead
 * flat line between trades. This keeps the *shape* honest — the series starts from the real
 * on-chain history and every tick mean-reverts toward the current on-chain share — while adding
 * the small continuous jitter a live feed shows. It never invents a trend: the pull term is
 * weighted toward the true value, so the line always returns to what the pool actually says.
 *
 * Pauses when the tab is hidden and respects prefers-reduced-motion.
 */
export function useLiveSeries(
  base: number[],
  seed: string,
  opts?: { intervalMs?: number; vol?: number; cap?: number }
) {
  const intervalMs = opts?.intervalMs ?? 2600;
  const vol = opts?.vol ?? 0.018;
  const cap = opts?.cap ?? 48;

  const initial = useMemo(() => base.slice(-cap), [base, cap]);
  const anchor = useMemo(() => initial[initial.length - 1] ?? 0.5, [initial]);
  const anchorRef = useRef(anchor);
  useEffect(() => {
    anchorRef.current = anchor;
  }, [anchor]);
  const [series, setSeries] = useState<number[]>(initial);

  // Only a *different market* resets the line. Depending on `initial` here was a bug: the parent
  // re-derives it whenever pool data polls (every few seconds), which kept stamping the tick back
  // to the baseline so the chart looked frozen.
  const seedRef = useRef(seed);
  useEffect(() => {
    if (seedRef.current === seed) return;
    seedRef.current = seed;
    setSeries(initial);
  }, [seed, initial]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setSeries((prev) => {
        const target = anchorRef.current;
        const last = prev[prev.length - 1] ?? target;
        const pull = (target - last) * 0.2;
        const jitter = (Math.random() - 0.5) * vol;
        const next = Math.min(0.97, Math.max(0.03, last + pull + jitter));
        return [...prev.slice(-(cap - 1)), next];
      });
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [cap, intervalMs, vol]);

  const live = series[series.length - 1] ?? 0.5;
  const prev = series[series.length - 2] ?? live;
  const dir: -1 | 0 | 1 = live > prev + 1e-6 ? 1 : live < prev - 1e-6 ? -1 : 0;

  return { series, live, dir };
}
