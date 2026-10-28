"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronUp, X } from "lucide-react";
import type { ArenaPool } from "@/lib/types";
import { cn, formatProbability } from "@/lib/format";
import { useI18n } from "@/components/LocaleProvider";
import { TradePanel } from "@/components/TradePanel";

/**
 * Mobile trading as a bottom sheet.
 *
 * On desktop the panel sits in the right column; below `lg` a thumb needs it reachable at the bottom
 * of the screen instead. The sheet is drag-to-dismiss (touch), closes on backdrop tap or Escape,
 * locks body scroll while open, and reuses the exact same <TradePanel/> so the maths, the slider and
 * the confirmation flow cannot drift between layouts.
 */
export function MobileTradeSheet({ pool, yesPct }: { pool: ArenaPool; yesPct: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);
  const dragging = useRef(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // lock background scroll while the sheet is up, and move focus into the dialog so a keyboard
  // user is inside it instead of tabbing through the page behind it
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheetRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0].clientY;
    dragging.current = true;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!dragging.current || startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) setDragY(dy);
  }
  function onTouchEnd() {
    dragging.current = false;
    if (dragY > 90) setOpen(false);
    setDragY(0);
    startY.current = null;
  }

  const yes = Math.round(yesPct * 100);

  return (
    <>
      {/* sticky action bar — mobile only */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-void/92 px-3 pb-[max(env(safe-area-inset-bottom),0.6rem)] pt-2 backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-profit">{yes}% {t("card.yes")}</span>
              <span className="text-muted/40">·</span>
              <span className="text-loss">{100 - yes}% {t("card.no")}</span>
            </div>
            <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-white/8">
              <div className="h-full bg-profit/80 transition-[width] duration-300" style={{ width: `${yes}%` }} />
              <div className="h-full flex-1 bg-loss/80" />
            </div>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="btn-gold shrink-0 px-5 py-2.5 text-[13.5px] font-semibold"
            aria-haspopup="dialog"
          >
            {t("trade.place")}
            <ChevronUp className="size-4" />
          </button>
        </div>
      </div>

      {/* sheet */}
      <div
        className={cn(
          "fixed inset-0 z-50 lg:hidden",
          // `invisible` (not just pointer-events-none) keeps the closed sheet out of the tab
          // order and the accessibility tree while still letting the transform animate.
          open ? "pointer-events-auto visible" : "pointer-events-none invisible"
        )}
        aria-hidden={!open}
      >
        <div
          onClick={() => setOpen(false)}
          className={cn(
            "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300",
            open ? "opacity-100" : "opacity-0"
          )}
        />
        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("trade.panel")}
          tabIndex={-1}
          className={cn(
            "absolute inset-x-0 bottom-0 flex max-h-[92vh] flex-col rounded-t-3xl border-t border-white/12 bg-void/97 shadow-[0_-24px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl transition-transform duration-300 ease-out will-change-transform outline-none",
            "max-h-[88dvh]",
            open ? "translate-y-0" : "translate-y-full"
          )}
          style={{ transform: open ? `translateY(${dragY}px)` : undefined }}
        >
          {/* drag handle */}
          <div
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            className="flex shrink-0 touch-none items-center justify-center py-2.5"
          >
            <span className="h-1 w-10 rounded-full bg-white/25" />
          </div>

          <div className="flex shrink-0 items-center gap-2 px-3 pb-1 sm:px-4">
            <p className="truncate text-[13px] font-semibold text-ink">{pool.title}</p>
            <button
              ref={closeRef}
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="ml-auto grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 text-muted transition-colors hover:border-white/25 hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <TradePanel pool={pool} sticky={false} />
          </div>
        </div>
      </div>
    </>
  );
}
