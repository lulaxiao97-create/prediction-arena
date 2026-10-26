"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useReadContracts } from "wagmi";
import {
  ArrowUpRight,
  Coins,
  History,
  Loader2,
  RefreshCw,
  Undo2,
  Wallet,
  X,
} from "lucide-react";
import type { Address } from "viem";
import { useI18n } from "@/components/LocaleProvider";
import { RewardsPanel } from "@/components/RewardsPanel";
import { Logo } from "@/components/Logo";
import { useToast } from "@/components/Toast";
import { useMarkets } from "@/hooks/useMarkets";
import { useTradeHistory, clearTradeHistory } from "@/hooks/useTradeHistory";
import {
  ARENA_ABI,
  ARENA_ADDRESS,
  hasArena,
  useClaimRefund,
  useClaimRewards,
} from "@/hooks/usePredictionArena";
import { categoryI18nKey } from "@/lib/categories";
import { cn, explorerTx, formatUsdc, shortAddr } from "@/lib/format";
import type { ArenaPool } from "@/lib/types";

type Row = {
  pool: ArenaPool;
  stake0: bigint;
  stake1: bigint;
  reward: bigint;
  refund: bigint;
};

export function PortfolioDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  // The drawer lives inside <header>, whose backdrop-filter makes it a containing block for
  // `position: fixed` — so `inset-y-0` resolved against the 125px header instead of the
  // viewport. Portalling to <body> puts it back on the viewport.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const { pools } = useMarkets();
  const { rows: history } = useTradeHistory();
  const claimRewards = useClaimRewards();
  const claimRefund = useClaimRefund();

  const chainPools = useMemo(() => pools.filter((p) => p.source === "chain"), [pools]);

  const contracts = useMemo(
    () =>
      chainPools.flatMap((pool) => [
        { address: ARENA_ADDRESS as Address, abi: ARENA_ABI, functionName: "getStake", args: [pool.id, address] },
        { address: ARENA_ADDRESS as Address, abi: ARENA_ABI, functionName: "pendingRewards", args: [pool.id, address] },
        { address: ARENA_ADDRESS as Address, abi: ARENA_ABI, functionName: "pendingRefund", args: [pool.id, address] },
      ]),
    [chainPools, address]
  );

  const { data, refetch, isFetching } = useReadContracts({
    // Three different reads per pool share one array, so the union wagmi infers is not
    // assignable to its own `contracts` parameter. The shape below is that union.
    contracts: contracts as unknown as ReadonlyArray<{
      address: Address;
      abi: typeof ARENA_ABI;
      functionName: string;
      args: readonly unknown[];
    }>,
    query: { enabled: Boolean(open && address && hasArena && chainPools.length > 0), refetchInterval: 20_000 },
  });

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const reads = data as { result?: unknown }[];
    return chainPools
      .map((pool, i) => {
        const stake = reads[i * 3]?.result as readonly [bigint, bigint] | undefined;
        const reward = (reads[i * 3 + 1]?.result as bigint | undefined) ?? 0n;
        const refund = (reads[i * 3 + 2]?.result as bigint | undefined) ?? 0n;
        return {
          pool,
          stake0: stake?.[0] ?? 0n,
          stake1: stake?.[1] ?? 0n,
          reward,
          refund,
        };
      })
      .filter((row) => row.stake0 > 0n || row.stake1 > 0n || row.reward > 0n || row.refund > 0n);
  }, [data, chainPools]);

  const claimableTotal = rows.reduce((sum, row) => sum + row.reward + row.refund, 0n);
  const exposure = rows.reduce((sum, row) => sum + row.stake0 + row.stake1, 0n);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  async function claim(row: Row) {
    const id = toast.push({
      kind: "loading",
      title: row.reward > 0n ? t("toast.claimed") : t("toast.refunded"),
      description: t("toast.bettingBody"),
    });
    try {
      if (row.reward > 0n) await claimRewards.claim(row.pool.id);
      else await claimRefund.refund(row.pool.id);
      toast.update(id, { kind: "success", title: row.reward > 0n ? t("toast.claimed") : t("toast.refunded"), description: row.reward > 0n ? t("toast.claimedBody") : t("toast.refundedBody") });
      queryClient.invalidateQueries();
      refetch();
    } catch (e) {
      toast.update(id, {
        kind: "error",
        title: t("toast.failed"),
        description: String((e as Error)?.message ?? e).split("\n")[0].slice(0, 120),
      });
    }
  }

  if (!portalReady) return null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        aria-hidden={!open}
        className={cn(
          "fixed inset-0 z-[55] bg-void/70 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <aside
        role="dialog"
        aria-label={t("portfolio.title")}
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-[56] flex w-[min(100vw,440px)] flex-col border-l border-white/10 bg-void-elevated transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <header className="flex items-center gap-2 border-b border-white/8 px-4 py-3.5">
          <Logo size={22} />
          <p className="text-[13.5px] font-semibold text-ink">{t("portfolio.title")}</p>
          <span className="mono ml-1 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-muted">
            {address ? shortAddr(address, 4) : "—"}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto grid size-7 place-items-center rounded-lg border border-white/8 text-muted transition-colors hover:border-white/20 hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* rewards ledger — points, tickets and the $1 practice book. Works without a wallet,
              because watching an ad has nothing to do with signing anything. */}
          <RewardsPanel />

          {!address && (
            <div className="rounded-xl border border-gold/25 bg-gold/[0.06] px-3 py-6 text-center">
              <p className="text-[12.5px] font-medium text-gold-bright">{t("trade.connectFirst")}</p>
            </div>
          )}

          {/* claimable */}
          <section>
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{t("portfolio.claimable")}</p>
              <span className="mono text-[15px] font-semibold text-profit">${formatUsdc(claimableTotal)}</span>
            </div>
            <div className="mt-2 space-y-1.5">
              {rows.filter((row) => row.reward > 0n || row.refund > 0n).length === 0 ? (
                <p className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-3 text-[11px] text-muted">
                  {t("state.noWinnings")}
                </p>
              ) : (
                rows
                  .filter((row) => row.reward > 0n || row.refund > 0n)
                  .map((row) => (
                    <div
                      key={`claim-${row.pool.id}`}
                      className="flex items-center gap-2 rounded-lg border border-profit/20 bg-profit/[0.04] px-2.5 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11.5px] font-medium text-ink">{row.pool.title}</p>
                        <p className="text-[10px] text-muted">
                          {row.reward > 0n ? t("state.claimWinnings") : t("state.claimRefund")} ·{" "}
                          <span className="mono text-profit">${formatUsdc(row.reward > 0n ? row.reward : row.refund)}</span>
                        </p>
                      </div>
                      <button
                        onClick={() => claim(row)}
                        disabled={claimRewards.pending || claimRefund.pending}
                        className="shrink-0 rounded-md border border-profit/40 bg-profit/12 px-2.5 py-1 text-[11px] font-semibold text-profit transition-colors hover:bg-profit/20 disabled:opacity-60"
                      >
                        {claimRewards.pending || claimRefund.pending ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : row.reward > 0n ? (
                          <Coins className="size-3" />
                        ) : (
                          <Undo2 className="size-3" />
                        )}
                      </button>
                    </div>
                  ))
              )}
            </div>
          </section>

          {/* positions */}
          <section>
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{t("portfolio.positions")}</p>
              <span className="mono text-[11px] text-muted">
                {t("portfolio.total")} <span className="text-ink">${formatUsdc(exposure)}</span>
              </span>
            </div>
            <div className="mt-2 space-y-1.5">
              {!address ? null : rows.length === 0 ? (
                <div className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-4 text-center">
                  <p className="text-[11px] text-muted">{t("portfolio.noPositions")}</p>
                  <Link
                    href="/#markets"
                    onClick={onClose}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] text-gold-bright hover:underline"
                  >
                    {t("portfolio.browse")} <ArrowUpRight className="size-3" />
                  </Link>
                </div>
              ) : (
                rows.map((row) => (
                  <Link
                    key={`pos-${row.pool.id}`}
                    href={`/market/${row.pool.id.toString()}`}
                    onClick={onClose}
                    className="block rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-2 transition-colors hover:border-gold/30 hover:bg-white/[0.04]"
                  >
                    <p className="truncate text-[11.5px] font-medium text-ink">{row.pool.title}</p>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                      <span className="chip !px-1.5 !py-0 text-[9px]">{t(categoryI18nKey(row.pool.category))}</span>
                      {row.stake0 > 0n && (
                        <span className="text-profit">
                          {t("card.yes")} <span className="mono">${formatUsdc(row.stake0)}</span>
                        </span>
                      )}
                      {row.stake1 > 0n && (
                        <span className="text-loss">
                          {t("card.no")} <span className="mono">${formatUsdc(row.stake1)}</span>
                        </span>
                      )}
                      <span className="ml-auto">
                        {row.pool.status === 2 ? t("card.settled") : row.pool.status === 3 ? t("card.voided") : t("card.implied")}
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </section>

          {/* local history */}
          <section>
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-muted">
                <History className="size-3" /> {t("portfolio.history")}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => refetch()}
                  aria-label="Refresh"
                  className="grid size-6 place-items-center rounded-md border border-white/8 text-muted transition-colors hover:border-white/20 hover:text-ink"
                >
                  <RefreshCw className={cn("size-3", isFetching && "animate-spin")} />
                </button>
                {history.length > 0 && (
                  <button
                    onClick={() => clearTradeHistory()}
                    className="rounded-md border border-white/8 px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:border-loss/40 hover:text-loss"
                  >
                    clear
                  </button>
                )}
              </div>
            </div>

            <div className="mt-2 space-y-1">
              {history.length === 0 ? (
                <p className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-3 text-[11px] text-muted">
                  {t("portfolio.noHistory")}
                </p>
              ) : (
                history.slice(0, 12).map((row) => (
                  <div key={row.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10.5px] text-muted hover:bg-white/[0.03]">
                    <span className={cn("mono font-semibold", row.option === 0 ? "text-profit" : "text-loss")}>
                      {row.option === 0 ? t("card.yes") : t("card.no")}
                    </span>
                    <span className="truncate">{row.title}</span>
                    <span className="mono ml-auto text-ink">${formatUsdc(BigInt(Math.round(row.amount * 1e6)))}</span>
                    {row.txHash ? (
                      <a
                        href={explorerTx(row.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gold-bright hover:underline"
                      >
                        <ArrowUpRight className="size-3" />
                      </a>
                    ) : (
                      <span className="text-[9px] text-muted/50">local</span>
                    )}
                  </div>
                ))
              )}
            </div>
            <p className="mt-2 text-[9.5px] leading-relaxed text-muted/50">{t("portfolio.localNote")}</p>
          </section>
        </div>
      </aside>
    </>,
    document.body,
  );
}
