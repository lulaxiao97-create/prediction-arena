"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowRight, Coins, Info, Trophy } from "lucide-react";
import { usePublicClient } from "wagmi";
import { parseAbiItem } from "viem";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/components/LocaleProvider";
import { ARENA_ADDRESS, hasArena } from "@/hooks/usePredictionArena";
import { cn } from "@/lib/format";
import type { ArenaPool } from "@/lib/types";

/**
 * Live market activity.
 *
 * Reads `BetPlaced` / `RewardsClaimed` / `PoolSettled` from the arena contract over the last
 * ~3 hours of Base blocks. When the contract has no events in that window — which is the normal
 * state until the fee wallet is funded — it falls back to a deterministic "heat" stream built
 * from the live board (real titles, real probabilities), and labels every row as `sample` so a
 * visitor is never told a trade happened when none did.
 *
 * Rotation is deliberately jittery: rows advance on a timer, the timer resets whenever a real
 * event arrives, and hover pauses it. A feed that slides at a constant rate with nothing behind
 * it reads as decoration.
 */

const BET = parseAbiItem(
  "event BetPlaced(uint256 indexed poolId, address indexed user, uint8 indexed option, uint256 amount, uint256 netStake, uint256 fee, address ref, uint256 referralCut)"
);
const CLAIM = parseAbiItem(
  "event RewardsClaimed(uint256 indexed poolId, address indexed user, uint256 stake, uint256 payout)"
);
const SETTLE = parseAbiItem(
  "event PoolSettled(uint256 indexed poolId, uint8 winningOption, bytes32 ipfsDataHash, uint256 netPool, uint256 settledAt)"
);

const LOOKBACK_BLOCKS = 5_400n; // ~3h at Base's 2s block time
const ROWS = 5;
const ROTATE_MS = 4200;

type Row = {
  key: string;
  kind: "bet" | "claim" | "settle";
  who: string;
  amountUsd: number;
  side: 0 | 1;
  poolId: string;
  title: string;
  at: number; // unix seconds
  live: boolean;
};

function shortAddr(a: string): string {
  const s = String(a ?? "");
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s || "0x…";
}

function money(v: number): string {
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(v < 10 ? 1 : 0)}`;
  return `$${v.toFixed(2)}`;
}

function ago(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3_600)}h`;
}

/**
 * Deterministic sample rows: stable for a given hour, different every hour.
 *
 * This is what a visitor sees before the fee wallet is funded, so it has to be plausible at a
 * glance: truncated addresses shaped exactly like a real 0x hash, one pool per row (a feed that
 * repeats a title reads generated), newest first, and a long-tail amount distribution instead of
 * five identical round numbers.
 */
function sampleRows(pools: ArenaPool[], hour: number, nowSec: number): Row[] {
  const open = pools.filter((p) => p.status === 1);
  if (!open.length) return [];
  let seed = hour * 2654435761;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const hex = (n: number) =>
    Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rand() * 16)]).join("");

  const used = new Set<string>();
  const rows: Row[] = [];
  let backSec = 42 * 60 + Math.floor(rand() * 40 * 60); // oldest row lands 42–82 min ago

  for (let i = 0; i < ROWS; i += 1) {
    let pool = open[Math.floor(rand() * open.length)];
    for (let tries = 0; tries < 8 && used.has(String(pool.id)); tries += 1) {
      pool = open[Math.floor(rand() * open.length)];
    }
    used.add(String(pool.id));

    const yesShare = Number(pool.option0Pool) / Math.max(1, Number(pool.totalNetPool));
    const side: 0 | 1 = rand() < yesShare ? 0 : 1;
    const ticket = 20 + Math.floor(rand() * 13) * 10; // $20–$140 in tens
    const amountUsd = rand() < 0.18 ? ticket * (3 + Math.floor(rand() * 4)) : ticket; // occasional whale

    rows.push({
      key: `s-${hour}-${i}`,
      kind: "bet" as const,
      who: `0x${hex(6)}…${hex(4)}`,
      amountUsd,
      side,
      poolId: pool.id.toString(),
      title: pool.title,
      at: nowSec - backSec,
      live: false,
    });

    backSec = Math.max(8, backSec - (90 + Math.floor(rand() * 840))); // 1.5–15 min apart
  }
  return rows.reverse(); // newest first, like the real event stream
}

export function LiveActivityFeed({ pools }: { pools: ArenaPool[] }) {
  const { t } = useI18n();
  const mounted = useMounted();
  const publicClient = usePublicClient();
  const [events, setEvents] = useState<Row[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hint, setHint] = useState(false);
  const lastLiveCount = useRef(0);
  const hintRef = useRef<HTMLDivElement | null>(null);

  // The provenance note is a tap-to-open popover (phones have no hover), so it needs the usual
  // outside-click / Escape dismissal or it strands itself over the feed.
  useEffect(() => {
    if (!hint) return;
    const onDown = (e: MouseEvent) => {
      if (!hintRef.current?.contains(e.target as Node)) setHint(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHint(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [hint]);

  // Only read the chain when the manifest actually lists an on-chain market: with none, there
  // cannot be a trade to show, and an unnecessary getLogs is exactly what produced a wall of
  // 400/429 transport errors in the console (every fallback transport tried the range).
  const hasChainMarket = useMemo(() => pools.some((p) => p.source === "chain"), [pools]);

  // One read per mount; a failure is not an error state — the sample stream covers it.
  useEffect(() => {
    if (!publicClient || !hasArena || !ARENA_ADDRESS || !hasChainMarket) return;
    let alive = true;
    (async () => {
      try {
        const head = await publicClient.getBlockNumber();
        const fromBlock = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
        const [bets, claims, settles] = await Promise.all([
          publicClient.getLogs({ address: ARENA_ADDRESS, event: BET, fromBlock, toBlock: "latest" }),
          publicClient.getLogs({ address: ARENA_ADDRESS, event: CLAIM, fromBlock, toBlock: "latest" }),
          publicClient.getLogs({ address: ARENA_ADDRESS, event: SETTLE, fromBlock, toBlock: "latest" }),
        ]);
        if (!alive) return;
        const titleFor = (id: bigint) => pools.find((p) => p.id === id)?.title ?? `Market #${id}`;
        const rows: Row[] = [
          ...bets.map((l) => {
            const a = l.args as {
              poolId?: bigint; user?: string; option?: number; amount?: bigint;
            };
            return {
              key: `b-${l.transactionHash}-${l.logIndex}`,
              kind: "bet" as const,
              who: shortAddr(a.user ?? ""),
              amountUsd: Number(a.amount ?? 0n) / 1e6,
              side: (Number(a.option ?? 0) === 1 ? 1 : 0) as 0 | 1,
              poolId: String(a.poolId ?? 0n),
              title: titleFor(a.poolId ?? 0n),
              at: Math.floor(Date.now() / 1000),
              live: true,
            };
          }),
          ...claims.map((l) => {
            const a = l.args as { poolId?: bigint; user?: string; payout?: bigint };
            return {
              key: `c-${l.transactionHash}-${l.logIndex}`,
              kind: "claim" as const,
              who: shortAddr(a.user ?? ""),
              amountUsd: Number(a.payout ?? 0n) / 1e6,
              side: 0 as const,
              poolId: String(a.poolId ?? 0n),
              title: titleFor(a.poolId ?? 0n),
              at: Math.floor(Date.now() / 1000),
              live: true,
            };
          }),
          ...settles.map((l) => {
            const a = l.args as { poolId?: bigint; winningOption?: number; settledAt?: bigint };
            return {
              key: `s2-${l.transactionHash}-${l.logIndex}`,
              kind: "settle" as const,
              who: "contract",
              amountUsd: 0,
              side: (Number(a.winningOption ?? 0) === 1 ? 1 : 0) as 0 | 1,
              poolId: String(a.poolId ?? 0n),
              title: titleFor(a.poolId ?? 0n),
              at: Number(a.settledAt ?? 0n) || Math.floor(Date.now() / 1000),
              live: true,
            };
          }),
        ];
        setEvents(rows);
      } catch {
        if (alive) setEvents([]); // reader unavailable → sample stream, not an error banner
      }
    })();
    return () => {
      alive = false;
    };
  }, [publicClient, pools, hasChainMarket]);

  const nowSec = mounted ? Math.floor(Date.now() / 1000) : 0;
  const hour = mounted ? Math.floor(nowSec / 3_600) : 0;

  const rows = useMemo(() => {
    const live = (events ?? []).filter((r) => r.live);
    if (live.length) return live.slice(0, ROWS);
    return sampleRows(pools, hour, nowSec || 0);
  }, [events, pools, hour, nowSec]);

  // A live event resets the rotation: new information should be seen, not queued behind a timer.
  useEffect(() => {
    const liveCount = (events ?? []).filter((r) => r.live).length;
    if (liveCount !== lastLiveCount.current) {
      lastLiveCount.current = liveCount;
      setOffset(0);
    }
  }, [events]);

  useEffect(() => {
    if (paused || rows.length <= 1) return;
    const id = window.setInterval(() => setOffset((o) => (o + 1) % rows.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused, rows.length]);

  if (!mounted || !rows.length) return null;

  const ordered = [...rows.slice(offset), ...rows.slice(0, offset)];
  const anyLive = rows.some((r) => r.live);

  return (
    <div className="glass flex min-w-0 flex-col gap-2 rounded-3xl p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[9.5px] uppercase tracking-[0.2em] text-muted">
          <Activity className="size-3 shrink-0 text-gold" />
          <span className="truncate">{t("sort.feedTitle")}</span>
        </span>
        <div ref={hintRef} className="relative flex shrink-0 items-center gap-1">
          <span
            aria-live="polite"
            className={cn(
              "mono flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] transition-colors duration-500",
              anyLive
                ? "border-profit/30 bg-profit/10 text-profit"
                : "border-white/10 bg-white/[0.02] text-muted/70"
            )}
          >
            <span className={cn("size-1.5 rounded-full", anyLive ? "animate-pulse bg-profit" : "bg-muted/50")} />
            {anyLive ? t("sort.feedLive") : t("sort.feedSample")}
          </span>
          <button
            type="button"
            onClick={() => setHint((v) => !v)}
            aria-expanded={hint}
            aria-controls="live-feed-provenance"
            aria-label={t("feed.hintLabel")}
            title={t("feed.hintLabel")}
            className={cn(
              "grid size-5 touch-manipulation place-items-center rounded-full border transition-colors",
              hint
                ? "border-cyan/40 bg-cyan/10 text-cyan-bright"
                : "border-white/10 text-muted/60 hover:border-white/25 hover:text-ink"
            )}
          >
            <Info className="size-3" />
          </button>

          {hint && (
            <div
              id="live-feed-provenance"
              role="tooltip"
              className="panel-in absolute right-0 top-[calc(100%+6px)] z-20 w-[17.5rem] rounded-xl border border-white/12 bg-[#0d1220] p-3 text-[10.5px] leading-relaxed text-muted shadow-[0_18px_44px_-10px_rgba(0,0,0,0.95)]"
            >
              <span className="mono mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.16em] text-ink/80">
                <span className={cn("size-1.5 rounded-full", anyLive ? "bg-profit" : "bg-muted/60")} />
                {anyLive ? t("sort.feedLive") : t("sort.feedSample")}
              </span>
              {anyLive ? t("feed.hintLive") : t("feed.hintSample")}
            </div>
          )}
        </div>
      </div>

      <div
        className="flex flex-col divide-y divide-white/[0.04]"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {ordered.slice(0, ROWS).map((row) => {
          const side = row.side === 0 ? "YES" : "NO";
          return (
            <a
              key={row.key}
              href={`/market/${row.poolId}`}
              className="group flex items-start gap-2 py-1.5 transition-opacity hover:opacity-90"
            >
              <span
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border text-[9px]",
                  row.kind === "bet"
                    ? "border-gold/25 bg-gold/10 text-gold"
                    : row.kind === "claim"
                      ? "border-profit/25 bg-profit/10 text-profit"
                      : "border-cyan-300/25 bg-cyan-300/10 text-cyan-300"
                )}
              >
                {row.kind === "bet" ? <Coins className="size-3" /> : row.kind === "claim" ? <Trophy className="size-3" /> : <ArrowRight className="size-3" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="mono block truncate text-[10.5px] text-muted">
                  <span className="text-ink/80">{row.who}</span>{" "}
                  {row.kind === "bet"
                    ? `${t("sort.feedBought")} ${side} ${t("sort.feedFor")} ${money(row.amountUsd)}`
                    : row.kind === "claim"
                      ? `${t("sort.feedClaimed")} ${money(row.amountUsd)}`
                      : `${t("sort.feedSettled")} ${side}`}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-ink/85 group-hover:text-gold-bright">
                  {row.title}
                </span>
              </span>
              <span className="mono mt-0.5 shrink-0 text-[9.5px] text-muted/50">{ago(Math.max(1, nowSec - row.at))}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
