"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  Coins,
  Fingerprint,
  Globe2,
  Info,
  LayoutGrid,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { AIAgentsDebate } from "@/components/AIAgentsDebate";
import { ArenaCard } from "@/components/ArenaCard";
import { BetModalHost } from "@/components/BetModal";
import { buildDemoPools, defaultStancesFor } from "@/lib/mock-data";
import { ARENA_ADDRESS, hasArena, useChainPoolIds, usePools } from "@/hooks/usePredictionArena";
import { CATEGORY_TABS, matchesTab, type MarketCategory } from "@/lib/categories";
import { cn, explorerAddress, formatCompactUsdc, shortAddr, toUsdcNumber } from "@/lib/format";
import type { ArenaPool } from "@/lib/types";

export default function Home() {
  const [category, setCategory] = useState<MarketCategory>("all");
  const [selected, setSelected] = useState<{ pool: ArenaPool; option: 0 | 1 } | null>(null);

  // Deterministic on the server, re-anchored to the real clock right after hydration.
  const [demoPools, setDemoPools] = useState<ArenaPool[]>(() => buildDemoPools());
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setDemoPools(buildDemoPools(Math.floor(Date.now() / 1000)));
    setMounted(true);
  }, []);

  // Real markets come from the PoolCreated logs (+ the static manifest) — the contract has no
  // id counter, so events are the only source of truth.
  const { ids: chainIds, meta, stats: manifestStats, loading: chainLoading } = useChainPoolIds();
  const { pools: chainPools } = usePools(chainIds);

  const pools = useMemo<ArenaPool[]>(() => {
    if (!hasArena) return demoPools;
    if (chainPools.length === 0) return demoPools;
    return chainPools.map((pool) => {
      const entry = meta[String(pool.id)];
      return {
        ...pool,
        category: entry?.category || pool.category,
        tags: entry?.tags ?? [],
        optionLabels: ["Yes", "No"] as [string, string],
        aiStances: defaultStancesFor(entry?.category || pool.category),
      };
    });
  }, [chainPools, demoPools, meta]);

  const filtered = useMemo(
    () => pools.filter((pool) => matchesTab(pool.category, category)),
    [pools, category]
  );

  const stats = useMemo(() => {
    const tvl = pools.reduce((sum, pool) => sum + pool.totalNetPool, 0n);
    const activeMarkets = pools.filter((pool) => pool.status === 1).length;
    const settledMarkets = pools.filter((pool) => pool.status === 2).length;
    const localVolume = pools.reduce((sum, pool) => sum + (pool.volume24h ?? 0n), 0n);
    const volume24h = manifestStats?.volume24hUsdc ? BigInt(manifestStats.volume24hUsdc) : localVolume;
    return { tvl, activeMarkets, settledMarkets, volume24h };
  }, [pools, manifestStats]);

  const showingDemo = !hasArena || (mounted && chainPools.length === 0 && !chainLoading);

  return (
    <div className="min-h-screen">
      <Navbar active={category} onChange={setCategory} />

      {!hasArena && (
        <div className="border-b border-gold/15 bg-gold/[0.06]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2 text-[11px] text-gold-bright/90 sm:px-6">
            <Info className="size-3.5" />
            Demo mode: no contract address configured — showing sample markets.
            <span className="mono text-[10.5px] text-gold-bright/70">
              NEXT_PUBLIC_ARENA_ADDRESS + bun run abi:export
            </span>
          </div>
        </div>
      )}

      {hasArena && showingDemo && (
        <div className="border-b border-white/8 bg-white/[0.03]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2 text-[11px] text-muted sm:px-6">
            <Info className="size-3.5 text-gold" />
            No live markets on-chain yet (contract
            <a
              href={ARENA_ADDRESS ? explorerAddress(ARENA_ADDRESS) : "#"}
              target="_blank"
              rel="noreferrer"
              className="mono text-gold-bright hover:underline"
            >
              {ARENA_ADDRESS ? shortAddr(ARENA_ADDRESS, 4) : "—"}
            </a>
            is ready). Sample markets below — the page switches to chain data as soon as the first
            market opens.
          </div>
        </div>
      )}

      {/* ── hero + dashboard ─────────────────────────────────────── */}
      <section className="relative mx-auto max-w-7xl px-4 pb-8 pt-10 sm:px-6 sm:pt-14">
        <div className="grid items-center gap-9 lg:grid-cols-[1.12fr_0.88fr]">
          <div>
            <div className="rise-in flex flex-wrap items-center gap-2">
              <span className="chip chip-gold">
                <Globe2 className="size-3" />
                Base · USDC settled
              </span>
              <span className="chip">
                <BadgeCheck className="size-3 text-profit" />
                4% fee, escrowed per market
              </span>
              <span className="chip">IPFS evidence trail</span>
            </div>

            <h1 className="rise-in mt-5 text-[34px] font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-[54px]">
              <span className="text-ink">Trade the outcome.</span>
              <br />
              <span className="gold-text">Settled on-chain.</span>
            </h1>

            <p className="rise-in mt-4 max-w-xl text-[13.5px] leading-relaxed text-muted">
              Two AI agents argue both sides of every market. You take a position in USDC, winners are
              paid pro-rata from the pool, and the resolution evidence is written to Base as a bytes32
              hash anyone can verify.
            </p>

            <div className="rise-in mt-6 flex flex-wrap items-center gap-2.5">
              <a href="#markets" className="btn-gold text-sm">
                <Coins className="size-4" />
                Browse markets
                <ArrowRight className="size-4" />
              </a>
              <a href="#debate" className="btn-ghost text-sm">
                <BrainCircuit className="size-4" />
                Watch the agents debate
              </a>
            </div>
          </div>

          {/* dashboard */}
          <div className="glass scanline rise-in relative overflow-hidden rounded-3xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Protocol Dashboard</p>
                <p className="mt-1 text-sm font-semibold text-ink">Live on Base Mainnet</p>
              </div>
              <ShieldCheck className="size-5 text-gold" />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <Stat label="Total Value Locked" value={`$${formatCompactUsdc(stats.tvl)}`} hint="USDC" icon={<Coins className="size-3.5 text-gold" />} />
              <Stat label="Active Markets" value={String(stats.activeMarkets)} hint="OPEN" icon={<LayoutGrid className="size-3.5 text-profit" />} />
              <Stat label="24h Volume" value={`$${formatCompactUsdc(stats.volume24h)}`} hint="USDC" icon={<TrendingUp className="size-3.5 text-gold-bright" />} />
              <Stat label="Settled" value={String(stats.settledMarkets)} hint="RESOLVED" icon={<BadgeCheck className="size-3.5 text-muted" />} />
            </div>

            <div className="mt-4 space-y-2.5 rounded-xl border border-white/6 bg-white/[0.02] p-3">
              <StackBar label="Liquidity pool (player funds)" percent={96} tone="profit" />
              <StackBar label="Platform profit (70% of fee)" percent={2.8} tone="gold" />
              <StackBar label="Referral share (30% of fee)" percent={1.2} tone="muted" />
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2">
              <span className="size-1.5 rounded-full bg-profit shadow-[0_0_10px_2px_rgba(16,185,129,0.5)]" />
              <p className="mono text-[10.5px] text-muted">
                Invariant: balance ≥ Σpools + adminFees + referralFees
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── markets ──────────────────────────────────────────────── */}
      <section id="markets" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mono text-[10px] uppercase tracking-[0.28em] text-gold/80">LIVE MARKETS</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
              {CATEGORY_TABS.find((t) => t.id === category)?.label ?? "All Markets"}
            </h2>
            <p className="mt-1 text-[11.5px] text-muted">
              {filtered.length} markets · two-sided liquidity · winners split the net pool pro-rata
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 lg:hidden">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCategory(tab.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[11px] transition-colors",
                  category === tab.id
                    ? "border-gold/50 bg-gold/12 text-gold-bright"
                    : "border-white/8 text-muted hover:border-white/20 hover:text-ink"
                )}
              >
                {tab.emoji} {tab.short}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((pool, index) => (
            <ArenaCard
              key={String(pool.id)}
              pool={pool}
              index={index}
              onBet={(p, option) => setSelected({ pool: p, option })}
            />
          ))}
        </div>

        {filtered.length === 0 && (
          <p className="glass mt-4 rounded-xl px-4 py-10 text-center text-sm text-muted">
            No markets in this category yet — try another tab.
          </p>
        )}
      </section>

      {/* ── debate ───────────────────────────────────────────────── */}
      <section id="debate" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-8 sm:px-6">
        <SectionHeading
          eyebrow="AI INTELLIGENCE"
          title="Both sides argue before you decide"
          desc="Every market ships with a bull case and a bear case, each backed by a snapshot whose hash lands on-chain at settlement."
        />
        <div className="mt-4">
          <AIAgentsDebate category={category === "all" ? "default" : category} />
        </div>
      </section>

      {/* ── how it works ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <SectionHeading
          eyebrow="HOW IT WORKS"
          title="Three steps, no black box"
          desc="From position to payout, every step is verifiable on Basescan."
        />
        <div className="mt-4 grid gap-3.5 md:grid-cols-3">
          <Step
            index="01"
            title="Fees split on entry"
            body="Each stake is split instantly: 96% into the market's liquidity pool, 4% held as fee until resolution. The two ledgers never mix."
            icon={<ArrowRight className="size-4 text-gold" />}
          />
          <Step
            index="02"
            title="Resolution + evidence"
            body="After the close time the admin calls settle(outcome, bytes32). The IPFS snapshot hash is written to both storage and the event log."
            icon={<Fingerprint className="size-4 text-gold" />}
          />
          <Step
            index="03"
            title="Winners claim"
            body="Claim Winnings pays (your stake / winning side) × net pool. Pull payments, nonReentrant, one claim per wallet per market."
            icon={<Wallet className="size-4 text-gold" />}
          />
        </div>
      </section>

      {/* ── footer ───────────────────────────────────────────────── */}
      <footer className="mt-8 border-t border-white/6 bg-void/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="gold-text text-sm font-semibold tracking-[0.12em]">Prediction Arena</p>
            <p className="mt-1 text-[11px] text-muted">
              The Decentralized AI-Driven Prediction Market · Base Mainnet · USDC settled
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {ARENA_ADDRESS ? (
              <a
                href={explorerAddress(ARENA_ADDRESS)}
                target="_blank"
                rel="noreferrer"
                className="chip chip-gold hover:brightness-110"
              >
                Contract {shortAddr(ARENA_ADDRESS, 5)}
              </a>
            ) : (
              <span className="chip">Contract not deployed</span>
            )}
            <span className="chip">4% fee</span>
            <span className="chip">30% referral share</span>
            <span className="chip">nonReentrant</span>
          </div>
        </div>
      </footer>

      <BetModalHost
        pool={selected?.pool ?? null}
        option={selected?.option ?? 0}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[0.025] px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[9.5px] uppercase tracking-[0.12em] text-muted">{label}</p>
        {icon}
      </div>
      <p className="mono mt-1 text-lg font-semibold text-ink">{value}</p>
      <p className="mono text-[9px] tracking-[0.12em] text-muted/60">{hint}</p>
    </div>
  );
}

function StackBar({
  label,
  percent,
  tone,
}: {
  label: string;
  percent: number;
  tone: "gold" | "profit" | "muted";
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10.5px]">
        <span className="text-muted">{label}</span>
        <span
          className={cn(
            "mono",
            tone === "gold" ? "text-gold-bright" : tone === "profit" ? "text-profit" : "text-muted"
          )}
        >
          {percent.toFixed(2)}%
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/6">
        <div
          style={{ width: `${percent}%` }}
          className={cn(
            "h-full rounded-full",
            tone === "profit"
              ? "bg-gradient-to-r from-profit/70 to-profit"
              : tone === "gold"
                ? "bg-gradient-to-r from-gold to-gold-bright"
                : "bg-gradient-to-r from-zinc-500 to-zinc-400"
          )}
        />
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  desc,
}: {
  eyebrow: string;
  title: string;
  desc: string;
}) {
  return (
    <div>
      <p className="mono text-[10px] uppercase tracking-[0.28em] text-gold/80">{eyebrow}</p>
      <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h2>
      <p className="mt-1 text-[11.5px] text-muted">{desc}</p>
    </div>
  );
}

function Step({
  index,
  title,
  body,
  icon,
}: {
  index: string;
  title: string;
  body: string;
  icon: ReactNode;
}) {
  return (
    <div className="glass glass-hover rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <span className="mono text-[11px] tracking-[0.2em] text-muted/70">{index}</span>
        <span className="grid size-7 place-items-center rounded-lg border border-gold/25 bg-gold/8">{icon}</span>
      </div>
      <h3 className="mt-2.5 text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}
