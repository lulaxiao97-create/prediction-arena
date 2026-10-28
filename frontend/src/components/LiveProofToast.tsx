"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Flame, X } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { trendPoints } from "@/lib/growth";
import type { ArenaPool } from "@/lib/types";

const FIRST_DELAY_MS = 9_000;
const CYCLE_MS = 20_000;
const VISIBLE_MS = 9_000;
const DISMISS_KEY = "pa.proof.dismissed";

/**
 * Live social-proof toast — bottom-right, one market at a time, every 20 seconds.
 *
 * Honesty constraint, same one the promo copy follows: this panel never invents a person. It shows
 * what the board can actually prove — how many traders a market has and what the paying side is
 * worth — instead of a fake "0x4B2… just bet $2,400". The venue's own activity feed already
 * separates on-chain rows from board rows for exactly this reason; a toast that fakes a wallet
 * would undo that in one screenshot.
 *
 * Behaviour: starts 9s after load (not on top of the hero's first paint), shows for 9s, cycles
 * every 20s, pauses while hovered, and stays dismissed for the session once closed. It is rendered
 * in a `pointer-events-none` layer so it can never eat a click meant for the page.
 */
export function LiveProofToast({ pools }: { pools: ArenaPool[] }) {
  const { t } = useI18n();
  const points = useMemo(() => trendPoints(pools as never, 6), [pools]);
  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (window.sessionStorage.getItem(DISMISS_KEY) === "1") setDismissed(true);
    } catch {
      /* storage blocked — the toast simply shows */
    }
  }, []);

  useEffect(() => {
    if (!mounted || dismissed || points.length === 0) return;

    let hideTimer: number | undefined;
    const timers: number[] = [];

    const show = () => {
      setVisible(true);
      hideTimer = window.setTimeout(() => setVisible(false), VISIBLE_MS);
    };

    timers.push(window.setTimeout(show, FIRST_DELAY_MS));
    const cycle = window.setInterval(() => {
      if (paused) return;
      setIndex((i) => (i + 1) % points.length);
      show();
    }, CYCLE_MS);

    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      window.clearInterval(cycle);
      if (hideTimer) window.clearTimeout(hideTimer);
    };
  }, [mounted, dismissed, paused, points.length]);

  if (!mounted || dismissed || points.length === 0) return null;

  const point = points[index % points.length];

  const close = () => {
    setDismissed(true);
    setVisible(false);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-40 flex justify-end sm:inset-x-auto sm:right-5 sm:bottom-5"
    >
      <div
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className={[
          "pointer-events-auto flex w-full max-w-[22rem] items-start gap-2.5 rounded-xl border border-gold/25 bg-[#0A0F1C]/95 p-2.5 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.85)] backdrop-blur-md transition-all duration-300 sm:p-3",
          visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        ].join(" ")}
        style={{ visibility: visible ? "visible" : "hidden" }}
      >
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-gold/30 bg-gold/10">
          <Flame className="size-3.5 text-gold" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p className="mono text-[8.5px] font-semibold uppercase tracking-[0.18em] text-gold/80">
            {t("growth.proofLabel")}
          </p>
          <Link
            href={point.href}
            className="mt-0.5 block text-[11.5px] leading-snug text-ink transition-colors hover:text-gold-bright"
          >
            {t("growth.proofLine", {
              title: point.title,
              traders: point.traders,
              mult: point.mult.toFixed(1),
            })}
          </Link>
        </div>

        <button
          onClick={close}
          aria-label={t("growth.proofDismiss")}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted/70 transition-colors hover:bg-white/5 hover:text-ink"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}
