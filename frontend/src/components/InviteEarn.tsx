"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Copy, Gift } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { SITE_URL } from "@/lib/site";
import { copyText } from "@/lib/share";
import { inviteLink, shareableRef } from "@/lib/referral";

/**
 * Invite & Earn — the zero-budget side of the growth loop.
 *
 * The payout is not a marketing promise: `bet()` takes a `referrer` argument and pays it a share of
 * the 4% fee out of the fee itself, on-chain. So the copy says "you earn a share of the fee on
 * every bet you bring in, paid by the contract" and never names a dollar figure we do not control.
 *
 * The link uses the connected wallet when there is one (the only ref that can receive USDC) and the
 * official handle otherwise, so a visitor without a wallet can still hand out a working invite that
 * lands in the same campaign bucket.
 */
export function InviteEarn({ address }: { address?: string | null }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const link = useMemo(() => inviteLink(SITE_URL, shareableRef(address)), [address]);
  const shown = useMemo(() => link.replace(/^https?:\/\//, ""), [link]);

  const onCopy = useCallback(async () => {
    const ok = await copyText(link);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  }, [link]);

  return (
    <section className="rounded-xl border border-cyan/20 bg-cyan/[0.04] p-3">
      <div className="flex items-center gap-2">
        <Gift className="size-3.5 shrink-0 text-cyan-bright" aria-hidden />
        <p className="text-[12px] font-semibold text-ink">{t("growth.inviteTitle")}</p>
      </div>
      <p className="mt-1 text-[10.5px] leading-relaxed text-muted">{t("growth.inviteBody")}</p>

      <div className="mt-2 flex items-center gap-1.5">
        <code className="mono min-w-0 flex-1 truncate rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1.5 text-[10px] text-muted">
          {shown}
        </code>
        <button
          onClick={onCopy}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-cyan/30 bg-cyan/10 px-2 py-1.5 text-[10.5px] font-medium text-cyan-bright transition-colors hover:bg-cyan/15"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? t("growth.inviteCopied") : t("growth.inviteCta")}
        </button>
      </div>
    </section>
  );
}
