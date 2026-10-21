"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  Coins,
  Flame,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Navbar, type Category } from "@/components/Navbar";
import { AIAgentsDebate } from "@/components/AIAgentsDebate";
import { ArenaCard } from "@/components/ArenaCard";
import { BetModalHost } from "@/components/BetModal";
import { buildDemoPools } from "@/lib/mock-data";
import { ARENA_ADDRESS, hasArena, usePools } from "@/hooks/usePredictionArena";
import { cn, explorerAddress, formatUsdc, shortAddr } from "@/lib/format";
import type { ArenaPool } from "@/lib/types";

export default function Home() {
  const [category, setCategory] = useState<Category>("All");
  const [selected, setSelected] = useState<{ pool: ArenaPool; option: 0 | 1 } | null>(null);

  // Deterministic on the server, re-anchored to the real clock right after hydration.
  const [demoPools, setDemoPools] = useState<ArenaPool[]>(() => buildDemoPools());
  useEffect(() => {
    setDemoPools(buildDemoPools(Math.floor(Date.now() / 1000)));
  }, []);
  const ids = useMemo(() => demoPools.map((p) => p.id), [demoPools]);
  const labels = useMemo(() => {
    const map: Record<string, [string, string]> = {};
    for (const pool of demoPools) map[String(pool.id)] = pool.optionLabels;
    return map;
  }, [demoPools]);

  const { pools: chainPools } = usePools(ids, labels);

  const pools = useMemo(() => {
    if (!hasArena || chainPools.length === 0) return demoPools;
    const onchain = new Map(chainPools.map((p) => [String(p.id), p]));
    return sim(ids, demoPools, onchain);
  }, [chainPools, demoPools, ids]);

  const filtered = useMemo(
    () => (category === "All" ? pools : pools.filter((p) => p.category === category)),
    [pools, category]
  );

  const stats = useMemo(() => {
    const open = pools.filter((p) => p.status === 1);
    const tvl = pools.reduce((sum, p) => sum + p.totalNetPool, 0n);
    const volume = pools.reduce((sum, p) => sum + (p.volume24h ?? 0n), 0n);
    const traders = pools.reduce((sum, p) => sum + (p.traders ?? 0), 0);
    return { open: open.length, tvl, volume, traders };
  }, [pools]);

  return (
    <div className="min-h-screen">
      <Navbar active={category} onChange={setCategory} />

      {!hasArena && (
        <div className="border-b border-gold/15 bg-gold/[0.06]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2 text-[11px] text-gold-bright/90 sm:px-6">
            <Sparkles className="size-3.5" />
            演示模式：链上合约地址未配置，页面使用本地样例盘口。
            <span className="mono text-[10.5px] text-gold-bright/70">
              NEXT_PUBLIC_ARENA_ADDRESS + bun run abi:export
            </span>
          </div>
        </div>
      )}

      {/* ── hero ───────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-7xl px-4 pb-10 pt-10 sm:px-6 sm:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div
              className="rise-in flex flex-wrap items-center gap-2"
            >
              <span className="chip chip-gold">
                <Flame className="size-3" />
                Base · USDC 原生结算
              </span>
              <span className="chip">
                <BadgeCheck className="size-3 text-profit" />
                4% 抽水实时隔离
              </span>
              <span className="chip">IPFS 判决留痕</span>
            </div>

            <h1
              className="rise-in mt-5 text-[34px] font-bold leading-[1.12] tracking-tight sm:text-5xl lg:text-[56px]"
            >
              <span className="text-ink">AI 智囊团吵出赔率</span>
              <br />
              <span className="gold-text">链上结算，不赖账。</span>
            </h1>

            <p
              className="rise-in mt-4 max-w-xl text-[13.5px] leading-relaxed text-muted"
            >
              宏观鹰派、链上侦探、Meme Master 三方独立辩论，结论附 IPFS 快照；
              预测结果写入 <span className="text-ink/90">bytes32 证据哈希</span>，任何人可复核。
              资金进彩池、抽水进金库，两本账物理隔离。
            </p>

            <div
              className="rise-in mt-6 flex flex-wrap items-center gap-2.5"
            >
              <a href="#arenas" className="btn-gold text-sm">
                <Coins className="size-4" />
                进入竞技场
                <ArrowRight className="size-4" />
              </a>
              <a href="#debate" className="btn-ghost text-sm">
                <BrainCircuit className="size-4" />
                先看 AI 吵架
              </a>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Stat label="总彩池 TVL" value={`$${compact(stats.tvl)}`} hint="USDC" />
              <Stat label="开放盘口" value={String(stats.open)} hint="LIVE" />
              <Stat label="24h 成交" value={`$${compact(stats.volume)}`} hint="USDC" />
              <Stat label="参与地址" value={stats.traders.toLocaleString()} hint="ALL TIME" />
            </div>
          </div>

          {/* right: fee engine card */}
          <div
            className="glass scanline rise-in relative overflow-hidden rounded-3xl p-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Fee Engine</p>
                <p className="mt-1 text-sm font-semibold text-ink">抽水即隔离 · 不碰彩池</p>
              </div>
              <ShieldCheck className="size-5 text-gold" />
            </div>

            <div className="mt-5 space-y-3">
              <StackBar label="进入彩池（玩家资金）" percent={96} tone="profit" />
              <StackBar label="平台纯利（70% 抽水）" percent={2.8} tone="gold" />
              <StackBar label="KOL 返佣（30% 抽水）" percent={1.2} tone="muted" />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 text-[11px]">
              <MiniStat label="平台抽水" value="4.00%" tone="gold" />
              <MiniStat label="KOL 返佣" value="1.20%" tone="profit" />
              <MiniStat label="单笔上限" value="20% / ≥50" tone="muted" />
              <MiniStat label="最低下注" value="5 USDC" tone="muted" />
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2">
              <span className="size-1.5 rounded-full bg-profit shadow-[0_0_10px_2px_rgba(16,185,129,0.5)]" />
              <p className="mono text-[10.5px] text-muted">
                账本不变式：balance ≥ Σpools + adminFees + referralFees
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── debate ─────────────────────────────────────────────── */}
      <section id="debate" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-8 sm:px-6">
        <SectionHeading
          eyebrow="AI INTELLIGENCE"
          title="判决之前，先让三方吵完"
          desc="每个结论都带可验证的快照；盘口结算时该快照的哈希会永久写入链上事件。"
        />
        <div className="mt-4">
          <AIAgentsDebate category={category === "All" ? "macro" : category} />
        </div>
      </section>

      {/* ── arenas ─────────────────────────────────────────────── */}
      <section id="arenas" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionHeading
            eyebrow="LIVE MARKETS"
            title="选择你的战场"
            desc={`${filtered.length} 个盘口 · 双向彩池 · 赢家按 net pool 比例分账`}
          />
          <div className="flex flex-wrap gap-1.5">
            {(["All", "Macro", "Ecosystem", "Tech", "CT Drama"] as Category[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setCategory(tab)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[11px] transition-colors",
                  category === tab
                    ? "border-gold/50 bg-gold/12 text-gold-bright"
                    : "border-white/8 text-muted hover:border-white/20 hover:text-ink"
                )}
              >
                {tab}
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
            这个分类暂时没有开放盘口，换个 Tab 看看。
          </p>
        )}
      </section>

      {/* ── how it works ───────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <SectionHeading
          eyebrow="HOW IT WORKS"
          title="三步，没有黑箱"
          desc="从下注到领奖，每一步都能在 Basescan 上核对。"
        />
        <div className="mt-4 grid gap-3.5 md:grid-cols-3">
          <Step
            index="01"
            title="下注瞬间拆账"
            body="转账立即拆成 96% 彩池 + 4% 抽水；抽水再按 70/30 分给平台与 KOL，三本账互不挪用。"
            icon={<ArrowDownRight className="size-4 text-gold" />}
          />
          <Step
            index="02"
            title="关盘 + 证据上链"
            body="endTime 后管理员调用 settle(option, bytes32)，IPFS 快照哈希写入事件与存储，全网可复核。"
            icon={<FingerprintIcon />}
          />
          <Step
            index="03"
            title="赢家自取奖金"
            body="claimRewards 按 (本金 / 获胜侧) × 总 net pool 赔付，pull 模式 + nonReentrant，无二次领取。"
            icon={<Wallet className="size-4 text-gold" />}
          />
        </div>
      </section>

      {/* ── footer ────────────────────────────────────────────── */}
      <footer className="mt-8 border-t border-white/6 bg-void/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="gold-text text-sm font-semibold tracking-[0.2em]">PREDICTION ARENA</p>
            <p className="mt-1 text-[11px] text-muted">
              AI 预测对赌竞技场 · Base 主网 · USDC 结算
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
                合约 {shortAddr(ARENA_ADDRESS, 5)}
              </a>
            ) : (
              <span className="chip">合约未部署</span>
            )}
            <span className="chip">4% rake</span>
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

function sim(
  ids: bigint[],
  demo: ArenaPool[],
  onchain: Map<string, ArenaPool>
): ArenaPool[] {
  return ids.map((id) => {
    const base = demo.find((p) => p.id === id)!;
    const live = onchain.get(String(id));
    if (!live) return base;
    return {
      ...base,
      ...live,
      optionLabels: base.optionLabels,
      traders: base.traders,
      volume24h: base.volume24h,
    };
  });
}

function compact(value: bigint): string {
  const n = Number(value) / 1_000_000;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="glass-soft rounded-xl px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mono mt-1 text-lg font-semibold text-ink">{value}</p>
      <p className="mono text-[9px] tracking-[0.12em] text-muted/60">{hint}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "gold" | "profit" | "muted";
}) {
  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-2">
      <p className="text-[10px] text-muted">{label}</p>
      <p
        className={cn(
          "mono mt-0.5 text-sm font-semibold",
          tone === "gold" ? "text-gold-bright" : tone === "profit" ? "text-profit" : "text-ink/85"
        )}
      >
        {value}
      </p>
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
      <div className="flex items-center justify-between text-[11px]">
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
        <span className="grid size-7 place-items-center rounded-lg border border-gold/25 bg-gold/8">
          {icon}
        </span>
      </div>
      <h3 className="mt-2.5 text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function FingerprintIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 text-gold" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 4c-4.4 0-8 3.6-8 8 0 1.3.3 2.6.9 3.7" strokeLinecap="round" />
      <path d="M12 8c-2.2 0-4 1.8-4 4 0 2.6.6 5 1.8 7" strokeLinecap="round" />
      <path d="M16 12c0-2.2-1.8-4-4-4" strokeLinecap="round" />
      <path d="M12 12c0 3.2.8 6.2 2.2 8.8" strokeLinecap="round" />
      <path d="M16 12c0 3.6.7 6.8 2 9" strokeLinecap="round" />
    </svg>
  );
}
