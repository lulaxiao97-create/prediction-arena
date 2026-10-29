"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Coins } from "lucide-react";
import { useAccount } from "wagmi";
import { useI18n } from "@/components/LocaleProvider";
import { SITE_URL } from "@/lib/site";
import { copyText } from "@/lib/share";
import { inviteLink, shareableRef } from "@/lib/referral";

/**
 * The permanent rakeback banner.
 *
 * Every other growth surface on the landing page asks for something (take a position, watch an ad,
 * connect a wallet). This one pays: `bet()` takes a `referrer` argument, and the contract credits
 * it 30% of the 4% rake at settlement. So the banner is not a campaign with an end date — as long
 * as the contract pays referrers, this strip is true, which is why it is allowed to sit at the top
 * of the page permanently instead of being dismissible.
 *
 * Two actions only: copy my link (works without a wallet, uses the official handle as the ref) and
 * open the portfolio (where the link and its earnings live). Anything more would be a menu.
 */
export function RakebackBanner() {
  const { t } = useI18n();
  const { address } = useAccount();
  const [copied, setCopied] = useState(false);

  const link = useMemo(() => inviteLink(SITE_URL, shareableRef(address)), [address]);

  const onCopy = useCallback(async () => {
    const ok = await copyText(link);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2400);
  }, [link]);

  const openPortfolio = useCallback(() => {
    // The drawer lives inside <Navbar>'s state; a custom event keeps this banner decoupled from it.
    window.dispatchEvent(new CustomEvent("pa:open-portfolio"));
  }, []);

  return (
    <section
      aria-label="Rakeback"
      className="relative mt-3 overflow-hidden rounded-xl border border-gold/30 bg-gradient-to-r from-gold/[0.14] via-gold/[0.06] to-transparent sm:mt-4"
    >
      <div className="flex min-w-0 flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
        <span aria-hidden className="text-[15px] leading-none sm:text-base">
          💰
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold text-ink sm:text-[13px]">
            {t("growth.rakeTitle")}
          </p>
          <p className="text-[11px] leading-snug text-muted sm:text-[11.5px]">{t("growth.rakeBody")}</p>
          <p className="mono mt-0.5 truncate text-[9px] uppercase tracking-[0.1em] text-gold/80">
            {t("growth.rakeTag")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={onCopy}
            aria-live="polite"
            className="inline-flex items-center gap-1 rounded-lg border border-gold/35 bg-gold/10 px-2.5 py-1.5 text-[10.5px] font-semibold text-gold-bright transition-colors hover:bg-gold/15 active:scale-[0.97]"
          >
            {copied ? <Check className="size-3" /> : <Coins className="size-3" />}
            {copied ? t("growth.rakeCopied") : t("growth.rakeCopy")}
          </button>
          <button
            onClick={openPortfolio}
            aria-label={t("growth.rakeCta")}
            className="inline-flex items-center gap-1 rounded-lg border border-white/12 px-2.5 py-1.5 text-[10.5px] font-medium text-muted transition-colors hover:border-white/30 hover:text-ink active:scale-[0.97]"
          >
            {t("growth.rakeCta")}
          </button>
        </div>
      </div>
    </section>
  );
}
