"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  ShieldAlert,
  Wallet,
  X,
} from "lucide-react";
import type { ArenaPool } from "@/lib/types";
import {
  cn,
  explorerTx,
  formatProbability,
  formatUsdc,
  impliedMultiplier,
  shortAddr,
} from "@/lib/format";
import { categoryI18nKey } from "@/lib/categories";
import { useI18n } from "@/components/LocaleProvider";
import { useToast } from "@/components/Toast";
import { AmountSlider } from "@/components/AmountSlider";
import { quickAmountsFor, resolveTradeGuard } from "@/lib/trade-guard";
import { recordTrade } from "@/hooks/useTradeHistory";
import {
  MAX_BET_USDC,
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


export function BetModal({
  pool,
  initialOption,
  onClose,
}: {
  pool: ArenaPool;
  initialOption: 0 | 1;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const toastId = useRef<string | null>(null);
  const recorded = useRef(false);
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const referrer = useReferrer();
  const { wrongChain, switchToTarget, switching } = useChainGuard();
  const { data: capData } = useMaxBet(pool.id);
  const { balance } = useUsdc();

  const [option, setOption] = useState<0 | 1>(initialOption);
  const [amountInput, setAmountInput] = useState("50");
  const { bet, step, error, hash, reset } = useBet();

  const cap = hasArena && capData ? (capData as bigint) : MAX_BET_USDC;
  const quickAmounts = useMemo(() => quickAmountsFor(cap), [cap]);
  const parsed = useMemo(() => parseAmount(amountInput), [amountInput]);
  const amount = parsed ?? 0n;
  const balanceValue = (balance.data as bigint | undefined) ?? undefined;

  const netStake = (amount * (BPS - FEE_BPS)) / BPS;
  const fee = amount - netStake;
  const side = option === 0 ? pool.option0Pool : pool.option1Pool;
  const totalAfter = pool.totalNetPool + netStake;
  const sideAfter = side + netStake;
  const multiplier = impliedMultiplier(totalAfter, sideAfter);
  const probability = sideAfter > 0n ? Number(sideAfter) / Number(totalAfter) : 0.5;
  const payout = sideAfter > 0n ? (netStake * totalAfter) / sideAfter : 0n;

  const tooSmall = amount > 0n && amount < MIN_BET_USDC;
  const tooBig = amount > cap;
  const noBalance = balanceValue !== undefined && amount > balanceValue;
  const invalid = amount === 0n || tooSmall || tooBig || noBalance;
  // Sample markets do not exist on-chain — a live bet() would revert, so the button must not lie.
  const tradable = hasArena && pool.source === "chain";
  const pending = step === "approving" || step === "betting" || step === "confirming";
  const done = step === "done";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  useEffect(() => {
    if (done) queryClient.invalidateQueries();
  }, [done, queryClient]);

  useEffect(() => {
    if (!toastId.current) return;
    if (step === "approving") {
      toast.update(toastId.current, { kind: "loading", title: t("toast.approving"), description: t("toast.approvingBody") });
    } else if (step === "betting" || step === "confirming") {
      toast.update(toastId.current, { kind: "loading", title: t("toast.betting"), description: t("toast.bettingBody"), hash: undefined });
    } else if (step === "done") {
      toast.update(toastId.current, { kind: "success", title: t("toast.placed"), description: t("toast.placedBody"), hash });
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

  async function handleSubmit() {
    if (invalid || pending || !tradable) return;
    recorded.current = false;
    toastId.current = toast.push({ kind: "loading", title: t("toast.approving"), description: t("toast.approvingBody") });
    try {
      await bet({ poolId: pool.id, option, amount, referrer });
    } catch {
      /* surfaced through hook state */
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

  const outcomeLabel = option === 0 ? t("card.yes") : t("card.no");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div onClick={onClose} className="absolute inset-0 bg-void/80 backdrop-blur-sm" />

      <div
        className="glass panel-in relative flex max-h-[92dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-3xl border-white/10 p-5 sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip chip-gold">{t(categoryI18nKey(pool.category))}</span>
              {(pool.tags ?? []).slice(0, 2).map((tag) => (
                <span key={tag} className="chip border-white/10 text-[10px] text-muted/85">
                  {tag}
                </span>
              ))}
              {pool.source === "demo" && <span className="chip text-[10px]">{t("card.demo")}</span>}
              {referrer && (
                <span className="chip border-gold/25 text-[10px] text-gold-bright">
                  REF {shortAddr(referrer, 3)}
                </span>
              )}
            </div>
            <h3 className="mt-2 line-clamp-2 text-[15px] font-semibold leading-relaxed text-ink">
              {pool.title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/8 text-muted transition-colors hover:border-white/20 hover:text-ink"
            aria-label={t("trade.done")}
          >
            <X className="size-4" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="size-10 text-profit" />
            <p className="text-sm text-ink">{t("trade.opened")}</p>
            {hash && (
              <a
                href={explorerTx(hash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-gold-bright hover:border-gold/40"
              >
                {t("trade.viewTx")} <ExternalLink className="size-3" />
              </a>
            )}
            <button
              onClick={() => {
                reset();
                onClose();
              }}
              className="btn-gold mt-1 w-full"
            >
              {t("trade.done")}
            </button>
          </div>
        ) : (
          <>
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
                          ? "border-profit/60 bg-profit/12 shadow-[0_0_30px_-12px_rgba(16,185,129,0.7)]"
                          : "border-loss/60 bg-loss/12 shadow-[0_0_30px_-12px_rgba(239,68,68,0.7)]"
                        : "border-white/8 bg-white/[0.02] hover:border-white/20"
                    )}
                  >
                    <p className={cn("text-[11px]", active ? "text-ink" : "text-muted")}>
                      {pool.optionLabels[value]}
                    </p>
                    <p className={cn("mono text-lg font-semibold", isYes ? "text-profit" : "text-loss")}>
                      {mult ? `${mult.toFixed(2)}x` : "—"}
                    </p>
                  </button>
                );
              })}
            </div>

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
                  onChange={(e) => setAmountInput(sanitizeAmount(e.target.value))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="mono w-full bg-transparent text-2xl font-semibold text-ink outline-none placeholder:text-muted/40"
                />
                <span className="text-sm font-medium text-muted">USDC</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {quickAmounts.map((quick) => {
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
              <AmountSlider
                value={parsed && parsed > 0n ? parsed : MIN_BET_USDC}
                min={MIN_BET_USDC}
                max={cap > MIN_BET_USDC ? cap : MIN_BET_USDC}
                onChange={(next) => setAmountInput(String(Number(next) / 1_000_000))}
                disabled={pending}
                className="mt-3"
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
              <span>{t("trade.min")} ${formatUsdc(MIN_BET_USDC, 0)}</span>
              <span className="text-white/15">|</span>
              <span className="inline-flex items-center gap-1">
                <ShieldAlert className="size-3 text-gold" />
                {t("trade.cap")} <span className="mono text-gold-bright">${formatUsdc(cap, 0)}</span>
              </span>
            </div>

            <p className="flex items-start gap-1.5 rounded-lg border border-cyan/25 bg-cyan/[0.06] px-2.5 py-2 text-[10.5px] leading-relaxed text-cyan-bright/90">
              <Info className="mt-0.5 size-3 shrink-0" />
              {t("trade.capWindow", { min: formatUsdc(MIN_BET_USDC, 0), max: formatUsdc(cap, 0) })}
            </p>

            <div className="space-y-1.5 rounded-xl border border-white/6 bg-panel/60 p-3 text-[12px]">
              <Row label={t("trade.fee")} value={`-$${formatUsdc(fee)}`} />
              {referrer && (
                <Row label={t("trade.referral")} value={`$${formatUsdc((fee * 3000n) / 10_000n)}`} muted />
              )}
              <Row label={t("trade.netStake")} value={`$${formatUsdc(netStake)}`} />
              <div className="my-1 h-px bg-white/6" />
              <Row
                label={t("trade.payoutIf", { outcome: outcomeLabel, prob: formatProbability(probability) })}
                value={`≈ $${formatUsdc(payout)}`}
                highlight
              />
            </div>

            {wrongChain && (
              <button onClick={switchToTarget} disabled={switching} className="btn-ghost w-full text-sm">
                <Wallet className="size-4" />
                {switching ? "…" : t("trade.switchChain")}
              </button>
            )}

            {hasArena && !tradable && (
              <p className="flex items-start gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[11px] leading-relaxed text-muted">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                {t("trade.demoMode")}
              </p>
            )}

            {!hasArena && (
              <p className="flex items-start gap-1.5 rounded-lg border border-gold/25 bg-gold/8 px-2.5 py-2 text-[11px] leading-relaxed text-gold-bright/90">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                {t("trade.demoMode")}
              </p>
            )}

            {error && (
              <p className="rounded-lg border border-loss/30 bg-loss/10 px-2.5 py-2 text-[11.5px] text-loss">
                {error}
              </p>
            )}
            {tooSmall && !error && <p className="text-[11.5px] text-loss">{t("trade.belowMin")}</p>}
            {tooBig && !error && (
              <p className="text-[11.5px] text-loss">
                {t("trade.aboveCap", { cap: formatUsdc(cap) })}
              </p>
            )}
            {noBalance && !error && <p className="text-[11.5px] text-loss">{t("trade.insufficient")}</p>}

            <Stepper step={step} labels={[t("trade.approving"), t("trade.confirm"), t("trade.opened")]} />

            <button
              onClick={handleSubmit}
              disabled={!tradable || !address || invalid || pending}
              className="btn-gold w-full text-sm"
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {stepLabel}
                </>
              ) : !address ? (
                <>
                  <Wallet className="size-4" />
                  {t("trade.connectFirst")}
                </>
              ) : (
                <>
                  {stepLabel}
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>

            <p className="text-center text-[10.5px] leading-relaxed text-muted/70">
              {t("trade.oneClick")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  highlight,
}: {
  label: string;
  value: string;
  muted?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={cn("text-[11.5px]", muted ? "text-muted/70" : "text-muted")}>{label}</span>
      <span
        className={cn(
          "mono text-[12px]",
          highlight ? "font-semibold text-gold-bright" : muted ? "text-muted/80" : "text-ink"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function sanitizeAmount(value: string): string {
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

export function BetModalHost({
  pool,
  option,
  onClose,
}: {
  pool: ArenaPool | null;
  option: 0 | 1;
  onClose: () => void;
}) {
  if (!pool) return null;
  return <BetModal key={`${pool.id}-${option}`} pool={pool} initialOption={option} onClose={onClose} />;
}

/** Three-dot progress rail: approve → confirm → done. */
function Stepper({ step, labels }: { step: string; labels: string[] }) {
  const active = step === "approving" ? 0 : step === "betting" || step === "confirming" ? 1 : step === "done" ? 2 : -1;
  if (active < 0) return null;
  return (
    <div className="flex items-center gap-1.5">
      {labels.map((label, i) => (
        <div key={label} className="flex flex-1 items-center gap-1.5">
          <span
            className={
              "grid size-4 shrink-0 place-items-center rounded-full border text-[8px] font-bold transition-colors " +
              (i <= active ? "border-gold/60 bg-gold/20 text-gold-bright" : "border-white/12 text-muted/50")
            }
          >
            {i < active ? "✓" : i + 1}
          </span>
          <span className={"truncate text-[9.5px] " + (i <= active ? "text-gold-bright/90" : "text-muted/50")}>
            {label}
          </span>
          {i < labels.length - 1 && <span className="h-px flex-1 bg-white/10" />}
        </div>
      ))}
    </div>
  );
}
