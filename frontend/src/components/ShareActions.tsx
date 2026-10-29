"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Ghost, Link2 } from "lucide-react";
import { useAccount } from "wagmi";
import { cn } from "@/lib/format";
import {
  copyText,
  marketUrl,
  payoutMultiple,
  shareBar,
  trackedMarketUrl,
  tweetIntent,
  warpcastIntent,
  type ShareMarketData,
} from "@/lib/share";
import { shareableRef } from "@/lib/referral";
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
  const { address } = useAccount();

  const yes = Math.round(Math.min(1, Math.max(0, yesPct)) * 100);
  const no = 100 - yes;

  /**
   * A connected wallet shares *its own* link. The contract pays the address inside `ref`, so the
   * generic `ref=x` tag is correct only for a visitor with no wallet — it credits the channel,
   * not the person who did the sharing, and nobody shares for free.
   */
  // No wallet connected → fall back to the channel tag (ref=x), which is what analytics expects.
  const refCode = address ? shareableRef(address) : undefined;

  // The anchor carries attribution; the clipboard button uses `copyHref` below.
  const url = useMemo(() => trackedMarketUrl(marketId, "x", undefined, refCode), [marketId, refCode]);
  const castUrl = useMemo(
    () => trackedMarketUrl(marketId, "farcaster", undefined, refCode),
    [marketId, refCode],
  );
  // The tweet carries attribution (`utm_*` + the sharer's ref) so a shared market can be traced
  // back to the post that sent the visitor; the copied link carries the ref but no channel guess.
  const intent = useMemo(
    () => tweetIntent({ title, yes, no, url, market, id: marketId }),
    [title, yes, no, url, market, marketId],
  );
  // Farcaster has no hook array; the cast is short by construction (320 chars).
  const castIntent = useMemo(() => {
    const cast = `🏴 "${title.length > 88 ? `${title.slice(0, 87).trimEnd()}…` : title}"\n\nYES ${shareBar(yes)} ${yes}% · ${payoutMultiple(yes).toFixed(1)}×\nNO ${shareBar(no)} ${no}%\n\nPick a side.`;
    return warpcastIntent(cast, castUrl);
  }, [title, yes, no, castUrl]);
  // The tweet text embeds the live probability, and the market's pools are refreshed on the
  // client right after mount — so the server's href and the browser's would differ in the
  // percentages. Until mount, the anchor points at the market itself; from the first effect
  // on it carries the intent. Both sides then render the same attribute on the hydration pass.
  const mounted = useMounted();
  const shareHref = mounted ? intent : url;
  const castHref = mounted ? castIntent : castUrl;
  // Copy hands out the sharer's credited link, not a bare market URL: a pasted link is the most
  // common way a position gets shared into a group chat, and it should pay the person who pasted it.
  const copyHref = useMemo(
    () => trackedMarketUrl(marketId, "copy", undefined, refCode),
    [marketId, refCode],
  );

  const onCopy = useCallback(async () => {
    select();
    const ok = await copyText(copyHref);
    if (!ok) {
      toast.push({ kind: "error", title: t("marketing.copyFailed"), description: copyHref });
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
  }, [copyHref, toast, t]);

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
        <a
          href={castHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => select()}
          aria-label={t("marketing.shareCast")}
          title={t("marketing.shareCast")}
          className="grid size-8 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-muted transition-all hover:border-[#8A63D2]/50 hover:text-[#B49BEA] active:scale-90"
        >
          <Ghost className="size-3.5" />
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
      <a
        href={castHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => select()}
        aria-label={t("marketing.shareCast")}
        title={t("marketing.shareCast")}
        className="group inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.02] px-3 py-2 text-[11.5px] font-medium text-muted transition-all hover:border-[#8A63D2]/50 hover:text-[#B49BEA] active:scale-[0.97]"
      >
        <Ghost className="size-3" />
        {t("marketing.shareCast")}
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
