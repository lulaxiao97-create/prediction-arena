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
import { ActivityLog } from "@/components/ActivityLog";
import { useMarkets } from "@/hooks/useMarkets";
import { AGENTS, agentLinesFor } from "@/lib/mock-data";
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
  formatUsdc,
  sideShare,
} from "@/lib/format";
import type { ArenaPool } from "@/lib/types";

export function MarketDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const { pools, manifest, loading } = useMarkets();
  const [category, setCategory] = useState<MarketCategory>("all");
  const [selected, setSelected] = useState<{ pool: ArenaPool; option: 0 | 1 } | null>(null);

  const pool = pools.find((p) => p.id.toString() === id);
  const meta = metaFor(manifest, id);

  const share0 = pool ? sideShare(pool.option0Pool, pool.option1Pool) : 0.5;
  const series = useMemo(() => probabilitySeries(id, share0, 30), [id, share0]);
  const activity = useMemo(() => activityFor(id, 8), [id]);
  const debate = useMemo(() => agentLinesFor(pool?.category ?? meta.category ?? "default"), [pool?.category, meta.category]);

  const cd = pool ? countdown(pool.endTime) : null;

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

  return (
    <div className="min-h-screen">
      <Navbar active={category} onChange={setCategory} />

      <main className="mx-auto max-w-[1400px] px-4 pb-10 pt-4 sm:px-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-[11.5px] text-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> {t("detail.back")}
        </Link>

        <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_360px]">
          {/* ── left column ─────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            {/* header */}
            <div className="glass relative overflow-hidden rounded-2xl p-4 sm:p-5">
              <div className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full bg-gold/8 blur-3xl" />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="chip chip-gold">{t(categoryI18nKey(pool.category))}</span>
                {(pool.tags ?? []).map((tag) => (
                  <span key={tag} className="chip border-white/10 text-[10px] text-muted/85">
                    {tag}
                  </span>
                ))}
                {settled && (
                  <span className="chip border-profit/25 bg-profit/8 text-[10px] text-profit">{t("card.settled")}</span>
                )}
                {voided && (
                  <span className="chip border-loss/25 bg-loss/8 text-[10px] text-loss">{t("card.voided")}</span>
                )}
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10.5px] text-muted">
                  <Clock3 className="size-2.5" />
                  <span className="mono">{cd ? (cd.ended ? "Ended" : formatCountdown(cd)) : "—"}</span>
                </span>
              </div>

              <h1 className="mt-2.5 text-[20px] font-bold leading-snug text-ink sm:text-[26px]">{pool.title}</h1>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label={t("detail.probability")} value={formatProbability(share0)} tone="profit" />
                <Metric label={t("detail.liquidity")} value={`$${formatCompactUsdc(pool.totalNetPool)}`} />
                <Metric label={t("detail.traders")} value={(pool.traders ?? 0).toLocaleString("en-US")} />
                <Metric label={t("detail.ends")} value={formatEndDate(pool.endTime)} />
              </div>

              {settled && pool.settlementHash && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-profit/20 bg-profit/[0.05] px-2.5 py-2 text-[10.5px] text-muted">
                  <BadgeCheck className="size-3 text-profit" />
                  <span>
                    {t("detail.settledOn")} · {t("card.yes")}/{t("card.no")} →{" "}
                    <span className="text-gold-bright">{pool.optionLabels[pool.winningOption]}</span>
                  </span>
                  <a
                    href={explorerTx(pool.settlementHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="mono ml-auto inline-flex items-center gap-1 text-[10px] text-muted/70 hover:text-gold-bright"
                  >
                    <Fingerprint className="size-2.5" />
                    {pool.settlementHash.slice(0, 10)}…{pool.settlementHash.slice(-6)}
                  </a>
                </div>
              )}
            </div>

            {/* chart */}
            <div className="glass rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-[12.5px] font-semibold text-ink">{t("detail.chart")}</p>
                <div className="flex items-center gap-3 text-[10.5px] text-muted">
                  <span className="inline-flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-profit" /> {t("card.yes")}
                  </span>
                  <span className="mono">{formatProbability(share0)}</span>
                </div>
              </div>
              <div className="mt-3">
                <ProbabilityChart series={series} height={200} />
              </div>
              <div className="mt-1 flex justify-between text-[9.5px] text-muted/50">
                <span>30d</span>
                <span>21d</span>
                <span>14d</span>
                <span>7d</span>
                <span>now</span>
              </div>
            </div>

            {/* about + rules */}
            <div className="glass rounded-2xl p-4">
              <p className="text-[12.5px] font-semibold text-ink">{t("detail.about")}</p>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                {meta.description ||
                  "This market is read live from the PredictionArena contract; its long-form description has not been published to the manifest yet."}
              </p>
              <div className="mt-3 rounded-xl border border-white/6 bg-white/[0.02] p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                  <ShieldCheck className="size-3.5 text-gold" /> {t("detail.rules")}
                </p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                  {meta.resolution ||
                    "Resolution is written on-chain by settle(outcome, bytes32 evidenceHash). Any position can be refunded at 100% if the market is cancelled, or after 30 days of operator silence via Protection Withdrawal."}
                </p>
              </div>
            </div>

            {/* AI debate */}
            <div className="glass rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-[12.5px] font-semibold text-ink">{t("detail.aiDebate")}</p>
                <span className="chip">
                  <span className="size-1.5 animate-pulse rounded-full bg-gold" />
                  AI
                </span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <StanceCard
                  tone="profit"
                  title={t("detail.bullCase")}
                  agent={pool.aiStances?.yes.agent ?? AGENTS[0].name}
                  text={pool.aiStances?.yes.take ?? debate[0]?.text ?? ""}
                />
                <StanceCard
                  tone="loss"
                  title={t("detail.bearCase")}
                  agent={pool.aiStances?.no.agent ?? AGENTS[1].name}
                  text={pool.aiStances?.no.take ?? debate[1]?.text ?? ""}
                />
              </div>

              <ul className="mt-3 space-y-2">
                {debate.map((line, i) => {
                  const agent = AGENTS.find((a) => a.id === line.agent) ?? AGENTS[0];
                  return (
                    <li key={i} className="flex gap-2.5 rounded-xl border border-white/6 bg-white/[0.015] px-3 py-2.5">
                      <span className="text-base leading-none">{agent.emoji}</span>
                      <div className="min-w-0">
                        <p className={cn("text-[11px] font-semibold", agent.accent)}>
                          {agent.name} · <span className="text-muted/60">{agent.role}</span>
                        </p>
                        <p className="mt-1 text-[11.5px] leading-relaxed text-ink/85">{line.text}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* activity */}
            <div className="glass overflow-hidden rounded-2xl">
              <div className="flex items-center justify-between border-b border-white/6 px-4 py-3">
                <p className="text-[12.5px] font-semibold text-ink">{t("detail.activity")}</p>
                <span className="inline-flex items-center gap-1 text-[10.5px] text-muted">
                  <Users className="size-3" /> {pool.traders ?? 0}
                </span>
              </div>
              <ActivityLog rows={activity} />
            </div>
          </div>

          {/* ── right column: trade panel ───────────────────────── */}
          <div className="lg:pt-0">
            <TradePanel pool={pool} />
          </div>
        </div>
      </main>

      <BetModalHost pool={selected?.pool ?? null} option={selected?.option ?? 0} onClose={() => setSelected(null)} />
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "profit" }) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[0.02] px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-[0.1em] text-muted">{label}</p>
      <p className={cn("mono mt-0.5 truncate text-[13px] font-semibold", tone === "profit" ? "text-profit" : "text-ink")}>
        {value}
      </p>
    </div>
  );
}

function StanceCard({
  tone,
  title,
  agent,
  text,
}: {
  tone: "profit" | "loss";
  title: string;
  agent: string;
  text: string;
}) {
  const isProfit = tone === "profit";
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        isProfit ? "border-profit/20 bg-profit/[0.04]" : "border-loss/20 bg-loss/[0.04]"
      )}
    >
      <p className={cn("text-[9.5px] font-semibold uppercase tracking-[0.12em]", isProfit ? "text-profit" : "text-loss")}>
        {title}
      </p>
      <p className="mt-1 text-[10.5px] font-semibold text-ink/90">{agent}</p>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{text}</p>
    </div>
  );
}
