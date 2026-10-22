"use client";

import { useMemo } from "react";

/** Pure SVG probability chart — no chart library, deterministic path from the series. */
export function ProbabilityChart({
  series,
  height = 190,
  tone = "profit",
  live = false,
}: {
  series: number[];
  height?: number;
  tone?: "profit" | "loss";
  /** Pulses the endpoint — used when the series is ticking. */
  live?: boolean;
}) {
  const { line, area, last, min, max } = useMemo(() => {
    const W = 720;
    const H = height;
    const padX = 6;
    const padY = 14;
    const n = Math.max(series.length, 2);
    const points = series.map((value, i) => {
      const x = padX + (i * (W - padX * 2)) / (n - 1);
      const y = H - padY - value * (H - padY * 2);
      return [x, y] as const;
    });
    const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const first = points[0];
    const lastPoint = points[points.length - 1];
    const areaPath = `${d} L${lastPoint[0].toFixed(2)},${H} L${first[0].toFixed(2)},${H} Z`;
    return {
      line: d,
      area: areaPath,
      last: lastPoint,
      min: Math.min(...series),
      max: Math.max(...series),
    };
  }, [series, height]);

  const stroke = tone === "profit" ? "#10b981" : "#ef4444";
  const fillTop = tone === "profit" ? "rgba(16,185,129,0.28)" : "rgba(239,68,68,0.26)";

  return (
    <div className="relative">
      <svg viewBox={`0 0 720 ${height}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Probability history">
        <defs>
          <linearGradient id={`pc-fill-${tone}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillTop} />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1="0"
            x2="720"
            y1={height - 14 - g * (height - 28)}
            y2={height - 14 - g * (height - 28)}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="4 6"
          />
        ))}

        <path d={area} fill={`url(#pc-fill-${tone})`} />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last[0]} cy={last[1]} r="4" fill={stroke} />
        <circle cx={last[0]} cy={last[1]} r="8" fill={stroke} opacity="0.18" />
        {live && <circle cx={last[0]} cy={last[1]} r="4" fill="none" stroke={stroke} strokeWidth="1.4" opacity="0.7">
          <animate attributeName="r" values="4;12;4" dur="2.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.7;0;0.7" dur="2.6s" repeatCount="indefinite" />
        </circle>}
      </svg>

      <div className="pointer-events-none absolute inset-y-0 left-0 flex flex-col justify-between py-2 text-[9px] text-muted/50">
        <span>{(max * 100).toFixed(0)}%</span>
        <span>{(min * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}
