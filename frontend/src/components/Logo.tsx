"use client";

import { useId } from "react";
import { cn } from "@/lib/format";

/**
 * THE Prediction Arena mark. LOCKED.
 *
 * Geometry is frozen: a cyber shield (custody + settlement), a crossed double arrow (two sides
 * of one binary market), and a cyan AI core at the intersection. Gold = value at stake,
 * blue = machine intelligence. Do not restructure, re-proportion or re-colour this mark —
 * every surface in the product (header, favicon, loading state, drawers, docs, footer) renders
 * exactly this geometry through this one component.
 *
 * Allowed variations: size, optional wordmark, optional idle animation, className.
 */
const VERSION = "PA-MARK-1.0";

export function Logo({
  size = 36,
  className,
  animated = false,
  title = "Prediction Arena",
}: {
  size?: number;
  className?: string;
  /** Idle breathing on the core + a slow sweep on the arrows. Off for static contexts. */
  animated?: boolean;
  title?: string;
}) {
  const uid = useId().replace(/[:]/g, "");
  const gold = `pa-gold-${uid}`;
  const blue = `pa-blue-${uid}`;
  const core = `pa-core-${uid}`;
  const shell = `pa-shell-${uid}`;

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      role="img"
      aria-label={title}
      data-pa-mark={VERSION}
    >
      <defs>
        {/* value at stake */}
        <linearGradient id={gold} x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FEF3C7" />
          <stop offset="42%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#B45309" />
        </linearGradient>
        {/* machine intelligence */}
        <linearGradient id={blue} x1="10" y1="38" x2="38" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22D3EE" />
          <stop offset="60%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>
        <linearGradient id={shell} x1="24" y1="2" x2="24" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#16161C" />
          <stop offset="100%" stopColor="#0A0A0D" />
        </linearGradient>
        <radialGradient id={core} cx="24" cy="24" r="6.5" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ECFEFF" />
          <stop offset="55%" stopColor="#22D3EE" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* shield — custody shell */}
      <path
        d="M24 2.6 42.4 9.6v13.9c0 10.2-7.4 18.1-18.4 21.9C13 41.6 5.6 33.7 5.6 23.5V9.6L24 2.6Z"
        fill={`url(#${shell})`}
        stroke={`url(#${gold})`}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      {/* inner hairline */}
      <path
        d="M24 6.4 38.6 11.9v11.6c0 8.4-6 15-14.6 18.3-8.6-3.3-14.6-9.9-14.6-18.3V11.9L24 6.4Z"
        fill="none"
        stroke={`url(#${gold})`}
        strokeOpacity="0.28"
        strokeWidth="0.9"
      />

      {/* crossed double arrow — two sides of one binary market */}
      <g
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        className={animated ? "pa-mark-sweep" : undefined}
      >
        {/* YES: up-right, gold */}
        <path d="M17.4 30.6 30.6 17.4" stroke={`url(#${gold})`} strokeWidth="2.5" />
        <path d="M30.9 17.1 24.5 18.9l4.9 4.9 1.5-6.7Z" fill={`url(#${gold})`} stroke="none" />
        {/* NO: down-left, tech blue */}
        <path d="M30.6 30.6 17.4 17.4" stroke={`url(#${blue})`} strokeWidth="2.5" />
        <path d="M17.1 17.1 23.5 18.9l-4.9 4.9-1.5-6.7Z" fill={`url(#${blue})`} stroke="none" />
      </g>

      {/* AI core at the intersection */}
      <circle cx="24" cy="24" r="6.4" fill={`url(#${core})`} className={animated ? "pa-mark-core" : undefined} />
      <path
        d="M24 20.4 27.6 24 24 27.6 20.4 24 24 20.4Z"
        fill="#0A0A0D"
        stroke={`url(#${blue})`}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="24" r="1.15" fill="#ECFEFF" />
    </svg>
  );
}

/** Mark + locked wordmark. Used by the header and the footer. */
export function LogoLockup({
  size = 34,
  subtitle,
  subtitleClassName,
  className,
}: {
  size?: number;
  subtitle?: string;
  subtitleClassName?: string;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Logo size={size} />
      <span className="flex flex-col leading-none">
        <span className="gold-text text-[15px] font-semibold tracking-[0.04em]">Prediction Arena</span>
        {subtitle && (
          <span className={cn("mt-1 text-[9px] font-medium tracking-[0.02em] text-muted/80", subtitleClassName)}>
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}

/** Loading state — the same mark, breathing. No spinner, no second logo. */
export function LogoLoader({ label = "Loading" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5" role="status" aria-live="polite">
      <Logo size={26} animated />
      <span className="mono text-[11px] uppercase tracking-[0.18em] text-muted/70">{label}</span>
    </span>
  );
}
