"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { cn } from "@/lib/format";
import { copyText, marketUrl, payoutMultiple, trackedMarketUrl, tweetIntent, type ShareMarketData } from "@/lib/share";
import { select, success } from "@/lib/haptics";
import { useI18n } from "@/components/LocaleProvider";
import { useToast } from "@/components/Toast";
import { useMounted } from "@/hooks/useMounted";

/** X's mark (simple-icons path; lucide has no brand glyph). */
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden focusable="false">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function ShareActions({
  marketId,
  title,
  yesPct,
  market,
  variant = "panel",
  className,
}: {
  marketId: string | number | bigint;
  title: string;
  /** 0..1 — rendered as a whole percentage in the tweet. */
  yesPct: number;
  /** Spot/strike/feed for a data-driven market; omitted for editorial ones. */
  market?: ShareMarketData | null;
  variant?: "panel" | "compact";
  className?: string;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const yes = Math.round(Math.min(1, Math.max(0, yesPct)) * 100);
  const no = 100 - yes;

  const url = useMemo(() => marketUrl(marketId), [marketId]);
  // The tweet carries attribution (`utm_*` + `ref`) so a shared market can be traced back to the
  // post that sent the visitor; the copied link stays clean for anywhere else it gets pasted.
  const intent = useMemo(
    () => tweetIntent({ title, yes, no, url: trackedMarketUrl(marketId, "x"), market, id: marketId }),
    [title, yes, no, marketId, market],
  );
  // The tweet text embeds the live probability, and the market's pools are refreshed on the
  // client right after mount — so the server's href and the browser's would differ in the
  // percentages. Until mount, the anchor points at the market itself; from the first effect
  // on it carries the intent. Both sides then render the same attribute on the hydration pass.
  const mounted = useMounted();
  const shareHref = mounted ? intent : url;

  const onCopy = useCallback(async () => {
    select();
    const ok = await copyText(url);
    if (!ok) {
      toast.push({ kind: "error", title: t("marketing.copyFailed"), description: url });
      return;
    }
    success();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
    toast.push({
      kind: "success",
      title: t("marketing.copied"),
      description: t("marketing.copiedBody"),
    });
  }, [url, toast, t]);

  if (variant === "compact") {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <a
          href={shareHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => select()}
          aria-label={t("marketing.shareX")}
          title={t("marketing.shareX")}
          className="grid size-8 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-muted transition-all hover:border-white/25 hover:text-ink active:scale-90"
        >
          <XIcon className="size-3.5" />
        </a>
        <button
          onClick={onCopy}
          aria-label={t("marketing.copyLink")}
          title={t("marketing.copyLink")}
          className="grid size-8 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-muted transition-all hover:border-white/25 hover:text-ink active:scale-90"
        >
          {copied ? <Check className="size-3.5 text-profit" /> : <Link2 className="size-3.5" />}
        </button>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <a
        href={shareHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => select()}
        aria-label={t("marketing.shareX")}
        title={t("marketing.shareX")}
        className="group inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-[11.5px] font-medium text-ink transition-all hover:border-white/30 hover:bg-white/[0.08] active:scale-[0.97]"
      >
        <XIcon className="size-3 transition-transform group-hover:-rotate-6" />
        {t("marketing.shareX")}
      </a>
      <button
        onClick={onCopy}
        aria-live="polite"
        className={cn(
          "group inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[11.5px] font-medium transition-all active:scale-[0.97]",
          copied
            ? "border-profit/40 bg-profit/12 text-profit"
            : "border-white/12 bg-white/[0.02] text-muted hover:border-gold/40 hover:text-gold-bright"
        )}
      >
        {copied ? <Check className="size-3" /> : <Link2 className="size-3 transition-transform group-hover:-rotate-12" />}
        {copied ? t("marketing.copiedShort") : t("marketing.copyLink")}
      </button>
    </div>
  );
}
