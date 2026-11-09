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
 *   · the pick lives in localStorage, keyed by pool id, with the timestamp it was made
 *   · nothing is transmitted, nothing is signed, no address is required
 *   · the aggregate count is NOT shown, because with no server there is no honest count to show —
 *     inventing one would be the exact lie this venue is built to avoid
 *
 * The stakeable YES/NO buttons are untouched; this sits beside them as the low-commitment door.
 */
import { useCallback, useEffect, useState } from "react";
import type { ArenaPool } from "@/lib/types";

type Side = "yes" | "no";

type Pick = { side: Side; at: number };

const keyFor = (id: string) => `pa.guess.${id}`;

/** Stored as JSON so the resolution check can tell when the call was made. Older entries were a
 * bare "yes"/"no" string; both shapes are accepted. */
function readPick(id: string): Pick | null {
  try {
    const raw = window.localStorage.getItem(keyFor(id));
    if (!raw) return null;
    if (raw === "yes" || raw === "no") return { side: raw, at: 0 };
    const parsed = JSON.parse(raw) as Pick;
    if (parsed?.side === "yes" || parsed?.side === "no") return parsed;
    return null;
  } catch {
    return null;
  }
}

function daysUntil(unixSeconds: number): number {
  return Math.max(0, Math.ceil((unixSeconds * 1000 - Date.now()) / 86_400_000));
}

export function QuickGuess({ pool }: { pool: ArenaPool }) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setPick(readPick(String(pool.id)));
  }, [pool.id]);

  const choose = useCallback(
    (side: Side) => {
      const next: Pick = { side, at: Date.now() };
      setPick(next);
      try {
        window.localStorage.setItem(keyFor(String(pool.id)), JSON.stringify(next));
      } catch {
        /* private mode: the feature degrades to a no-op, never an error */
      }
    },
    [pool.id]
  );

  const yesPct = Math.round(
    (pool.option0Pool > 0n
      ? Number(pool.option0Pool) / Math.max(1, Number(pool.totalNetPool))
      : 0.5) * 100
  );

  // Resolution state. status 2 = settled with a winning option (0 = YES, 1 = NO); status 3 =
  // cancelled, which must not be scored as a win or a loss.
  const settled = pool.status === 2;
  const cancelled = pool.status === 3;
  const outcome: Side | null = settled ? (pool.winningOption === 0 ? "yes" : "no") : null;
  const correct = settled && pick ? outcome === pick.side : null;

  const share = useCallback(async () => {
    if (!pick) return;
    const url = `${window.location.origin}/market/${pool.id}`;
    const side = pick.side === "yes" ? "YES" : "NO";
    const line =
      correct === null
        ? `I say ${side} on "${pool.title}" — the board has it at ${pick.side === "yes" ? yesPct : 100 - yesPct}%.`
        : correct
          ? `Called it: ${side} on "${pool.title}".`
          : `Wrong on this one: I said ${side} on "${pool.title}".`;
    try {
      if (navigator.share) {
        await navigator.share({ text: line, url });
        return;
      }
      await navigator.clipboard.writeText(`${line} ${url}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      /* user dismissed the sheet, or clipboard is blocked — both are fine */
    }
  }, [correct, pick, pool.id, pool.title, yesPct]);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/8 bg-black/25 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted/70">No wallet needed</span>
          <span className="text-[12px] text-muted">
            {!pick
              ? "Just take a side — no money, no wallet."
              : settled
                ? "This market resolved. Your call is above."
                : cancelled
                  ? "This market was cancelled — your call is void."
                  : `Saved on this device. Resolves in ${daysUntil(pool.endTime)}d.`}
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => choose("yes")}
            aria-pressed={pick?.side === "yes"}
            className={`rounded-full px-4 py-2 text-[12px] font-semibold transition ${
              pick?.side === "yes"
                ? "bg-emerald-500 text-black"
                : "border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
            }`}
          >
            I say yes
          </button>
          <button
            type="button"
            onClick={() => choose("no")}
            aria-pressed={pick?.side === "no"}
            className={`rounded-full px-4 py-2 text-[12px] font-semibold transition ${
              pick?.side === "no"
                ? "bg-rose-500 text-black"
                : "border border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
            }`}
          >
            I say no
          </button>
        </div>
      </div>

      {pick ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {settled && correct !== null ? (
            <span
              className={`text-[12px] font-semibold ${correct ? "text-emerald-400" : "text-rose-400"}`}
              role="status"
            >
              {correct ? "You called it." : `Missed — it resolved ${outcome === "yes" ? "YES" : "NO"}.`}
            </span>
          ) : null}
          <button
            type="button"
            onClick={share}
            className="w-fit text-[11.5px] text-gold-bright underline decoration-dotted underline-offset-4 hover:opacity-80"
          >
            {copied ? "Copied — paste it anywhere" : "Share your call"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
