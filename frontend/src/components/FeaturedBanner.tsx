"use client";

import Link from "next/link";
import { ArrowRight, Clock3, Flame, Users } from "lucide-react";
import type { ArenaPool } from "@/lib/types";
import { countdown, formatCompactUsdc, formatCountdown, formatProbability, sideShare } from "@/lib/format";
import { categoryI18nKey } from "@/lib/categories";
import { useI18n } from "@/components/LocaleProvider";

export function FeaturedBanner({ pool, onBet }: { pool: ArenaPool; onBet: (pool: ArenaPool, option: 0 | 1) => void }) {
  const { t } = useI18n();
  const share0 = sideShare(pool.option0Pool, pool.option1Pool);
  const cd = countdown(pool.endTime);
  const href = `/market/${pool.id.toString()}`;

  return (
    <section className="card-edge relative overflow-hidden rounded-3xl border border-gold/20 bg-gradient-to-br from-gold/[0.10] via-void-elevated to-void">
      <div className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-gold/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 left-1/4 size-72 rounded-full bg-profit/8 blur-3xl" />

      <Link href={href} className="absolute inset-0 z-0" aria-label={t("featured.trade")} />

      <div className="relative z-10 grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="flex flex-col justify-center">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip border-gold/40 bg-gold/15 text-gold-bright">
              <Flame className="size-3" />
              {t("featured.label")}
            </span>
            <span className="chip">{t(categoryI18nKey(pool.category))}</span>
            {(pool.tags ?? []).slice(0, 2).map((tag) => (
              <span key={tag} className="chip border-white/10 text-[10px] text-muted">
                {tag}
              </span>
            ))}
          </div>

          <h2 className="mt-3 text-[22px] font-bold leading-tight text-ink sm:text-[28px]">{pool.title}</h2>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="text-[9.5px] uppercase tracking-[0.12em] text-muted/60">{t("featured.liquidity")}</span>
              <span className="mono text-[13px] font-semibold text-ink">${formatCompactUsdc(pool.totalNetPool)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3" />
              {(pool.traders ?? 0).toLocaleString("en-US")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="size-3" />
              <span className="mono">{cd.ended ? "Ended" : formatCountdown(cd)}</span>
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={(e) => {
                e.preventDefault();
                onBet(pool, 0);
              }}
              className="rounded-xl border border-profit/40 bg-profit/12 px-4 py-2 text-[12.5px] font-semibold text-profit transition-colors hover:bg-profit/20"
            >
              {t("card.yes")} {formatProbability(share0)}
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                onBet(pool, 1);
              }}
              className="rounded-xl border border-loss/40 bg-loss/12 px-4 py-2 text-[12.5px] font-semibold text-loss transition-colors hover:bg-loss/20"
            >
              {t("card.no")} {formatProbability(1 - share0)}
            </button>
            <a
              href={href}
              className="inline-flex items-center gap-1 rounded-xl border border-white/12 px-4 py-2 text-[12.5px] text-ink transition-colors hover:border-gold/50 hover:bg-gold/10 hover:text-gold-bright active:scale-[0.98]"
            >
              {t("featured.trade")} <ArrowRight className="size-3.5" />
            </a>
          </div>
        </div>

        {/* probability block */}
        <div className="flex flex-col justify-center gap-3 rounded-2xl border border-white/8 bg-void/40 p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted">{t("card.implied")}</p>
          <div className="flex items-end justify-between">
            <div>
              <p className="mono text-[34px] font-bold leading-none text-profit">{formatProbability(share0)}</p>
              <p className="mt-1 text-[10.5px] uppercase tracking-[0.1em] text-muted">{t("card.yes")}</p>
            </div>
            <div className="text-right">
              <p className="mono text-[34px] font-bold leading-none text-loss">{formatProbability(1 - share0)}</p>
              <p className="mt-1 text-[10.5px] uppercase tracking-[0.1em] text-muted">{t("card.no")}</p>
            </div>
          </div>
          <div className="odds-track flex h-2.5">
            <div className="h-full rounded-l-full bg-gradient-to-r from-profit/70 to-profit" style={{ width: `${Math.max(2, share0 * 100)}%` }} />
            <div className="h-full flex-1 rounded-r-full bg-gradient-to-r from-loss to-loss/70" />
          </div>
          <p className="text-[10.5px] leading-relaxed text-muted/80">
            ${formatCompactUsdc(pool.totalNetPool)} {t("featured.liquidity")}
          </p>
        </div>
      </div>
    </section>
  );
}
