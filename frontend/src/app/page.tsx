"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  Coins,
  Fingerprint,
  LayoutGrid,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { AIAgentsDebate } from "@/components/AIAgentsDebate";
import { MarketCard } from "@/components/MarketCard";
import { FeaturedBanner } from "@/components/FeaturedBanner";
import { SearchSortBar, type SortKey } from "@/components/SearchSortBar";
import { PartnersStrip } from "@/components/PartnersStrip";
import { SiteFooter } from "@/components/SiteFooter";
import { BetModalHost } from "@/components/BetModal";
import { useI18n } from "@/components/LocaleProvider";
import { useMarkets } from "@/hooks/useMarkets";
import { CATEGORY_TABS, matchesTab, type MarketCategory } from "@/lib/categories";
import { hasArena } from "@/hooks/usePredictionArena";
import { cn, formatCompactUsdc } from "@/lib/format";
import type { ArenaPool } from "@/lib/types";

export default function Home() {
  const { t } = useI18n();
  const [category, setCategory] = useState<MarketCategory>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("volume");
  const [selected, setSelected] = useState<{ pool: ArenaPool; option: 0 | 1 } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const { pools, stats, featured, loading } = useMarkets();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = pools.filter(
      (pool) =>
        matchesTab(pool.category, category) &&
        (q === "" || pool.title.toLowerCase().includes(q) || pool.category.toLowerCase().includes(q))
    );
    const sorted = [...rows];
    sorted.sort((a, b) => {
      switch (sort) {
        case "liquidity":
          return Number(b.totalNetPool - a.totalNetPool);
        case "ending":
          return a.endTime - b.endTime;
        case "newest":
          return Number(b.id - a.id);
        default:
          return Number((b.volume24h ?? 0n) - (a.volume24h ?? 0n));
      }
    });
    return sorted;
  }, [pools, category, query, sort]);

  const showFeatured = featured && featured.status === 1 && category === "all" && query.trim() === "";

  return (
    <div className="min-h-screen">
      <Navbar active={category} onChange={setCategory} />

      <main className="mx-auto max-w-[1400px] px-4 pb-10 pt-5 sm:px-6">
        {/* ── featured + dashboard ───────────────────────────────── */}
        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          {showFeatured && featured ? (
            <FeaturedBanner pool={featured} onBet={(pool, option) => setSelected({ pool, option })} />
          ) : (
            <div className="glass flex flex-col justify-center gap-3 rounded-3xl p-6">
              <h1 className="text-[26px] font-bold leading-tight text-ink sm:text-[32px]">
                {t("hero.h1a")} <span className="gold-text">{t("hero.h1b")}</span>
              </h1>
              <p className="max-w-xl text-[12.5px] leading-relaxed text-muted">{t("hero.sub")}</p>
            </div>
          )}

          <div className="glass flex flex-col gap-3 rounded-3xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9.5px] uppercase tracking-[0.2em] text-muted">{t("stats.dashboard")}</p>
                <p className="mt-0.5 text-[13px] font-semibold text-ink">{t("stats.live")}</p>
              </div>
              <ShieldCheck className="size-4 text-gold" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Stat label={t("stats.tvl")} value={`$${formatCompactUsdc(stats.tvl)}`} icon={<Coins className="size-3 text-gold" />} />
              <Stat label={t("stats.active")} value={String(stats.activeMarkets)} icon={<LayoutGrid className="size-3 text-profit" />} />
              <Stat label={t("stats.volume24h")} value={`$${formatCompactUsdc(stats.volume24h)}`} icon={<TrendingUp className="size-3 text-gold-bright" />} />
              <Stat label={t("stats.settled")} value={String(stats.settledMarkets)} icon={<BadgeCheck className="size-3 text-muted" />} />
            </div>

            <div className="rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2">
              <p className="mono text-[10px] leading-relaxed text-muted/80">{t("stats.invariant")}</p>
            </div>

            <div className="mt-auto flex flex-wrap gap-2">
              <a href="#markets" className="btn-gold flex-1 text-[12.5px]">
                <Coins className="size-3.5" /> {t("hero.browse")}
              </a>
              <a href="#debate" className="btn-ghost flex-1 text-[12.5px]">
                <BrainCircuit className="size-3.5" /> {t("hero.debate")}
              </a>
            </div>
          </div>
        </div>

        {/* ── filters ─────────────────────────────────────────────── */}
        <section id="markets" className="scroll-mt-24 pt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mono text-[9.5px] uppercase tracking-[0.28em] text-gold/80">LIVE MARKETS</p>
              <h2 className="mt-1 text-[19px] font-semibold tracking-tight text-ink sm:text-[22px]">
                {t(CATEGORY_TABS.find((c) => c.id === category)?.i18n ?? "nav.allMarkets")}
              </h2>
            </div>
            {loading && <span className="mono text-[10.5px] text-muted/60">loading manifest…</span>}
          </div>

          <div className="mt-3">
            <SearchSortBar query={query} onQuery={setQuery} sort={sort} onSort={setSort} count={filtered.length} />
          </div>

          <div className="no-scrollbar mt-2.5 flex gap-1.5 overflow-x-auto pb-1">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCategory(tab.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-[11.5px] transition-colors",
                  category === tab.id
                    ? "border-gold/50 bg-gold/12 text-gold-bright"
                    : "border-white/8 text-muted hover:border-white/20 hover:text-ink"
                )}
              >
                <span className="mr-1">{tab.emoji}</span>
                {t(tab.i18n)}
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((pool, index) => (
              <MarketCard key={String(pool.id)} pool={pool} index={index} onBet={(p, option) => setSelected({ pool: p, option })} />
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="glass mt-3 flex flex-col items-center gap-2 rounded-2xl px-4 py-12 text-center">
              <p className="text-sm font-semibold text-ink">{t("empty.title")}</p>
              <p className="text-[11.5px] text-muted">{t("empty.body")}</p>
              <button
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                }}
                className="btn-ghost mt-1 text-[12px]"
              >
                {t("empty.clear")}
              </button>
            </div>
          )}
        </section>

        {/* ── debate ───────────────────────────────────────────────── */}
        <section id="debate" className="scroll-mt-24 pt-8">
          <div>
            <p className="mono text-[9.5px] uppercase tracking-[0.28em] text-gold/80">AI INTELLIGENCE</p>
            <h2 className="mt-1 text-[19px] font-semibold tracking-tight text-ink sm:text-[22px]">{t("agent.debateTitle")}</h2>
            <p className="mt-1 text-[11.5px] text-muted">{t("agent.debateSub")}</p>
          </div>
          <div className="mt-3">
            <AIAgentsDebate category={category} />
          </div>
        </section>

        {/* ── how it works ─────────────────────────────────────────── */}
        <section className="pt-9">
          <div>
            <p className="mono text-[9.5px] uppercase tracking-[0.28em] text-gold/80">{t("how.eyebrow")}</p>
            <h2 className="mt-1 text-[19px] font-semibold tracking-tight text-ink sm:text-[22px]">{t("how.title")}</h2>
            <p className="mt-1 text-[11.5px] text-muted">{t("how.desc")}</p>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Step index="01" title={t("how.s1t")} body={t("how.s1b")} icon={<ArrowRight className="size-4 text-gold" />} />
            <Step index="02" title={t("how.s2t")} body={t("how.s2b")} icon={<Fingerprint className="size-4 text-gold" />} />
            <Step index="03" title={t("how.s3t")} body={t("how.s3b")} icon={<Wallet className="size-4 text-gold" />} />
          </div>
        </section>
      </main>

      <PartnersStrip />
      <SiteFooter />

      <BetModalHost pool={selected?.pool ?? null} option={selected?.option ?? 0} onClose={() => setSelected(null)} />
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[0.025] px-2.5 py-2">
      <div className="flex items-center justify-between">
        <p className="truncate text-[9px] uppercase tracking-[0.1em] text-muted">{label}</p>
        {icon}
      </div>
      <p className="mono mt-0.5 text-[16px] font-semibold text-ink">{value}</p>
    </div>
  );
}

function Step({ index, title, body, icon }: { index: string; title: string; body: string; icon: React.ReactNode }) {
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
