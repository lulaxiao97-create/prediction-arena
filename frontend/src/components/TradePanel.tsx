"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useAccount, useBalance } from "wagmi";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Coins, ExternalLink, Fuel, Info, Loader2, ShieldAlert, Ticket, Wallet } from "lucide-react";
import type { ArenaPool } from "@/lib/types";
import { cn, explorerTx, formatProbability, formatUsdc, impliedMultiplier } from "@/lib/format";
import { quickAmountsFor, resolveTradeGuard } from "@/lib/trade-guard";
import { AmountSlider } from "@/components/AmountSlider";
import { DemoBadge } from "@/components/DemoBadge";
import { ShareActions } from "@/components/ShareActions";
import { select as hapticSelect } from "@/lib/haptics";
import { useI18n } from "@/components/LocaleProvider";
import { useRewards } from "@/components/RewardsProvider";
import { TICKET_CENTS, usd } from "@/lib/rewards";
import { useToast } from "@/components/Toast";
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

export function TradePanel({ pool, sticky = true }: { pool: ArenaPool; sticky?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const referrer = useReferrer();
  const { wrongChain, switchToTarget, switching } = useChainGuard();
  const { data: capData } = useMaxBet(pool.id);
  const { balance } = useUsdc();
  // Native ETH, not USDC: the bet() call costs ~149k gas, so a wallet with USDC and zero ETH
  // still cannot transact. Checked separately so the CTA can say which one is missing.
  const { data: ethBalance } = useBalance({ address, query: { enabled: Boolean(address) } });
  const { bet, step, error, hash, reset } = useBet();
  const { view: rewards, stake: stakeTicket, openAd } = useRewards();
  /** rail A = USDC on Base, rail B = a $1 ticket tracked in the rewards ledger */
  const [track, setTrack] = useState<"usdc" | "ticket">("usdc");
  const [ticketPending, setTicketPending] = useState(false);

  const [option, setOption] = useState<0 | 1>(0);
  const [amountInput, setAmountInput] = useState("50");
  const toastId = useRef<string | null>(null);
  const recorded = useRef(false);

  const live = hasArena && pool.source === "chain";
  const cap = live && capData ? (capData as bigint) : MAX_BET_USDC;
  const amount = useMemo(() => parseAmount(amountInput) ?? 0n, [amountInput]);
  const quickAmounts = useMemo(() => quickAmountsFor(cap), [cap]);
  const [capHintOpen, setCapHintOpen] = useState(false);
  const tickets = rewards?.tickets ?? 0;
  const ticketMode = track === "ticket";
  // A ticket buys `1/prob` $1 shares at the market's current implied price — the same
  // pari-mutuel maths as a USDC stake, just with a fixed $1 notional.
  const marketProb = Math.min(0.99, Math.max(0.01, Number(option === 0 ? pool.option0Pool : pool.option1Pool) / Math.max(1, Number(pool.totalNetPool)) || 0.5));
  const ticketPayoutCents = Math.round(TICKET_CENTS / marketProb);
  const marketOpen = pool.status === 1;
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
  const ethValue = ethBalance?.value;
  const GAS_FLOOR = 20_000_000_000_000n; // 0.00002 ETH — ~13 bets at 0.01 gwei
  const noGas = Boolean(address) && ethValue !== undefined && ethValue < GAS_FLOOR;
  const emptyUsdc = Boolean(address) && balanceValue !== undefined && balanceValue === 0n;
  const isYes = option === 0;
  const guard = resolveTradeGuard({
    address,
    wrongChain,
    live,
    usdcBalance: balanceValue,
    ethBalance: ethValue,
    amount,
    cap,
    minBet: MIN_BET_USDC,
  });
  const invalid = guard !== "ok";
  const guardView = (() => {
    switch (guard) {
      case "no-wallet":
        return { Icon: Wallet, text: t("trade.connectFirst") };
      case "wrong-chain":
        return { Icon: Wallet, text: t("trade.switchChain") };
      case "demo":
        return { Icon: Info, text: t("trade.demoMode") };
      case "no-usdc":
        return { Icon: AlertTriangle, text: t("trade.depositFirst") };
      case "insufficient-usdc":
        return { Icon: AlertTriangle, text: t("trade.insufficientUsdcBtn") };
      case "no-gas":
        return { Icon: Fuel, text: t("trade.insufficientGas") };
      case "above-cap":
        return { Icon: ShieldAlert, text: t("trade.aboveCap", { cap: formatUsdc(cap, 0) }) };
      case "below-min":
        return { Icon: Info, text: t("trade.belowMin") };
      default:
        return { Icon: ArrowRight, text: t(isYes ? "trade.buyYes" : "trade.buyNo") };
    }
  })();
  const pending = step === "approving" || step === "betting" || step === "confirming";
  const done = step === "done";

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

  async function submitTicket() {
    if (!marketOpen || ticketPending) return;
    if (tickets < 1) {
      openAd();
      return;
    }
    setTicketPending(true);
    const res = await stakeTicket(pool.id.toString(), option);
    setTicketPending(false);
    if (res.ok) {
      toast.push({
        kind: "success",
        title: t("rewards.ticketPlaced"),
        description: t("rewards.ticketPlacedBody", { prob: `${Math.round(marketProb * 100)}%`, payout: usd(ticketPayoutCents) }),
      });
    } else {
      toast.push({ kind: "error", title: t("rewards.ticketFailed"), description: res.error ?? "" });
    }
  }

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
        "glass flex flex-col gap-3.5 rounded-2xl border p-4 transition-colors duration-300",
        // Only the desktop right column wants to stick; inside the mobile sheet the same
        // `top-[86px]` offsets the panel 86px down its own scroll container, leaving a hole.
        sticky && "sticky top-[86px]",
        isYes ? "border-profit/25 shadow-[0_0_40px_-24px_rgba(16,185,129,0.75)]" : "border-loss/25 shadow-[0_0_40px_-24px_rgba(239,68,68,0.7)]"
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-ink">{t("trade.panel")}</p>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "mono rounded-md border px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.12em]",
              live ? "border-profit/30 bg-profit/8 text-profit" : "border-white/10 text-muted/70"
            )}
          >
            {live ? "ON-CHAIN" : "DEMO"}
          </span>
          <ShareActions marketId={pool.id} title={pool.title} yesPct={probability} market={pool.marketData} variant="compact" />
        </div>
      </div>

      {!live && <DemoBadge />}

      {/* payment rail — the ticket rail never touches the contract, so it is available on
          every market and needs no wallet, no gas and no USDC balance */}
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/8 bg-white/[0.02] p-1">
        {([["usdc", t("rewards.railUsdc"), Coins], ["ticket", t("rewards.railTicket"), Ticket]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => { hapticSelect(); setTrack(id); }}
            aria-pressed={track === id}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] font-medium transition-all",
              track === id ? "bg-white/8 text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" : "text-muted hover:text-ink",
            )}
          >
            <Icon className="size-3" /> {label}
          </button>
        ))}
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
              onClick={() => {
                hapticSelect();
                setOption(value);
              }}
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

      {!ticketMode && (<>
      {/* amount */}
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>{t("trade.amount")}</span>
          <span className="mono flex items-center gap-2">
            <span>
              {t("trade.balance")} {balanceValue !== undefined ? `$${formatUsdc(balanceValue)}` : "—"}
            </span>
            {ethValue !== undefined && (
              <span className={cn("inline-flex items-center gap-0.5", noGas ? "text-loss" : "text-muted/60")}>
                <Fuel className="size-2.5" />
                {(Number(ethValue) / 1e18).toFixed(4)}
              </span>
            )}
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
        <div className="mt-2 flex flex-wrap gap-1.5">
          {quickAmounts.map((quick) => {
            const disabled = BigInt(quick) * 1_000_000n > cap;
            const selected = amountInput === String(quick);
            return (
              <button
                key={quick}
                disabled={disabled}
                onClick={() => {
                  hapticSelect();
                  setAmountInput(String(quick));
                }}
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
        <AmountSlider
          value={amount > 0n ? amount : MIN_BET_USDC}
          min={MIN_BET_USDC}
          max={cap > MIN_BET_USDC ? cap : MIN_BET_USDC}
          onChange={(next) => setAmountInput(String(Number(next) / 1_000_000))}
          disabled={pending}
          className="mt-3"
        />
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

      <div className={cn("rounded-xl border px-2.5 py-2", "border-white/8 bg-white/[0.02]")}>
        <div className="flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1 text-muted">
            <ShieldAlert className="size-3" /> {t("trade.cap")}
          </span>
          <span className="mono font-semibold text-ink">${formatUsdc(cap, 0)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted/70">
          <span className="truncate">{t("trade.capWindow", { min: formatUsdc(MIN_BET_USDC, 0), max: formatUsdc(cap, 0) })}</span>
          <button
            onClick={() => setCapHintOpen((v) => !v)}
            className="inline-flex shrink-0 items-center gap-0.5 transition-colors hover:text-gold-bright"
          >
            {t("trade.raiseCap")}
            <ChevronDown className={cn("size-2.5 transition-transform", capHintOpen && "rotate-180")} />
          </button>
        </div>
        {capHintOpen && (
          <div className="mt-2 space-y-1.5 border-t border-white/6 pt-2">
            <p className="text-[10px] leading-relaxed text-muted/85">{t("trade.raiseCapBody")}</p>
            <p className="rounded-md border border-cyan/25 bg-cyan/[0.07] px-2 py-1.5 text-[9.5px] leading-relaxed text-cyan-bright/90">
              {t("trade.capUpgrade")}
            </p>
            <Link
              href="/docs/economics/fees"
              className="inline-flex items-center gap-1 text-[10px] text-gold-bright hover:underline"
            >
              {t("nav.docs")} · Economics <ExternalLink className="size-2.5" />
            </Link>
          </div>
        )}
      </div>

      </>)}

      {ticketMode && (
        <div className="rounded-xl border border-cyan/25 bg-cyan/[0.05] p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] text-cyan-bright/90">
              <Ticket className="size-3.5" /> {t("rewards.ticketUnit")}
            </span>
            <span className="mono rounded-md border border-cyan/30 bg-cyan/10 px-1.5 py-0.5 text-[10px] text-cyan-bright">
              {tickets} {t("rewards.ticketsShort")}
            </span>
          </div>
          <p className="mono mt-2 text-2xl font-semibold text-ink">{usd(TICKET_CENTS)}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[10.5px]">
            <div className="rounded-lg border border-white/6 bg-white/[0.02] px-2 py-1.5">
              <p className="text-[9px] uppercase tracking-[0.08em] text-muted/60">{t("rewards.ticketShares")}</p>
              <p className="mono mt-0.5 text-[12.5px] text-ink">{(TICKET_CENTS / 100 / marketProb).toFixed(2)}</p>
            </div>
            <div className="rounded-lg border border-white/6 bg-white/[0.02] px-2 py-1.5">
              <p className="text-[9px] uppercase tracking-[0.08em] text-muted/60">{t("rewards.ticketPays")}</p>
              <p className="mono mt-0.5 text-[12.5px] text-profit">{usd(ticketPayoutCents)}</p>
            </div>
          </div>
        </div>
      )}

      {!ticketMode && wrongChain && (
        <button onClick={switchToTarget} disabled={switching} className="btn-ghost w-full text-[12.5px]">
          <Wallet className="size-3.5" />
          {switching ? "…" : t("trade.switchChain")}
        </button>
      )}

      {!ticketMode && error && <p className="rounded-lg border border-loss/30 bg-loss/10 px-2.5 py-2 text-[11px] text-loss">{error}</p>}
      {!ticketMode && amount > 0n && payout > 0n && payout < amount && (
        <p className="flex items-start gap-1.5 rounded-lg border border-gold/25 bg-gold/[0.06] px-2.5 py-2 text-[10px] leading-relaxed text-gold-bright/90">
          <Info className="mt-0.5 size-3 shrink-0" />
          {t("trade.thinSideWarning")}
        </p>
      )}

      {!ticketMode && tooBig && !error && guard !== "above-cap" && (
        <p className="text-[11px] text-loss">{t("trade.aboveCap", { cap: formatUsdc(cap, 0) })}</p>
      )}
      {!ticketMode && noBalance && !error && <p className="text-[11px] text-loss">{t("trade.insufficient")}</p>}
      {!ticketMode && (emptyUsdc || noBalance || noGas) && !error && (
        <div className="rounded-lg border border-loss/25 bg-loss/[0.06] px-2.5 py-2 text-[10.5px] leading-relaxed">
          <p className="flex items-start gap-1.5 text-loss/90">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            {t("trade.gasHint")}
          </p>
          <a
            href="https://bridge.base.org/deposit"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-gold-bright transition-colors hover:underline"
          >
            {t("trade.getUsdc")} <ExternalLink className="size-2.5" />
          </a>
        </div>
      )}

      {done && hash ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-[11.5px] text-profit">
            <CheckCircle2 className="size-3.5" /> {t("trade.opened")}
          </p>
          <a
            href={explorerTx(hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-white/10 px-3 py-2 text-center text-[11.5px] text-gold-bright transition-colors hover:border-gold/40"
          >
            {t("trade.viewTx")}
          </a>
          <button onClick={reset} className="btn-ghost w-full text-[12px]">
            {t("trade.done")}
          </button>
        </div>
      ) : ticketMode ? (
        <button
          onClick={() => void submitTicket()}
          disabled={!marketOpen || ticketPending}
          className={cn(
            "w-full rounded-xl border py-2.5 text-[13px] font-semibold transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55",
            "border-cyan/50 bg-cyan/12 text-cyan-bright hover:bg-cyan/20",
          )}
        >
          {ticketPending ? (
            <span className="inline-flex items-center gap-1.5"><Loader2 className="size-4 animate-spin" /> {t("rewards.ticketPending")}</span>
          ) : tickets < 1 ? (
            <span className="inline-flex items-center gap-1.5"><Ticket className="size-4" /> {t("rewards.ticketWatch")}</span>
          ) : (
            <span className="inline-flex items-center gap-1.5"><Ticket className="size-4" /> {t("rewards.ticketCta")}</span>
          )}
        </button>
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
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <guardView.Icon className="size-4" /> {guardView.text}
            </span>
          )}
        </button>
      )}

      <p className="text-[10px] leading-relaxed text-muted/60">{ticketMode ? t("rewards.ticketNote") : t("trade.oneClick")}</p>
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
