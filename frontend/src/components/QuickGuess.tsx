"use client";

/**
 * Zero-friction prediction: no wallet, no USDC, no approval.
 *
 * Why this exists. Every growth post-mortem in this category lands on the same number — "people who
 * deposited and traded", not impressions. The gate in front of that number is four steps of wallet
 * plumbing, and each step loses people who were only ever curious. A visitor who wants to say "I
 * think the Fed holds" should be able to say it in one tap.
 *
 * So this records intent, not money:
 *   · the pick lives in localStorage, keyed by pool id
 *   · nothing is transmitted, nothing is signed, no address is required
 *   · the aggregate count is NOT shown, because with no server there is no honest count to show —
 *     inventing one would be the exact lie this venue is built to avoid
 *
 * The stakeable YES/NO buttons are untouched; this sits beside them as the low-commitment door.
 */
import { useCallback, useEffect, useState } from "react";
import type { ArenaPool } from "@/lib/types";

type Side = "yes" | "no";

const keyFor = (id: string) => `pa.guess.${id}`;

export function QuickGuess({ pool }: { pool: ArenaPool }) {
  const [guess, setGuess] = useState<Side | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(keyFor(String(pool.id)));
      if (v === "yes" || v === "no") setGuess(v);
    } catch {
      /* private mode: the feature degrades to a no-op, never an error */
    }
  }, [pool.id]);

  const pick = useCallback(
    (side: Side) => {
      setGuess(side);
      try {
        window.localStorage.setItem(keyFor(String(pool.id)), side);
      } catch {
        /* ignore */
      }
    },
    [pool.id]
  );

  const pct = Math.round((pool.option0Pool > 0n
    ? Number(pool.option0Pool) / Math.max(1, Number(pool.totalNetPool))
    : 0.5) * 100);

  const share = useCallback(async () => {
    const url = `${window.location.origin}/market/${pool.id}`;
    const text = `I think ${guess === "yes" ? "YES" : "NO"} on "${pool.title}" — the board has it at ${guess === "yes" ? pct : 100 - pct}%.`;
    try {
      if (navigator.share) {
        await navigator.share({ text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      /* user dismissed the sheet, or clipboard is blocked — both are fine */
    }
  }, [guess, pool.id, pool.title, pct]);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/8 bg-black/25 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted/70">
            No wallet needed
          </span>
          <span className="text-[12px] text-muted">
            {guess ? "Your call is saved on this device." : "Just take a side — no money, no wallet."}
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => pick("yes")}
            aria-pressed={guess === "yes"}
            className={`rounded-full px-4 py-2 text-[12px] font-semibold transition ${
              guess === "yes"
                ? "bg-emerald-500 text-black"
                : "border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
            }`}
          >
            I say yes
          </button>
          <button
            type="button"
            onClick={() => pick("no")}
            aria-pressed={guess === "no"}
            className={`rounded-full px-4 py-2 text-[12px] font-semibold transition ${
              guess === "no"
                ? "bg-rose-500 text-black"
                : "border border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
            }`}
          >
            I say no
          </button>
        </div>
      </div>
      {guess ? (
        <button
          type="button"
          onClick={share}
          className="w-fit text-[11.5px] text-gold-bright underline decoration-dotted underline-offset-4 hover:opacity-80"
        >
          {copied ? "Copied — paste it anywhere" : "Share your call"}
        </button>
      ) : null}
    </div>
  );
}
