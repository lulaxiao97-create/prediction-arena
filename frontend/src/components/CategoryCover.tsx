"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/format";
import { coverStyle, type VisualTheme } from "@/lib/visuals";

/**
 * Category cover: a generated vector scene with an optional photograph blended on top.
 *
 * The vector layer is the floor — it always renders, costs nothing, and keeps the card legible
 * offline. The photo layer is the ceiling: when Unsplash responds it is blended in soft-light and
 * dimmed, and when it fails nothing changes visually.
 *
 * Always absolutely positioned; the parent must be `relative` + `overflow-hidden`.
 */
export function CategoryCover({
  theme,
  className,
  photo = true,
  glyph = true,
  /** how hard the bottom fades into the page — cards need more, banners less */
  fade = "card",
}: {
  theme: VisualTheme;
  className?: string;
  photo?: boolean;
  glyph?: boolean;
  fade?: "card" | "banner" | "hero";
}) {
  const uid = useId().replace(/:/g, "");
  const [photoOk, setPhotoOk] = useState(true);

  const gid = `cv-g-${uid}`;
  const rid = `cv-r-${uid}`;
  const pid = `cv-p-${uid}`;

  const fadeClass =
    fade === "hero"
      ? "bg-gradient-to-t from-void via-void/45 to-transparent"
      : fade === "banner"
        ? "bg-gradient-to-r from-void/95 via-void/55 to-transparent"
        : "bg-gradient-to-t from-void/95 via-void/60 to-void/10";

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      style={coverStyle(theme)}
    >
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 200" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--cv-from)" />
            <stop offset="60%" stopColor="var(--cv-to)" />
            <stop offset="100%" stopColor="#0B0F19" />
          </linearGradient>
          <radialGradient id={rid} cx="30%" cy="18%" r="70%">
            <stop offset="0%" stopColor="var(--cv-accent)" stopOpacity="0.45" />
            <stop offset="55%" stopColor="var(--cv-accent)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--cv-accent)" stopOpacity="0" />
          </radialGradient>
          <pattern id={pid} width="22" height="22" patternUnits="userSpaceOnUse">
            <path d="M22 0H0V22" fill="none" stroke="var(--cv-accent)" strokeOpacity="0.16" strokeWidth="0.6" />
          </pattern>
        </defs>

        <rect width="400" height="200" fill={`url(#${gid})`} />
        <rect width="400" height="200" fill={`url(#${pid})`} />
        <rect width="400" height="200" fill={`url(#${rid})`} />

        {/* horizon arc + a few data ticks: reads as a terminal, not a gradient blob */}
        <path
          d="M-20 168 Q 120 96 220 132 T 420 92"
          fill="none"
          stroke="var(--cv-accent)"
          strokeOpacity="0.3"
          strokeWidth="1.1"
        />
        <path
          d="M-20 182 Q 140 126 240 152 T 420 120"
          fill="none"
          stroke="var(--cv-accent)"
          strokeOpacity="0.14"
          strokeWidth="0.8"
        />
        {[36, 84, 132, 180, 228, 276, 324, 372].map((x, i) => (
          <rect
            key={x}
            x={x}
            y={200 - (14 + ((i * 37) % 46))}
            width="2.5"
            height={14 + ((i * 37) % 46)}
            fill="var(--cv-accent)"
            opacity={0.1 + ((i * 7) % 12) / 100}
            rx="1"
          />
        ))}
      </svg>

      {photo && photoOk && theme.photo && (
        <img
          src={theme.photo}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setPhotoOk(false)}
          className="absolute inset-0 h-full w-full object-cover opacity-45 mix-blend-soft-light"
        />
      )}

      {/* 20% dim so text and the probability bar stay crisp over any photo */}
      <div className="absolute inset-0 bg-[#05070d]/20" />
      <div className={cn("absolute inset-0", fadeClass)} />

      {glyph && (
        <span
          className="absolute right-3 top-2 select-none text-[26px] leading-none opacity-[0.22]"
          style={{ color: theme.accent }}
        >
          {theme.glyph}
        </span>
      )}
    </div>
  );
}
