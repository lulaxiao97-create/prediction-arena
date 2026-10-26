"use client";

import { useState } from "react";
import { cn } from "@/lib/format";
import type { CoverKind, CoverSpec } from "@/lib/covers";

/**
 * The artwork layer.
 *
 * Three stacked pieces, each doing one job:
 *   1. a self-hosted photograph sets the mood (sports pitch, capitol, server hall …);
 *   2. a vector motif names the subject in a way a photo cannot (pitch lines, EU stars,
 *      candlesticks, neural lattice, token glyph);
 *   3. scrims keep the text above it readable at every size.
 *
 * Nothing here is animated and nothing is fetched at runtime beyond the local JPEG, so a card
 * grid of 38 markets stays cheap: the `-sm` variant is ~30–60 KB and only loads for cards that
 * scroll into view.
 */

function accentAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const MOTIF: Record<CoverKind, React.ReactNode> = {
  token: (
    <>
      <circle cx="60" cy="60" r="34" />
      <circle cx="60" cy="60" r="44" opacity="0.4" />
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        return <line key={i} x1={60 + Math.cos(a) * 38} y1={60 + Math.sin(a) * 38} x2={60 + Math.cos(a) * 44} y2={60 + Math.sin(a) * 44} opacity="0.35" />;
      })}
    </>
  ),
  football: (
    <>
      <circle cx="60" cy="60" r="34" />
      <line x1="60" y1="26" x2="60" y2="94" />
      <circle cx="60" cy="60" r="12" />
      <path d="M26 26h14v14H26zM80 80h14v14H80z" opacity="0.5" />
    </>
  ),
  basketball: (
    <>
      <circle cx="60" cy="60" r="34" />
      <line x1="26" y1="60" x2="94" y2="60" />
      <line x1="60" y1="26" x2="60" y2="94" />
      <path d="M36 36q24 24 48 48M84 36q-24 24-48 48" opacity="0.55" />
    </>
  ),
  esports: (
    <>
      <path d="M60 22l33 19v38L60 98 27 79V41z" />
      <path d="M60 40v40M40 60h40" opacity="0.6" />
      <circle cx="60" cy="60" r="10" opacity="0.7" />
    </>
  ),
  motorsport: (
    <>
      <path d="M20 44h52l14 12-14 12H20" />
      <path d="M32 72h44l10 8" opacity="0.5" />
      <path d="M14 32h30M14 24h20" opacity="0.35" />
      <circle cx="88" cy="34" r="6" opacity="0.6" />
    </>
  ),
  politics: (
    <>
      <path d="M24 50L60 30l36 20" />
      <path d="M30 52v34M46 52v34M60 52v34M74 52v34M90 52v34" />
      <path d="M22 88h76" />
      <path d="M28 40h64" opacity="0.5" />
    </>
  ),
  eu: (
    <>
      <circle cx="60" cy="60" r="36" opacity="0.35" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        return <circle key={i} cx={60 + Math.cos(a) * 27} cy={60 + Math.sin(a) * 27} r="3.4" />;
      })}
    </>
  ),
  macro: (
    <>
      {[26, 42, 58, 74, 90].map((x, i) => (
        <g key={x}>
          <line x1={x} y1={28 + (i % 3) * 8} x2={x} y2={92 - (i % 2) * 10} opacity="0.45" />
          <rect x={x - 5} y={38 + (i % 3) * 10} width="10" height={22 + (i % 2) * 12} />
        </g>
      ))}
    </>
  ),
  ai: (
    <>
      {[34, 60, 86].map((x) =>
        [34, 60, 86].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3.2" opacity="0.9" />),
      )}
      <path d="M34 34L60 60L86 34M34 60h52M34 86l26-26 26 26M60 34v52" opacity="0.4" />
    </>
  ),
  neural: (
    <>
      <path d="M28 74L48 40l24 30 20-18" opacity="0.7" />
      <path d="M28 74l44-4M48 40l44 34M72 70l20-40" opacity="0.3" />
      <circle cx="28" cy="74" r="4" />
      <circle cx="48" cy="40" r="4" />
      <circle cx="72" cy="70" r="4" />
      <circle cx="92" cy="52" r="4" />
    </>
  ),
  meme: (
    <>
      <path d="M24 84q10-28 34-38t38-6" opacity="0.7" />
      <path d="M30 96q12-30 36-40" opacity="0.4" />
      <circle cx="36" cy="42" r="5" opacity="0.7" />
      <circle cx="80" cy="82" r="7" opacity="0.35" />
      <path d="M52 30l6 10-8 4" opacity="0.5" />
    </>
  ),
  chain: (
    <>
      <path d="M38 46l22-12 22 12-22 12z" />
      <path d="M38 46v22l22 12V58z" opacity="0.6" />
      <path d="M82 46v22L60 80V58z" opacity="0.4" />
      <path d="M22 74l16-8" opacity="0.35" />
    </>
  ),
  space: (
    <>
      <circle cx="60" cy="60" r="20" />
      <ellipse cx="60" cy="60" rx="44" ry="16" transform="rotate(-18 60 60)" opacity="0.6" />
      <circle cx="98" cy="42" r="3" />
    </>
  ),
};

export function MarketCover({
  spec,
  variant = "card",
  className,
}: {
  spec: CoverSpec;
  variant?: "card" | "banner" | "detail";
  className?: string;
}) {
  const [ok, setOk] = useState(true);
  const card = variant === "card";

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      style={{ backgroundColor: "#070b14" }}
    >
      {ok && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card ? `/covers/${spec.photo}-sm.jpg` : `/covers/${spec.photo}.jpg`}
          srcSet={card ? undefined : `/covers/${spec.photo}-sm.jpg 640w, /covers/${spec.photo}.jpg 1600w`}
          sizes={card ? "380px" : "(max-width: 900px) 100vw, 900px"}
          alt=""
          loading={card ? "lazy" : "eager"}
          decoding="async"
          onError={() => setOk(false)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-transform duration-700",
            card ? "opacity-[0.78]" : variant === "banner" ? "opacity-[0.8]" : "opacity-[0.62]",
            "saturate-[1.12] contrast-[1.02]",
          )}
        />
      )}

      {/* subject light: the accent breathes from the top-left, so two markets on the same photo
          still read as different colours at a glance */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 100% at 10% 0%, ${accentAlpha(spec.accent, spec.kind === "token" ? 0.5 : 0.34)} 0%, transparent ${spec.kind === "token" ? 70 : 64}%)`,
        }}
      />

      {/* vector motif, huge and ghosted — the part a photo cannot say */}
      <svg
        viewBox="0 0 120 120"
        className={cn("absolute", card ? "-bottom-8 -right-7 h-[150px] w-[150px]" : "-bottom-10 -right-6 h-[230px] w-[230px]")}
        fill="none"
        stroke={spec.accent}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: card ? 0.5 : 0.42 }}
      >
        {MOTIF[spec.kind]}
      </svg>

      {/* the token monogram is the loudest thing on a token market: it is what tells a BTC card
          from an ETH card when both sit on the same market-tape photo */}
      {spec.mark && (
        <span
          className={cn(
            "absolute select-none font-black leading-none",
            card ? "right-1 top-1/2 -translate-y-1/2 text-[86px]" : "right-6 top-1/2 -translate-y-1/2 text-[170px]",
          )}
          style={{
            color: spec.accent,
            opacity: card ? 0.55 : 0.4,
            textShadow: `0 0 26px ${accentAlpha(spec.accent, 0.65)}`,
          }}
        >
          {spec.mark}
        </span>
      )}

      {/* legibility scrims */}
      <div
        className={cn(
          "absolute inset-0",
          card
            ? "bg-gradient-to-t from-void via-void/55 to-void/15"
            : variant === "banner"
              ? "bg-gradient-to-r from-void via-void/70 to-void/25"
              : "bg-gradient-to-r from-void via-void/72 to-void/20",
        )}
      />
      {!card && <div className="absolute inset-0 bg-gradient-to-t from-void via-transparent to-transparent" />}
    </div>
  );
}
