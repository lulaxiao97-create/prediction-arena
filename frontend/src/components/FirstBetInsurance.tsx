"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";

/**
 * First-bet insurance.
 *
 * The single blocker on an empty board is not "the number looks small" — it is "if I am first, I am
 * first to lose". This banner answers that with a real, bounded promise: the operator reimburses the
 * loss on a first position, up to `cap` USDC, for the first 100 addresses. It is paid by transfer
 * from the operator wallet (visible on Basescan), not by the contract, and it is capped in the copy
 * rather than in the small print.
 *
 * Rendered only when NEXT_PUBLIC_FIRST_BET_INSURANCE_USDC is set: a promise nobody funded must not
 * appear on the page.
 */
export function FirstBetInsurance() {
  const cap = Number(process.env.NEXT_PUBLIC_FIRST_BET_INSURANCE_USDC ?? "0");
  if (!Number.isFinite(cap) || cap <= 0) return null;

  return (
    <div
      role="region"
      aria-label="First bet insurance"
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-profit/25 bg-profit/[0.06] px-4 py-2.5"
    >
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-profit">
        <ShieldCheck className="size-3.5" />
        First 100 bets are insured
      </span>
      <span className="text-[11.5px] leading-relaxed text-muted/85">
        If your first position loses, we reimburse the loss up to{" "}
        <span className="mono text-ink">${cap.toFixed(2)}</span> — paid by transfer from the operator
        wallet, visible on Basescan. One address, one position, first come.
      </span>
      <Link
        href="#markets"
        className="ml-auto text-[11.5px] font-medium text-gold-bright underline decoration-dotted underline-offset-4 hover:opacity-80"
      >
        Take the first side →
      </Link>
    </div>
  );
}
