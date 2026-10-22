"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { ArrowRight, CheckCircle2, Info, Loader2, ShieldAlert, Wallet } from "lucide-react";
import type { ArenaPool } from "@/lib/types";
import { cn, explorerTx, formatProbability, formatUsdc, impliedMultiplier } from "@/lib/format";
import { useI18n } from "@/components/LocaleProvider";
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
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const referrer = useReferrer();
  const { wrongChain, switchToTarget, switching } = useChainGuard();
  const { data: capData } = useMaxBet(pool.id);
  const { balance } = useUsdc();
  const { bet, step, error, hash, reset } = useBet();

  const [option, setOption] = useState<0 | 1>(0);
  const [amountInput, setAmountInput] = useState("10");

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
  const multiplier = impliedMultiplier(totalAfter, sideAfter);

  const tooSmall = amount > 0n && amount < MIN_BET_USDC;
  const tooBig = amount > cap;
  const noBalance = balanceValue !== undefined && amount > balanceValue;
  const invalid = amount === 0n || tooSmall || tooBig || noBalance;
  const pending = step === "approving" || step === "betting" || step === "confirming";
  const done = step === "done";

  async function submit() {
    if (invalid || pending || !live) return;
    try {
      await bet({ poolId: pool.id, option, amount, referrer });
      queryClient.invalidateQueries();
    } catch {
      /* surfaced via hook */
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
    <div className="glass sticky top-[86px] flex flex-col gap-3.5 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-ink">{t("trade.panel")}</p>
        <span className="mono text-[10px] uppercase tracking-[0.12em] text-muted/60">
          {pool.source === "chain" ? "ON-CHAIN" : "DEMO"}
        </span>
      </div>

      {/* outcome selector */}
      <div className="grid grid-cols-2 gap-2">
        {([0, 1] as const).map((value) => {
          const active = option === value;
          const isYes = value === 0;
          const sidePool = isYes ? pool.option0Pool : pool.option1Pool;
          const mult = impliedMultiplier(pool.totalNetPool, sidePool);
          return (
            <button
              key={value}
              onClick={() => setOption(value)}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition-all",
                active
                  ? isYes
                    ? "border-profit/60 bg-profit/12"
                    : "border-loss/60 bg-loss/12"
                  : "border-white/8 bg-white/[0.02] hover:border-white/20"
              )}
            >
              <p className={cn("text-[11px]", active ? "text-ink" : "text-muted")}>{isYes ? t("card.yes") : t("card.no")}</p>
              <p className={cn("mono text-lg font-semibold", isYes ? "text-profit" : "text-loss")}>
                {mult ? `${mult.toFixed(2)}x` : "—"}
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
            return (
              <button
                key={quick}
                disabled={disabled}
                onClick={() => setAmountInput(String(quick))}
                className={cn(
                  "mono flex-1 rounded-lg border px-2 py-1 text-[11px] transition-colors",
                  disabled
                    ? "cursor-not-allowed border-white/5 text-muted/40"
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
          <span className="mono font-semibold text-ink">{formatProbability(probability)}</span>
        </div>
        <div className="odds-track flex">
          <div
            className="h-full rounded-l-full bg-gradient-to-r from-profit/70 to-profit transition-[width] duration-300"
            style={{ width: `${Math.max(2, probability * 100)}%` }}
          />
          <div className="h-full flex-1 rounded-r-full bg-gradient-to-r from-loss to-loss/70" />
        </div>
      </div>

      {/* breakdown */}
      <div className="space-y-1.5 rounded-xl border border-white/6 bg-panel/60 p-2.5 text-[11.5px]">
        <Row label={t("trade.fee")} value={`-$${formatUsdc(fee)}`} />
        <Row label={t("trade.netStake")} value={`$${formatUsdc(netStake)}`} />
        <div className="my-1 h-px bg-white/6" />
        <Row
          label={t("trade.payoutIf", {
            outcome: option === 0 ? t("card.yes") : t("card.no"),
            prob: formatProbability(probability),
          })}
          value={`≈ $${formatUsdc(payout)}`}
          highlight
        />
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>{t("trade.odds")}</span>
          <span className="mono text-ink">{multiplier ? `${multiplier.toFixed(2)}x` : "—"}</span>
        </div>
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
            className="block rounded-lg border border-white/10 px-3 py-2 text-center text-[11.5px] text-gold-bright hover:border-gold/40"
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
          className="btn-gold w-full text-[13px]"
        >
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" /> {stepLabel}
            </>
          ) : !address ? (
            <>
              <Wallet className="size-4" /> {t("trade.connectFirst")}
            </>
          ) : (
            <>
              {stepLabel} <ArrowRight className="size-4" />
            </>
          )}
        </button>
      )}

      <p className="text-[10px] leading-relaxed text-muted/60">{t("trade.oneClick")}</p>
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
