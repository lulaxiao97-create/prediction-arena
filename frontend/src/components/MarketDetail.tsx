"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Clock3,
  ExternalLink,
  Fingerprint,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { Navbar } from "@/components/Navbar";
import { BetModalHost } from "@/components/BetModal";
import { TradePanel } from "@/components/TradePanel";
import { ProbabilityChart } from "@/components/ProbabilityChart";
import { useLiveSeries } from "@/hooks/useLiveSeries";
import { CommunityDiscussion } from "@/components/CommunityDiscussion";
import { CategoryCover } from "@/components/CategoryCover";
import { MarketCover } from "@/components/MarketCover";
import { coverOf } from "@/lib/covers";
import { MobileTradeSheet } from "@/components/MobileTradeSheet";
import { themeFor } from "@/lib/visuals";
import { useAiDebate } from "@/hooks/useAiDebate";
import { ActivityLog } from "@/components/ActivityLog";
import { useMarkets } from "@/hooks/useMarkets";
import { ShareActions } from "@/components/ShareActions";
import { DemoBadge } from "@/components/DemoBadge";
import { useMounted } from "@/hooks/useMounted";
import { AGENTS } from "@/lib/mock-data";
import { activityFor, metaFor, probabilitySeries } from "@/lib/markets";
import { categoryI18nKey, type MarketCategory } from "@/lib/categories";
import {
  cn,
  countdown,
  explorerTx,
  formatCompactUsdc,
  formatCountdown,
  formatEndDate,
  formatProbability,
  sideShare,
} from "@/lib/format";
import type { ArenaPool } from "@/lib/types";

type Tab = "overview" | "debate" | "activity" | "rules";

export function MarketDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const { pools, manifest, loading } = useMarkets();
  const [category, setCategory] = useState<MarketCategory>("all");
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<{ pool: ArenaPool; option: 0 | 1 } | null>(null);

  const pool = pools.find((p) => p.id.toString() === id);
  const meta = metaFor(manifest, id);

  const share0 = pool ? sideShare(pool.option0Pool, pool.option1Pool) : 0.5;
  const seedSeries = useMemo(() => probabilitySeries(id, share0, 30), [id, share0]);
  const { series, live, dir } = useLiveSeries(seedSeries, id);
  const activity = useMemo(() => activityFor(id, 10), [id]);
  // Rendered instantly from the deterministic kernel, then upgraded by the server-side model.
  const debateInput = useMemo(
    () => ({
      poolId: String(pool?.id ?? id),
      category: pool?.category ?? meta.category ?? "default",
      title: (pool?.title ?? meta.title ?? "") as string,
      yesPct: (share0 ?? 0) * 100,
      netPoolUsdc: Number(pool?.totalNetPool ?? 0n) / 1_000_000,
    }),
    [pool?.id, pool?.category, pool?.title, pool?.totalNetPool, meta.category, meta.title, share0]
  );
  const { lines: debate, source: debateSource, stale: debateStale, staleReason, cachedBand } = useAiDebate(debateInput);
  // Countdown and "ends at" are the two values that can differ between the server render
  // (UTC clock, build-time manifest) and the browser (local clock, local time zone). Both are
  // gated so the hydrated markup matches and the real values fill in on the next frame.
  const mounted = useMounted();
  const cd = pool && mounted ? countdown(pool.endTime) : null;

  const TABS: { id: Tab; label: string }[] = [
    { id: "overview", label: t("tabs.overview") },
    { id: "debate", label: t("tabs.debate") },
    { id: "activity", label: t("tabs.activity") },
    { id: "rules", label: t("tabs.rules") },
  ];

  if (loading && !pool) {
    return (
      <div className="min-h-screen">
        <Navbar active={category} onChange={setCategory} />
        <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6">
          <div className="glass h-40 animate-pulse rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!pool) {
    return (
      <div className="min-h-screen">
        <Navbar active={category} onChange={setCategory} />
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-4 py-24 text-center sm:px-6">
          <p className="text-lg font-semibold text-ink">{t("detail.notFound")}</p>
          <p className="text-[12.5px] text-muted">{t("detail.notFoundBody")}</p>
          <Link href="/" className="btn-gold mt-2 text-[13px]">
            <ArrowLeft className="size-4" /> {t("detail.back")}
          </Link>
        </div>
      </div>
    );
  }

  const settled = pool.status === 2;
  const voided = pool.status === 3;
  const cover = coverOf(pool);

  return (
    <div className="min-h-screen">
      <Navbar active={category} onChange={setCategory} />

      <main className="mx-auto max-w-[1400px] px-4 pb-28 pt-4 sm:px-6 lg:pb-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11.5px] text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" /> {t("detail.back")}
        </Link>

        <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="flex flex-col gap-4">
            {/* header */}
            <div className="glass relative overflow-hidden rounded-2xl border-white/10 transition-colors hover:border-white/15">
              {/* Subject art: same engine as the cards, at hero scale — the entity and its real
                  number sit on the photograph, so the page announces what it is before the title. */}
              <div className="relative h-[152px] w-full overflow-hidden border-b border-white/[0.07] sm:h-[190px]">
                <MarketCover spec={cover} variant="detail" />
                {cover.metric && (
                  <span className="mono absolute right-4 top-4 rounded-lg border border-white/12 bg-void/55 px-2 py-1 text-[11.5px] text-ink/90 backdrop-blur-sm sm:right-5 sm:top-5">
                    {cover.metric}
                  </span>
                )}
                <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                  <p className="mono truncate text-[9px] uppercase tracking-[0.26em]" style={{ color: cover.accent }}>
                    {cover.kicker}
                  </p>
                  <p className="mt-1 truncate text-[22px] font-bold leading-none tracking-tight text-ink sm:text-[26px]">
                    {cover.entity}
                  </p>
                </div>
              </div>

              <div className="relative p-4 sm:p-5">
              <div className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full bg-gold/8 blur-3xl" />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="chip chip-gold">{t(categoryI18nKey(pool.category))}</span>
                {(pool.tags ?? []).map((tag) => (
                  <span key={tag} className="chip border-white/10 text-[10px] text-muted/85">
                    {tag}
                  </span>
                ))}
                {settled && <span className="chip border-profit/25 bg-profit/8 text-[10px] text-profit">{t("card.settled")}</span>}
                {voided && <span className="chip border-loss/25 bg-loss/8 text-[10px] text-loss">{t("card.voided")}</span>}
                {pool.source !== "chain" && !settled && <DemoBadge variant="chip" />}
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10.5px] text-muted">
                  <Clock3 className="size-2.5" />
                  <span className="mono">{cd ? (cd.ended ? "Ended" : formatCountdown(cd)) : "—"}</span>
                </span>
              </div>

              <h1 className="mt-2.5 break-words text-[20px] font-bold leading-[1.2] tracking-tight text-ink [hyphens:auto] sm:text-[26px]">{pool.title}</h1>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label={t("detail.probability")} value={formatProbability(share0)} tone="profit" />
                <Metric label={t("detail.liquidity")} value={`$${formatCompactUsdc(pool.totalNetPool)}`} />
                <Metric label={t("detail.traders")} value={(pool.traders ?? 0).toLocaleString("en-US")} />
                <Metric label={t("card.ends")} value={mounted ? formatEndDate(pool.endTime) : "—"} />
              </div>

              <ShareActions
                marketId={pool.id}
                title={pool.title}
                yesPct={share0}
                market={pool.marketData}
                className="mt-3 max-w-md"
              />

              {settled && pool.settlementHash && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-profit/20 bg-profit/[0.05] px-2.5 py-2 text-[10.5px] text-muted">
                  <BadgeCheck className="size-3 text-profit" />
                  <span>
                    {t("detail.settledOn")} · <span className="text-gold-bright">{pool.optionLabels[pool.winningOption]}</span>
                  </span>
                  <a
                    href={explorerTx(pool.settlementHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mono ml-auto inline-flex items-center gap-1 text-[10px] text-muted/70 transition-colors hover:text-gold-bright"
                  >
                    <Fingerprint className="size-2.5" />
                    {pool.settlementHash.slice(0, 10)}…{pool.settlementHash.slice(-6)} <ExternalLink className="size-2.5" />
                  </a>
                </div>
              )}
              </div>
            </div>

            {/* chart (always visible) */}
            <div className="glass relative overflow-hidden rounded-2xl border-white/10 p-4 transition-colors hover:border-white/15">
              <CategoryCover
                theme={themeFor({ category: pool.category, title: pool.title, tags: pool.tags })}
                className="z-0"
                fade="hero"
              />
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                  {t("detail.chart")}
                  <span className="inline-flex items-center gap-1 rounded-full border border-profit/30 bg-profit/10 px-1.5 py-0.5 text-[8.5px] font-medium uppercase tracking-[0.08em] text-profit">
                    <span className="size-1 animate-pulse rounded-full bg-profit" />
                    {t("trade.live")}
                  </span>
                </p>
                <div className="flex items-center gap-3 text-[10.5px] text-muted">
                  <span className="inline-flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-profit" /> {t("card.yes")}
                  </span>
                  <span className="mono text-[12px] font-semibold text-ink transition-colors duration-500">
                    {(live * 100).toFixed(2)}%
                  </span>
                  <span
                    className={
                      dir > 0 ? "text-[9px] text-profit" : dir < 0 ? "text-[9px] text-loss" : "text-[9px] text-muted/40"
                    }
                    aria-label={dir > 0 ? "ticking up" : dir < 0 ? "ticking down" : "flat"}
                  >
                    {dir > 0 ? "▲" : dir < 0 ? "▼" : "—"}
                  </span>
                </div>
              </div>
              <div className="mt-3">
                <ProbabilityChart series={series} height={200} live />
              </div>
              <div className="mt-1 flex justify-between text-[9.5px] text-muted/50">
                <span>30d</span>
                <span>21d</span>
                <span>14d</span>
                <span>7d</span>
                <span>now</span>
              </div>
            </div>

            {/* tabs */}
            <div className="glass overflow-hidden rounded-2xl border-white/10">
              <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-white/8 px-2 py-1.5" role="tablist">
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    role="tab"
                    aria-selected={tab === item.id}
                    onClick={() => setTab(item.id)}
                    className={cn(
                      "whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all active:scale-[0.98]",
                      tab === item.id
                        ? "bg-gold/12 text-gold-bright shadow-[inset_0_-1px_0_0_rgba(245,158,11,0.6)]"
                        : "text-muted hover:bg-white/[0.04] hover:text-ink"
                    )}
                  >
                    {item.label}
                    {item.id === "activity" && (
                      <span className="mono ml-1.5 rounded bg-white/8 px-1 text-[9px] text-muted">{activity.length}</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="p-4" role="tabpanel">
                {tab === "overview" && (
                  <div className="space-y-3">
                    <p className="text-[12px] leading-relaxed text-muted">
                      {meta.description || t("detail.liveFallback")}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <MiniStat label={t("detail.volume")} value={`$${formatCompactUsdc(pool.volume24h ?? 0n)}`} />
                      <MiniStat label={t("detail.liquidity")} value={`$${formatCompactUsdc(pool.totalNetPool)}`} />
                      <MiniStat label={t("detail.openInterest")} value={`$${formatCompactUsdc(pool.option0Pool + pool.option1Pool)}`} />
                    </div>
                    {pool.aiStances && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <StanceCard tone="profit" title={t("detail.bullCase")} agent={pool.aiStances.yes.agent} text={pool.aiStances.yes.take} />
                        <StanceCard tone="loss" title={t("detail.bearCase")} agent={pool.aiStances.no.agent} text={pool.aiStances.no.take} />
                      </div>
                    )}
                  </div>
                )}

                {tab === "debate" && (
                  <>
                    {debateStale && (
                      <p className="mb-2 flex items-center gap-1.5 rounded-lg border border-cyan/20 bg-cyan/[0.05] px-2.5 py-1.5 text-[10px] leading-relaxed text-cyan-bright/80 transition-opacity duration-300">
                        <span className="size-1.5 animate-pulse rounded-full bg-cyan-bright" />
                        {staleReason === "drift" && cachedBand !== null
                          ? t("detail.debateDrift", { cached: cachedBand, now: Math.round(share0 * 100) })
                          : t("detail.debateMissing")}
                      </p>
                    )}
                    <ul className="space-y-2">
                    {debate.map((line, i) => {
                      const agent = AGENTS.find((a) => a.id === line.agent) ?? AGENTS[0];
                      const round = Math.floor(i / 2) + 1;
                      return (
                        <li
                          key={i}
                          className="flex gap-2.5 rounded-xl border border-white/6 bg-white/[0.015] px-3 py-2.5 transition-colors hover:border-white/12"
                        >
                          <span className="text-base leading-none">{agent.emoji}</span>
                          <div className="min-w-0">
                            <p className={cn("flex flex-wrap items-center gap-1.5 text-[11px] font-semibold", agent.accent)}>
                              <span className="mono rounded border border-white/10 px-1 text-[8.5px] font-medium text-muted/70">
                                R{round}
                              </span>
                              {agent.name}
                              <span className="text-muted/60">· {agent.role}</span>
                              {line.stance && (
                                <span
                                  className={cn(
                                    "mono rounded border px-1 text-[8px] uppercase tracking-[0.1em]",
                                    line.stance === "bull"
                                      ? "border-profit/30 bg-profit/10 text-profit"
                                      : "border-loss/30 bg-loss/10 text-loss"
                                  )}
                                >
                                  {line.stance}
                                </span>
                              )}
                            </p>
                            <p className="mt-1 text-[11.5px] leading-relaxed text-ink/85">{line.text}</p>
                            {line.evidenceCid && (
                              <p className="mono mt-1 text-[9px] text-muted/50">ipfs://{line.evidenceCid.slice(0, 12)}…</p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                    </ul>
                  </>
                )}

                {tab === "activity" && (
                  <div className="-m-4">
                    <ActivityLog rows={activity} />
                  </div>
                )}

                {tab === "rules" && (
                  <div className="space-y-3">
                    <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
                      <ShieldCheck className="size-3.5 text-gold" /> {t("detail.rules")}
                    </p>
                    <p className="text-[11.5px] leading-relaxed text-muted">
                      {meta.resolution || t("detail.rulesFallback")}
                    </p>
                    <ul className="space-y-1.5 text-[11px] text-muted">
                      {["detail.rule1", "detail.rule2", "detail.rule3", "detail.rule4"].map((k) => (
                        <li key={k}>· {t(k)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <CommunityDiscussion
              poolId={String(pool.id)}
              category={pool.category ?? meta.category ?? "default"}
              yesPct={share0 * 100}
            />
          </div>

          <div className="hidden lg:block lg:pt-0">
            <TradePanel pool={pool} />
          </div>
        </div>
      </main>

      <MobileTradeSheet pool={pool} yesPct={share0} />

      <BetModalHost pool={selected?.pool ?? null} option={selected?.option ?? 0} onClose={() => setSelected(null)} />
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "profit" }) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[0.02] px-2.5 py-2 transition-colors hover:border-white/12">
      <p className="text-[9px] uppercase tracking-[0.1em] text-muted">{label}</p>
      <p className={cn("mono mt-0.5 truncate text-[13px] font-semibold", tone === "profit" ? "text-profit" : "text-ink")}>{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-[0.1em] text-muted/70">{label}</p>
      <p className="mono mt-0.5 text-[12.5px] font-semibold text-ink">{value}</p>
    </div>
  );
}

function StanceCard({ tone, title, agent, text }: { tone: "profit" | "loss"; title: string; agent: string; text: string }) {
  const isProfit = tone === "profit";
  return (
    <div className={cn("rounded-xl border p-3 transition-colors", isProfit ? "border-profit/20 bg-profit/[0.04] hover:border-profit/35" : "border-loss/20 bg-loss/[0.04] hover:border-loss/35")}>
      <p className={cn("text-[9.5px] font-semibold uppercase tracking-[0.12em]", isProfit ? "text-profit" : "text-loss")}>{title}</p>
      <p className="mt-1 text-[10.5px] font-semibold text-ink/90">{agent}</p>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{text}</p>
    </div>
  );
}
