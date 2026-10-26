"use client";

import { BrainCircuit, Radio, ShieldCheck } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";

/**
 * Hero masthead — the one place the platform says what it is.
 *
 * Sits directly above the featured market and stays deliberately thin: a kicker, one
 * slogan, one proof line, and three evidence chips. It is not a marketing block that
 * pushes the product below the fold — on a 390px phone the headline is ~70px tall and
 * the sub-line is dropped, so the featured market still starts inside the first screen.
 *
 * Every claim here is one the rest of the app can back up: the feeds are the ones
 * `scripts/fetch-prices.ts` actually reads, settlement is native USDC on Base, and the
 * agents are the ones rendered in the debate section.
 */
export function HeroMasthead() {
  const { t } = useI18n();

  const proofs = [
    { k: "slogan.chip1", Icon: Radio, tone: "text-profit" },
    { k: "slogan.chip2", Icon: ShieldCheck, tone: "text-gold" },
    { k: "slogan.chip3", Icon: BrainCircuit, tone: "text-cyan-bright" },
  ] as const;

  return (
    <section className="mb-4 flex min-w-0 flex-col gap-3 xl:mb-5 xl:flex-row xl:items-end xl:justify-between xl:gap-8">
      <div className="min-w-0">
        <p className="mono flex items-center gap-2 text-[9px] uppercase tracking-[0.24em] text-cyan-bright/80 sm:text-[9.5px] sm:tracking-[0.28em]">
          <span className="relative flex size-1.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-profit/60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-profit shadow-[0_0_8px_2px_rgba(16,185,129,0.45)]" />
          </span>
          <span className="truncate">{t("slogan.kicker")}</span>
        </p>

        <h1 className="mt-2 text-balance text-[19px] font-bold leading-[1.16] tracking-[-0.01em] text-ink sm:text-[24px] xl:text-[27px]">
          {t("slogan.lineA")} <span className="gold-text">{t("slogan.lineB")}</span>
        </h1>

        <p className="mt-2 hidden max-w-[62rem] text-[12px] leading-relaxed text-muted sm:block sm:text-[12.5px]">
          {t("slogan.sub")}
        </p>
      </div>

      <ul className="no-scrollbar -mx-4 flex shrink-0 flex-wrap items-center gap-1.5 px-4 sm:mx-0 sm:flex-nowrap sm:px-0 xl:justify-end">
        {proofs.map(({ k, Icon, tone }) => (
          <li
            key={k}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.025] px-2.5 py-1.5 text-[10.5px] text-muted backdrop-blur-sm"
          >
            <Icon className={`size-3 ${tone}`} />
            <span className="whitespace-nowrap">{t(k)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
