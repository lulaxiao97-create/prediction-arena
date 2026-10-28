"use client";

import { ArrowUpRight, BadgeCheck, ShieldCheck, Zap } from "lucide-react";
import { FEE_PCT, GROWTH_OFFERS, TRUST_CHIPS } from "@/lib/growth";
import { useI18n } from "@/components/LocaleProvider";

const TRUST_ICON = {
  audited: BadgeCheck,
  nonCustodial: ShieldCheck,
  instant: Zap,
} as const;

/**
 * Growth strip — the two offers plus the three objections, directly under the hero.
 *
 * Placement is the point: a visitor decides whether to read the next screen within one glance, and
 * the hero currently ends with buttons. This row answers "what's in it for me" (offer) and "can I
 * trust it" (chips) before the first scroll, without a modal, an email capture or a countdown that
 * resets on every reload.
 *
 * Mobile is deliberately denser: two lines of body copy instead of three, tighter padding, smaller
 * kickers. The information is the same; the air is not.
 */
export function GrowthStrip() {
  const { t } = useI18n();

  return (
    <section aria-label="Launch offers" className="mt-3 sm:mt-4">
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:gap-3 lg:grid-cols-2">
        {GROWTH_OFFERS.map((offer) => (
          <a
            key={offer.id}
            href={offer.href}
            className={[
              "group relative flex min-w-0 flex-col gap-1 overflow-hidden rounded-xl border p-3 transition-colors sm:gap-1.5 sm:rounded-2xl sm:p-3.5",
              offer.tone === "gold"
                ? "border-gold/25 bg-gradient-to-br from-gold/[0.10] via-gold/[0.04] to-transparent hover:border-gold/45"
                : "border-cyan/25 bg-gradient-to-br from-cyan/[0.10] via-cyan/[0.04] to-transparent hover:border-cyan/45",
            ].join(" ")}
          >
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span aria-hidden className="text-[14px] leading-none sm:text-[15px]">
                {offer.emoji}
              </span>
              <span
                className={[
                  "mono text-[8.5px] font-semibold uppercase tracking-[0.16em] sm:text-[9px] sm:tracking-[0.2em]",
                  offer.tone === "gold" ? "text-gold" : "text-cyan-bright",
                ].join(" ")}
              >
                {t(offer.kicker)}
              </span>
              <ArrowUpRight className="ml-auto size-3.5 shrink-0 text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </div>
            <p className="text-[12.5px] font-semibold leading-snug text-ink sm:text-[13.5px]">{t(offer.title)}</p>
            <p className="text-[11px] leading-relaxed text-muted sm:text-[11.5px]">{t(offer.body, { fee: FEE_PCT })}</p>
            <span
              className={[
                "mt-0.5 w-fit text-[10.5px] font-semibold underline-offset-2 group-hover:underline sm:text-[11px]",
                offer.tone === "gold" ? "text-gold-bright" : "text-cyan-bright",
              ].join(" ")}
            >
              {t(offer.cta)} →
            </span>
          </a>
        ))}
      </div>

      <ul className="mt-2 flex flex-wrap items-center gap-1.5 sm:mt-3 sm:gap-2">
        {TRUST_CHIPS.map((chip) => {
          const Icon = TRUST_ICON[chip.id];
          return (
            <li
              key={chip.id}
              title={chip.detail}
              className="flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-muted sm:px-2.5 sm:py-1 sm:text-[10.5px]"
            >
              <Icon className="size-3 text-profit" aria-hidden />
              {t(chip.i18n)}
            </li>
          );
        })}
        <li className="mono ml-auto hidden text-[10px] text-muted/60 sm:block">Base Mainnet · USDC · 8453</li>
      </ul>
    </section>
  );
}
