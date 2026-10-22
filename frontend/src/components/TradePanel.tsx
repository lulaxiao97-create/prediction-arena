"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { ArrowRight, CheckCircle2, Info, Loader2, ShieldAlert, Wallet } from "lucide-react";
import type { ArenaPool } from "@/lib/types";
import { cn, explorerTx, formatProbability, formatUsdc, impliedMultiplier } from "@/lib/format";
import { useI18n } from "@/components/LocaleProvider";
import { useToast } from "@/components/Toast";
import { recordTrade } from "@/hooks/useTradeHistory";
import {
  BOOTSTRAP_CAP_USDC,
  MIN_BET_USDC,
  hasArena,
  useBet,
  useChainGuard,
  useMaxBet,
  useReferrer,
  useUsdc,
} from "@/hooks/usePredictionArena";

const FEE_BPS = 400n;
const BPS = 10_000n;
const QUICK = [5, 10, 25, 50];

export function TradePanel({ pool }: { pool: ArenaPool }) {
  const { t } = useI18n();
  const toast = useToast();
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const referrer = useReferrer();
  const { wrongChain, switchToTarget, switching } = useChainGuard();
  const { data: capData } = useMaxBet(pool.id);
  const { balance } = useUsdc();
  const { bet, step, error, hash, reset } = useBet();

  const [option, setOption] = useState<0 | 1>(0);
  const [amountInput, setAmountInput] = useState("10");
  const toastId = useRef<string | null>(null);
  const recorded = useRef(false);

  const live = hasArena && pool.source === "chain";
  const cap = live && capData ? (capData as bigint) : BOOTSTRAP_CAP_USDC;
  const isBootstrap = cap <= BOOTSTRAP_CAP_USDC;
  const amount = useMemo(() => parseAmount(amountInput) ?? 0n, [amountInput]);
  const balanceValue = (balance.data as bigint | undefined) ?? undefined;

  const fee = (amount * FEE_BPS) / BPS;
  const netStake = amount - fee;
  const side = option === 0 ? pool.option0Pool : pool.option1Pool;
  const totalAfter = pool.totalNetPool + netStake;
  const sideAfter = side + netStake;
  const probability = sideAfter > 0n ? Number(sideAfter) / Number(totalAfter) : 0.5;
  const payout = sideAfter > 0n ? (netStake * totalAfter) / sideAfter : 0n;
  const shares = payout; // pari-mutuel shares are $1-settled, so shares == expected payout
  const multiplier = impliedMultiplier(totalAfter, sideAfter);
  const roi = amount > 0n ? (Number(payout) - Number(amount)) / Number(amount) : 0;

  const tooSmall = amount > 0n && amount < MIN_BET_USDC;
  const tooBig = amount > cap;
  const noBalance = balanceValue !== undefined && amount > balanceValue;
  const invalid = amount === 0n || tooSmall || tooBig || noBalance;
  const pending = step === "approving" || step === "betting" || step === "confirming";
  const done = step === "done";
  const isYes = option === 0;

  // ── staged progress → toast (Step 1: approve, Step 2: confirm) ────────────
  useEffect(() => {
    if (!toastId.current) return;
    if (step === "approving") {
      toast.update(toastId.current, { kind: "loading", title: t("toast.approving"), description: t("toast.approvingBody") });
    } else if (step === "betting" || step === "confirming") {
      toast.update(toastId.current, { kind: "loading", title: t("toast.betting"), description: t("toast.bettingBody"), hash: undefined });
    } else if (step === "done") {
      toast.update(toastId.current, {
        kind: "success",
        title: t("toast.placed"),
        description: t("toast.placedBody"),
        hash,
      });
      if (!recorded.current) {
        recorded.current = true;
        recordTrade({
          poolId: pool.id.toString(),
          title: pool.title,
          option,
          amount: Number(amount) / 1e6,
          txHash: hash,
          source: pool.source === "chain" ? "chain" : "demo",
        });
      }
      toastId.current = null;
    } else if (error) {
      toast.update(toastId.current, { kind: "error", title: t("toast.failed"), description: error });
      toastId.current = null;
    }
  }, [step, error, hash, amount, option, pool.id, pool.title, pool.source, t, toast]);

  async function submit() {
    if (invalid || pending || !live) return;
    recorded.current = false;
    toastId.current = toast.push({ kind: "loading", title: t("toast.approving"), description: t("toast.approvingBody") });
    try {
      await bet({ poolId: pool.id, option, amount, referrer });
      queryClient.invalidateQueries();
    } catch {
      /* surfaced through hook state + toast */
    }
  }

  const stepLabel =
    step === "approving"
      ? t("trade.approving")
      : step === "betting"
        ? t("trade.confirm")
        : step === "confirming"
          ? t("trade.waiting")
          : done
            ? t("trade.opened")
            : t("trade.place");

  return (
    <div
      className={cn(
        "glass sticky top-[86px] flex flex-col gap-3.5 rounded-2xl border p-4 transition-colors duration-300",
        isYes ? "border-profit/25 shadow-[0_0_40px_-24px_rgba(16,185,129,0.75)]" : "border-loss/25 shadow-[0_0_40px_-24px_rgba(239,68,68,0.7)]"
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-ink">{t("trade.panel")}</p>
        <span
          className={cn(
            "mono rounded-md border px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.12em]",
            live ? "border-profit/30 bg-profit/8 text-profit" : "border-white/10 text-muted/70"
          )}
        >
          {live ? "ON-CHAIN" : "DEMO"}
        </span>
      </div>

      {/* outcome selector — colour follows the choice immediately */}
      <div className="grid grid-cols-2 gap-2">
        {([0, 1] as const).map((value) => {
          const active = option === value;
          const yes = value === 0;
          const sidePool = yes ? pool.option0Pool : pool.option1Pool;
          const mult = impliedMultiplier(pool.totalNetPool, sidePool);
          return (
            <button
              key={value}
              onClick={() => setOption(value)}
              aria-pressed={active}
              className={cn(
                "group rounded-xl border px-3 py-2.5 text-left transition-all duration-200 active:scale-[0.98]",
                active
                  ? yes
                    ? "border-profit/70 bg-profit/15 shadow-[0_0_28px_-12px_rgba(16,185,129,0.8)]"
                    : "border-loss/70 bg-loss/15 shadow-[0_0_28px_-12px_rgba(239,68,68,0.8)]"
                  : "border-white/8 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
              )}
            >
              <p className={cn("text-[11px] font-medium", active ? "text-ink" : "text-muted")}>
                {yes ? t("card.yes") : t("card.no")}
              </p>
              <p className={cn("mono text-lg font-semibold", yes ? "text-profit" : "text-loss")}>
                {mult ? `${mult.toFixed(2)}x` : "—"}
              </p>
              <p className="mt-0.5 text-[9.5px] text-muted/65">
                {formatProbability(yes ? Number(pool.option0Pool) / Number(pool.totalNetPool || 1n) : Number(pool.option1Pool) / Number(pool.totalNetPool || 1n))}
              </p>
            </button>
          );
        })}
      </div>

      {/* amount */}
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>{t("trade.amount")}</span>
          <span className="mono">
            {t("trade.balance")} {balanceValue !== undefined ? `$${formatUsdc(balanceValue)}` : "—"}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <input
            value={amountInput}
            onChange={(e) => setAmountInput(sanitize(e.target.value))}
            inputMode="decimal"
            placeholder="0.00"
            className="mono w-full bg-transparent text-2xl font-semibold text-ink outline-none placeholder:text-muted/40"
          />
          <span className="text-sm font-medium text-muted">USDC</span>
        </div>
        <div className="mt-2 flex gap-1.5">
          {QUICK.map((quick) => {
            const disabled = BigInt(quick) * 1_000_000n > cap;
            const selected = amountInput === String(quick);
            return (
              <button
                key={quick}
                disabled={disabled}
                onClick={() => setAmountInput(String(quick))}
                className={cn(
                  "mono flex-1 rounded-lg border px-2 py-1 text-[11px] transition-all active:scale-95",
                  disabled
                    ? "cursor-not-allowed border-white/5 text-muted/30"
                    : selected
                      ? "border-gold/50 bg-gold/12 text-gold-bright"
                      : "border-white/10 text-muted hover:border-gold/40 hover:text-gold-bright"
                )}
              >
                {quick}
              </button>
            );
          })}
        </div>
      </div>

      {/* implied probability */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="text-muted">{t("detail.probability")}</span>
          <span className={cn("mono font-semibold", isYes ? "text-profit" : "text-loss")}>{formatProbability(probability)}</span>
        </div>
        <div className="odds-track flex">
          <div
            className="h-full rounded-l-full bg-gradient-to-r from-profit/70 to-profit transition-[width] duration-300"
            style={{ width: `${Math.max(2, probability * 100)}%` }}
          />
          <div className="h-full flex-1 rounded-r-full bg-gradient-to-r from-loss to-loss/70" />
        </div>
      </div>

      {/* live calculation: shares / payout / ROI / fee */}
      <div className="space-y-1.5 rounded-xl border border-white/6 bg-panel/60 p-2.5 text-[11.5px]">
        <div className="grid grid-cols-2 gap-2">
          <Metric label={t("trade.shares")} value={`${formatUsdc(shares)}`} tone={isYes ? "profit" : "loss"} />
          <Metric label={t("trade.roi")} value={`${roi >= 0 ? "+" : ""}${(roi * 100).toFixed(1)}%`} tone={roi >= 0 ? "profit" : "loss"} />
        </div>
        <Row label={t("trade.fee")} value={`-$${formatUsdc(fee)}`} />
        <Row label={t("trade.netStake")} value={`$${formatUsdc(netStake)}`} />
        <div className="my-1 h-px bg-white/6" />
        <Row label={t("trade.potential")} value={`$${formatUsdc(payout)}`} highlight />
        <Row label={t("trade.odds")} value={multiplier ? `${multiplier.toFixed(2)}x` : "—"} />
      </div>

      {isBootstrap && (
        <p className="flex items-start gap-1.5 rounded-lg border border-gold/25 bg-gold/[0.07] px-2.5 py-2 text-[10.5px] leading-relaxed text-gold-bright/90">
          <ShieldAlert className="mt-0.5 size-3 shrink-0" />
          {t("trade.bootstrap")}
        </p>
      )}

      {!live && (
        <p className="flex items-start gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[10.5px] leading-relaxed text-muted">
          <Info className="mt-0.5 size-3 shrink-0" />
          {t("trade.demoMode")}
        </p>
      )}

      {wrongChain && (
        <button onClick={switchToTarget} disabled={switching} className="btn-ghost w-full text-[12.5px]">
          <Wallet className="size-3.5" />
          {switching ? "…" : t("trade.switchChain")}
        </button>
      )}

      {error && <p className="rounded-lg border border-loss/30 bg-loss/10 px-2.5 py-2 text-[11px] text-loss">{error}</p>}
      {tooSmall && !error && <p className="text-[11px] text-loss">{t("trade.belowMin")}</p>}
      {tooBig && !error && <p className="text-[11px] text-loss">{t("trade.aboveCap", { cap: formatUsdc(cap, 0) })}</p>}
      {noBalance && !error && <p className="text-[11px] text-loss">{t("trade.insufficient")}</p>}

      {done && hash ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-[11.5px] text-profit">
            <CheckCircle2 className="size-3.5" /> {t("trade.opened")}
          </p>
          <a
            href={explorerTx(hash)}
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg border border-white/10 px-3 py-2 text-center text-[11.5px] text-gold-bright transition-colors hover:border-gold/40"
          >
            {t("trade.viewTx")}
          </a>
          <button onClick={reset} className="btn-ghost w-full text-[12px]">
            {t("trade.done")}
          </button>
        </div>
      ) : (
        <button
          onClick={submit}
          disabled={!live || !address || invalid || pending}
          className={cn(
            "w-full rounded-xl border py-2.5 text-[13px] font-semibold transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55",
            isYes
              ? "border-profit/50 bg-profit/15 text-profit hover:bg-profit/25"
              : "border-loss/50 bg-loss/15 text-loss hover:bg-loss/25"
          )}
        >
          {pending ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-4 animate-spin" /> {stepLabel}
            </span>
          ) : !address ? (
            <span className="inline-flex items-center gap-1.5">
              <Wallet className="size-4" /> {t("trade.connectFirst")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              {stepLabel} · {isYes ? t("card.yes") : t("card.no")} <ArrowRight className="size-4" />
            </span>
          )}
        </button>
      )}

      <p className="text-[10px] leading-relaxed text-muted/60">{t("trade.oneClick")}</p>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "profit" | "loss" }) {
  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-[0.08em] text-muted/70">{label}</p>
      <p className={cn("mono mt-0.5 text-[13px] font-semibold", tone === "profit" ? "text-profit" : "text-loss")}>{value}</p>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={cn("mono", highlight ? "font-semibold text-gold-bright" : "text-ink")}>{value}</span>
    </div>
  );
}

function sanitize(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  const decimals = rest.join("").slice(0, 6);
  return rest.length > 0 ? `${whole}.${decimals}` : whole;
}

function parseAmount(value: string): bigint | null {
  if (!value || value === ".") return null;
  const [whole, decimals = ""] = value.split(".");
  const padded = (decimals + "000000").slice(0, 6);
  try {
    return BigInt(whole || "0") * 1_000_000n + BigInt(padded || "0");
  } catch {
    return null;
  }
}
