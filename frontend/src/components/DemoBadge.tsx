"use client";

import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/format";
import { useI18n } from "@/components/LocaleProvider";

/**
 * Says out loud what the contract state already implies: these markets are priced from the
 * manifest, not from escrowed USDC. Early visitors get the product tour without ever
 * mistaking a simulated position for a funded one — which is both the honest framing and,
 * for a venue asking people to trust it with money later, the more credible one.
 */
export function DemoBadge({
  variant = "banner",
  className,
}: {
  variant?: "banner" | "chip";
  className?: string;
}) {
  const { t } = useI18n();

  if (variant === "chip") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/[0.08] px-2 py-0.5 text-[10px] font-medium text-gold-bright",
          className
        )}
        title={t("marketing.demoBadgeBody")}
      >
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-gold-bright opacity-70" />
          <span className="relative inline-flex size-1.5 rounded-full bg-gold-bright" />
        </span>
        {t("marketing.demoBadge")}
      </span>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl border border-gold/25 bg-gradient-to-r from-gold/[0.1] via-gold/[0.05] to-transparent px-2.5 py-2",
        className
      )}
      role="status"
    >
      <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-gold-bright" />
      <div className="min-w-0 leading-tight">
        <p className="text-[11px] font-semibold text-gold-bright">{t("marketing.demoBadge")}</p>
        <p className="mt-0.5 text-[10px] leading-snug text-muted">{t("marketing.demoBadgeBody")}</p>
      </div>
      <span className="ml-auto shrink-0 self-center rounded-md border border-gold/25 bg-void/40 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-gold-bright/80">
        {t("marketing.demoTag")}
      </span>
    </div>
  );
}
