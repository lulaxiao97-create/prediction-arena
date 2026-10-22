"use client";

import { useMemo } from "react";
import { cn, formatUsdc } from "@/lib/format";

const ONE = 1_000_000n;

/** Snap to a sane grid so dragging never produces $347.63. */
function snap(value: number, min: number, max: number): number {
  const step = value < 100 ? 10 : value < 1_000 ? 50 : 100;
  return Math.min(max, Math.max(min, Math.round(value / step) * step));
}

/**
 * Log-scaled amount slider. A linear 50 → 10,000 track would spend 99% of its length above
 * $100 and make the low end unusable; log space gives every decade equal room.
 */
export function AmountSlider({
  value,
  min,
  max,
  onChange,
  disabled,
  className,
}: {
  value: bigint;
  min: bigint;
  max: bigint;
  onChange: (next: bigint) => void;
  disabled?: boolean;
  className?: string;
}) {
  const minN = Number(min / ONE);
  const maxN = Number(max / ONE);

  const { slider, fill } = useMemo(() => {
    const current = Math.min(maxN, Math.max(minN, Number(value / ONE)));
    const ratio = Math.log(current / minN) / Math.log(maxN / minN);
    const pos = Math.round(Math.min(1, Math.max(0, ratio)) * 1000);
    return { slider: pos, fill: (pos / 1000) * 100 };
  }, [value, minN, maxN]);

  return (
    <div className={cn("select-none", className)}>
      <div className="relative flex items-center">
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={slider}
          disabled={disabled}
          aria-label="Bet amount"
          onChange={(e) => {
            const t = Number(e.target.value) / 1000;
            const raw = minN * Math.pow(maxN / minN, t);
            onChange(BigInt(snap(raw, minN, maxN)) * ONE);
          }}
          className="amount-slider w-full"
          style={{ ["--fill" as string]: `${fill}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="mono text-[9px] text-muted/45">${formatUsdc(min, 0)}</span>
        <span className="mono text-[10px] font-medium text-gold-bright">{`$${formatUsdc(value, 0)}`}</span>
        <span className="mono text-[9px] text-muted/45">${formatUsdc(max, 0)}</span>
      </div>
    </div>
  );
}
