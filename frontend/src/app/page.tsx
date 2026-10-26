"use client";

import { useMemo, useState } from "react";
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
import { HeroMasthead } from "@/components/HeroMasthead";
import { LiveTicker } from "@/components/LiveTicker";
import { LiveActivityFeed } from "@/components/LiveActivityFeed";
import { AIAgentsDebate } from "@/components/AIAgentsDebate";
import { MarketCard } from "@/components/MarketCard";
import { FeaturedBanner } from "@/components/FeaturedBanner";
import { SearchSortBar, type SortKey } from "@/components/SearchSortBar";
import { PartnersStrip } from "@/components/PartnersStrip";
import { SiteFooter } from "@/components/SiteFooter";
import { BetModalHost } from "@/components/BetModal";
import { useI18n } from "@/components/LocaleProvider";
import { useMarkets } from "@/hooks/useMarkets";
import { useMounted } from "@/hooks/useMounted";
import { CATEGORY_TABS, matchesTab, type MarketCategory } from "@/lib/categories";
import { hasArena } from "@/hooks/usePredictionArena";
import { formatCompactUsdc } from "@/lib/format";
import type { ArenaPool } from "@/lib/types";

export default function Home() {
  const { t } = useI18n();
  const [category, setCategory] = useState<MarketCategory>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("ending");
  const [selected, setSelected] = useState<{ pool: ArenaPool; option: 0 | 1 } | null>(null);

  const { pools, stats, featured, loading } = useMarkets();

  const mounted = useMounted();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const rows = pools.filter((pool) => {
      if (!matchesTab(pool.category, category)) return false;
      if (!terms.length) return true;
      // Every term has to hit somewhere: title, lane, token ticker, resolution source, prose.
      const haystack =
        pool.searchText ??
        `${pool.title} ${pool.category} ${(pool.tags ?? []).join(" ")}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });

    // Payout multiple on the cheap side: 50/50 pays 2.0×, a 15% long shot pays ~6.7×.
    const payout = (p: ArenaPool) => {
      const total = Number(p.totalNetPool) || 0;
      const yes = total ? Number(p.option0Pool) / total : 0.5;
      return 1 / Math.max(0.02, Math.min(yes, 1 - yes));
    };

    // "Ending soon" means tradeable now: markets resolving inside 24-72h float above everything
    // else, then the rest by deadline. `now` only exists after mount so the server and the first
    // client render sort identically (plain deadline order) — otherwise the two orders differ and
    // hydration complains.
    const nowSec = mounted ? Math.floor(Date.now() / 1000) : null;
    const endingRank = (p: ArenaPool) => {
      if (nowSec === null) return p.endTime;
      const hours = (p.endTime - nowSec) / 3_600;
      if (hours >= 24 && hours <= 72) return -1e9 + p.endTime; // the priority band
      if (hours < 24) return -5e8 + p.endTime; // resolving within a day: next
      return p.endTime;
    };

    const sorted = [...rows];
    sorted.sort((a, b) => {
      switch (sort) {
        case "odds":
          return payout(b) - payout(a);
        case "newest":
          return Number(b.id - a.id);
        default:
          return endingRank(a) - endingRank(b);
      }
    });
    return sorted;
  }, [pools, category, query, sort, mounted]);

  /**
   * Hero resolution.
   *
   * The old rule only rendered the banner when the tab was "all" and nothing was searched, so
   * every category tab fell through to a static promo block — a black hole where the market
   * should be. The hero now always resolves to a real, tradeable market:
   *   1. the editorially featured market, when it is inside the current view;
   *   2. otherwise the first market of the current tab (the list is already filtered + sorted,
   *      so under "Ending Soon" this is the market that resolves next).
   * Only a genuinely empty result set (a search with no hits) yields no hero, and that case
   * renders an honest "nothing matches" card rather than the marketing copy.
   */
  const hero = useMemo(() => {
    if (!filtered.length) return null;
    if (featured && featured.status === 1 && filtered.some((p) => p.id === featured.id)) {
      return { pool: featured, auto: false };
    }
    const open = filtered.find((p) => p.status === 1) ?? filtered[0];
    return { pool: open, auto: true };
  }, [filtered, featured]);

  return (
    <div className="min-h-screen">
      <Navbar active={category} onChange={setCategory} />
      <LiveTicker />

      <main className="mx-auto w-full max-w-[1400px] px-4 pb-10 pt-5 sm:px-6">
        <HeroMasthead />

        {/* ── featured + dashboard ───────────────────────────────── */}
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
          {hero ? (
            <FeaturedBanner
              pool={hero.pool}
              auto={hero.auto}
              onBet={(pool, option) => setSelected({ pool, option })}
            />
          ) : (
            <div className="glass flex min-w-0 flex-col justify-center gap-3 rounded-3xl p-6">
              <h2 className="text-[20px] font-semibold leading-tight text-ink">
                {t("empty.title")}
              </h2>
              <p className="max-w-xl text-[12.5px] leading-relaxed text-muted">{t("empty.body")}</p>
              <button
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                }}
                className="btn-ghost mt-1 w-fit text-[12px]"
              >
                {t("empty.clear")}
              </button>
            </div>
          )}

          <div className="flex min-w-0 flex-col gap-4">
            <div className="glass flex min-w-0 flex-col gap-3 rounded-3xl p-4">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[9.5px] uppercase tracking-[0.2em] text-muted">{t("stats.dashboard")}</p>
                  <p className="mt-0.5 text-[13px] font-semibold text-ink">{t("stats.live")}</p>
                </div>
                <ShieldCheck className="size-4 shrink-0 text-gold" />
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

            <LiveActivityFeed pools={pools} />
          </div>
        </div>

        {/* ── filters ─────────────────────────────────────────────── */}
        <section id="markets" className="scroll-mt-[136px] pt-6">
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

          {/* The lane rail lives in the sticky header on every screen — repeating it here put two
              identical rows of pills 200px apart. Search + sort is all this row needs to be. */}

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
        <section id="debate" className="scroll-mt-[136px] pt-8">
          <div>
            <p className="mono text-[9.5px] uppercase tracking-[0.28em] text-gold/80">AI INTELLIGENCE</p>
            <h2 className="mt-1 text-[19px] font-semibold tracking-tight text-ink sm:text-[22px]">{t("agent.debateTitle")}</h2>
            <p className="mt-1 text-[11.5px] text-muted">{t("agent.debateSub")}</p>
          </div>
          <div className="mt-3">
            <AIAgentsDebate
              category={category}
              poolId={featured ? String(featured.id) : undefined}
              title={featured?.title}
              yesPct={
                featured && featured.totalNetPool > 0n
                  ? (Number(featured.option0Pool) / Number(featured.totalNetPool)) * 100
                  : 50
              }
              netPoolUsdc={featured ? Number(featured.totalNetPool) / 1_000_000 : undefined}
            />
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
    <div className="min-w-0 rounded-xl border border-white/6 bg-white/[0.025] px-2.5 py-2">
      <div className="flex items-center justify-between gap-1">
        <p className="min-w-0 truncate text-[9px] uppercase tracking-[0.1em] text-muted">{label}</p>
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
