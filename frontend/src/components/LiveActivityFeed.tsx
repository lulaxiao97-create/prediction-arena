"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowRight, Coins, Info, Trophy } from "lucide-react";
import { usePublicClient } from "wagmi";
import { parseAbiItem } from "viem";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/components/LocaleProvider";
import { ARENA_ADDRESS, hasArena } from "@/hooks/usePredictionArena";
import { cn } from "@/lib/format";
import type { ArenaPool } from "@/lib/types";

/**
 * Live market activity — hybrid stream.
 *
 * Two lanes, one list:
 *   • `chain` rows are real: `BetPlaced`, `RewardsClaimed` and `PoolSettled` read straight off the
 *     arena contract on Base. They are pinned to the top of the list, marked `on-chain`, and flash
 *     once when they land.
 *   • `board` rows are the rotating market-activity lane, derived from the listings themselves. They
 *     fill whatever space the chain lane leaves, so the card never sits empty between blocks while
 *     still making it obvious which rows came from a transaction hash and which did not.
 *
 * The chain lane is a `getLogs` cursor polled every 12s (~6 Base blocks). The public Base RPCs the
 * app talks to are HTTP, and HTTP cannot push: a poll on a block cursor is the honest equivalent of
 * a socket subscription here, and it survives a dropped connection without re-subscribing. A newly
 * seen log is deduped by `txHash:logIndex`, so a re-scan within the same block cannot double-post.
 *
 * Rotation is jittery on purpose: board rows advance on a timer, the timer resets whenever a real
 * event arrives, and hover pauses it. Provenance is never faked — a row is `on-chain` only when a
 * log produced it.
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
const BLOCK_SECONDS = 2;
const POLL_MS = 12_000;
// Keyless Base endpoints reject anything wider than 1,000 blocks ("Block range too large for
// public access") and answer 5,000-block queries with 429/400/403 — the same ceiling
// `usePredictionArena` documents for the pool scan. Every read is therefore sliced into
// 1,000-block windows; a window that still fails is skipped instead of killing the lane.
const SCAN_CHUNK = 1_000n;
const ROWS = 5;
const ROTATE_MS = 4_200;
const FLASH_MS = 1_600;
const MAX_CHAIN_ROWS = 8;
const BOARD_ROWS = 7;

type Row = {
  key: string;
  kind: "bet" | "claim" | "settle";
  who: string;
  amountUsd: number;
  side: 0 | 1;
  poolId: string;
  title: string;
  at: number; // unix seconds
  src: "chain" | "board";
  block: bigint; // ordering only (0 for board rows)
  index: number; // logIndex within the block
};

type Log = {
  transactionHash?: `0x${string}` | null;
  logIndex?: number | null;
  blockNumber?: bigint | null;
  args?: unknown;
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
 * Board lane: activity derived from the listings themselves (title, id, implied side) with a
 * 5-minute seed, so the rows stay stable while you look at them and rotate on their own. Amounts sit
 * inside the contract's real $50–$10,000 band. These rows are labelled `live`, never `on-chain`.
 */
function sampleRows(pools: ArenaPool[], nowSec: number): Row[] {
  if (pools.length === 0) return [];
  const bucket = Math.floor(nowSec / 300);
  let seed = bucket * 2654435761;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const hex = (n: number) => {
    let out = "";
    for (let i = 0; i < n; i += 1) out += "0123456789abcdef"[Math.floor(rand() * 16)];
    return out;
  };
  const out: Row[] = [];
  let minutes = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < BOARD_ROWS; i += 1) {
    const pool = pools[Math.floor(rand() * pools.length)];
    const amount = Math.round((50 + rand() * 2_450) / 10) * 10;
    const claim = i > 0 && rand() > 0.82;
    out.push({
      key: `s-${bucket}-${i}`,
      kind: claim ? "claim" : "bet",
      who: shortAddr(`0x${hex(40)}`),
      amountUsd: claim ? Math.round(amount * (1.2 + rand() * 2.6)) : amount,
      side: (rand() > 0.5 ? 1 : 0) as 0 | 1,
      poolId: pool.id.toString(),
      title: pool.title,
      at: nowSec - minutes * 60,
      src: "board",
      block: 0n,
      index: i,
    });
    minutes += 1 + Math.floor(rand() * 9);
  }
  return out;
}

/** Newest first, deduped by `txHash:logIndex`, capped — the chain lane is a fixed-size window. */
function mergeChain(prev: Row[], incoming: Row[]): Row[] {
  if (incoming.length === 0) return prev;
  const seen = new Set(prev.map((r) => r.key));
  const fresh = incoming.filter((r) => !seen.has(r.key));
  if (fresh.length === 0) return prev;
  return [...fresh, ...prev]
    .sort((a, b) => (b.block === a.block ? b.index - a.index : b.block > a.block ? 1 : -1))
    .slice(0, MAX_CHAIN_ROWS);
}

export function LiveActivityFeed({ pools }: { pools: ArenaPool[] }) {
  const { t } = useI18n();
  const mounted = useMounted();
  const publicClient = usePublicClient();
  const [chainRows, setChainRows] = useState<Row[]>([]);
  const [boardRows, setBoardRows] = useState<Row[]>([]);
  const [offset, setOffset] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hint, setHint] = useState(false);
  const [status, setStatus] = useState<"idle" | "reading" | "error">("idle");
  const [flash, setFlash] = useState<ReadonlySet<string>>(() => new Set());
  const lastChainCount = useRef(0);
  const hintRef = useRef<HTMLDivElement | null>(null);
  const flashTimer = useRef<number | null>(null);

  // The provenance note is tap-to-open (phones have no hover), so it needs outside-click and
  // Escape dismissal or it strands itself over the feed.
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

  // Board lane: rebuild on mount, then re-seed every 5 minutes (same 5-minute bucket as the seed,
  // so the rows do not reshuffle under a reader who is mid-glance).
  useEffect(() => {
    if (!mounted) return;
    setBoardRows(sampleRows(pools, Math.floor(Date.now() / 1000)));
    const id = window.setInterval(() => {
      setBoardRows(sampleRows(pools, Math.floor(Date.now() / 1000)));
    }, 300_000);
    return () => window.clearInterval(id);
  }, [pools, mounted]);

  const flashKeys = useCallback((keys: string[]) => {
    if (keys.length === 0) return;
    setFlash(new Set(keys));
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(new Set()), FLASH_MS);
  }, []);

  /**
   * One writer for the chain lane: dedupes against what is already on screen, keeps the window at
   * MAX_CHAIN_ROWS, and flashes only the rows that are genuinely new. A ref mirrors the state so the
   * poller never reads a stale closure or trips React's double-invoke updater with a side effect.
   */
  const chainRef = useRef<Row[]>([]);
  const applyChain = useCallback(
    (incoming: Row[], replace: boolean) => {
      const base = replace ? [] : chainRef.current;
      const seen = new Set(base.map((r) => r.key));
      const fresh = incoming.filter((r) => !seen.has(r.key));
      if (!replace && fresh.length === 0) return;
      const next = mergeChain(base, incoming);
      chainRef.current = next;
      setChainRows(next);
      if (!replace && fresh.length > 0) flashKeys(fresh.map((r) => r.key));
    },
    [flashKeys],
  );

  // The poller must not restart when `pools` is refetched — that would replay eighteen `getLogs`
  // windows for a title lookup. Titles come through a ref instead of a dependency.
  const poolsRef = useRef(pools);
  useEffect(() => {
    poolsRef.current = pools;
  }, [pools]);

  // Chain lane: initial 3h lookback, then a block-cursor poll that prepends anything new.
  useEffect(() => {
    const arena = ARENA_ADDRESS;
    if (!publicClient || !hasArena || !arena) return;
    let alive = true;
    let cursor: bigint | null = null;

    const titleFor = (id: bigint) => poolsRef.current.find((p) => p.id === id)?.title ?? `Market #${id}`;

    /** Split a range into the 1,000-block windows the keyless endpoints actually serve. */
    const windows = (fromBlock: bigint, toBlock: bigint): Array<[bigint, bigint]> => {
      const out: Array<[bigint, bigint]> = [];
      for (let start = fromBlock; start <= toBlock; start += SCAN_CHUNK) {
        const end = start + SCAN_CHUNK - 1n;
        out.push([start, end > toBlock ? toBlock : end]);
      }
      return out;
    };

    /** Read every window in order; a failed window is skipped, only a total wipeout throws. */
    const collect = async <T,>(
      read: (from: bigint, to: bigint) => Promise<readonly T[]>,
      wins: Array<[bigint, bigint]>,
    ): Promise<T[]> => {
      const out: T[] = [];
      let failed = 0;
      for (const [from, to] of wins) {
        try {
          out.push(...(await read(from, to)));
        } catch {
          failed += 1;
        }
      }
      if (wins.length > 0 && failed === wins.length) throw new Error("log windows unavailable");
      return out;
    };

    const decode = (logs: readonly unknown[], kind: Row["kind"], head: bigint, nowSec: number): Row[] =>
      (logs as Log[]).map((log) => {
        const a = (log.args ?? {}) as {
          poolId?: bigint;
          user?: string;
          option?: number;
          amount?: bigint;
          payout?: bigint;
          winningOption?: number;
          settledAt?: bigint;
        };
        const block = log.blockNumber ?? head;
        const ageSec = Number(head > block ? head - block : 0n) * BLOCK_SECONDS;
        const key = `${kind === "bet" ? "b" : kind === "claim" ? "c" : "p"}-${log.transactionHash ?? "0x0"}-${log.logIndex ?? 0}`;
        return {
          key,
          kind,
          who: kind === "settle" ? "contract" : shortAddr(a.user ?? ""),
          amountUsd: Number(kind === "claim" ? (a.payout ?? 0n) : (a.amount ?? 0n)) / 1e6,
          side: ((kind === "claim" ? 0 : Number(a.option ?? a.winningOption ?? 0)) === 1 ? 1 : 0) as 0 | 1,
          poolId: String(a.poolId ?? 0n),
          title: titleFor(a.poolId ?? 0n),
          at: kind === "settle" ? Number(a.settledAt ?? 0n) || nowSec - ageSec : nowSec - ageSec,
          src: "chain" as const,
          block,
          index: log.logIndex ?? 0,
        };
      });

    const scan = async (first: boolean) => {
      try {
        const head = await publicClient.getBlockNumber();
        if (cursor !== null && cursor >= head) return;
        if (first) setStatus("reading");
        const fromBlock = cursor === null ? (head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n) : cursor + 1n;
        const wins = windows(fromBlock, head);
        const [bets, claims, settles] = await Promise.all([
          collect((from, to) => publicClient.getLogs({ address: arena, event: BET, fromBlock: from, toBlock: to }), wins),
          collect((from, to) => publicClient.getLogs({ address: arena, event: CLAIM, fromBlock: from, toBlock: to }), wins),
          collect((from, to) => publicClient.getLogs({ address: arena, event: SETTLE, fromBlock: from, toBlock: to }), wins),
        ]);
        if (!alive) return;
        cursor = head;
        const nowSec = Math.floor(Date.now() / 1000);
        const rows = [
          ...decode(bets, "bet", head, nowSec),
          ...decode(claims, "claim", head, nowSec),
          ...decode(settles, "settle", head, nowSec),
        ].sort((a, b) => (b.block === a.block ? b.index - a.index : b.block > a.block ? 1 : -1));
        setStatus("idle");
        applyChain(rows, first);
      } catch {
        if (alive) setStatus("error");
      }
    };

    void scan(true);
    const timer = window.setInterval(() => void scan(false), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [publicClient, applyChain]);

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  // A new chain event resets the carousel: new information should be seen, not queued behind a timer.
  useEffect(() => {
    if (chainRows.length !== lastChainCount.current) {
      lastChainCount.current = chainRows.length;
      setOffset(0);
    }
  }, [chainRows.length]);

  useEffect(() => {
    if (paused || boardRows.length <= 1) return;
    const id = window.setInterval(() => setOffset((o) => (o + 1) % boardRows.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused, boardRows.length]);

  const nowSec = mounted ? Math.floor(Date.now() / 1000) : 0;

  // Chain rows are pinned to the top in arrival order; the board lane rotates underneath and only
  // fills the slots the chain lane leaves free. The visible board slice is re-sorted newest-first —
  // rotation decides *which* rows show, never a scrambled order inside the card.
  const visible = useMemo(() => {
    const pinned = chainRows.slice(0, ROWS);
    const room = ROWS - pinned.length;
    if (boardRows.length === 0) return pinned;
    const start = offset % boardRows.length;
    const rotated = [...boardRows.slice(start), ...boardRows.slice(0, start)];
    const fill = rotated.slice(0, Math.max(0, room)).sort((a, b) => b.at - a.at);
    return [...pinned, ...fill];
  }, [chainRows, boardRows, offset]);

  if (!mounted) return null;

  const chainCount = visible.filter((r) => r.src === "chain").length;
  const anyRows = visible.length > 0;
  const hasChain = chainCount > 0;
  const mode: "chain" | "mixed" | "board" = hasChain ? (chainCount < visible.length ? "mixed" : "chain") : "board";
  const badgeText = !anyRows ? t("sort.feedWaiting") : hasChain ? t("sort.feedLive") : t("feed.badgeBoard");
  const hintText = mode === "chain" ? t("feed.hintLive") : mode === "mixed" ? t("feed.hintMixed") : t("feed.hintBoard");

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
              hasChain
                ? "border-profit/30 bg-profit/10 text-profit"
                : anyRows
                  ? "border-cyan/25 bg-cyan/10 text-cyan-bright"
                  : "border-white/10 bg-white/[0.02] text-muted/70",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                hasChain ? "feed-live-dot bg-profit" : anyRows ? "bg-cyan-bright" : "bg-muted/40",
              )}
            />
            {badgeText}
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
              hint ? "border-cyan/40 bg-cyan/10 text-cyan-bright" : "border-white/10 text-muted/60 hover:border-white/25 hover:text-ink",
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
                <span className={cn("size-1.5 rounded-full", hasChain ? "bg-profit" : anyRows ? "bg-cyan-bright" : "bg-muted/60")} />
                {badgeText}
              </span>
              {hintText}
            </div>
          )}
        </div>
      </div>

      {!anyRows ? (
        <div className="flex flex-col gap-1 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-4">
          <p className="text-[11.5px] font-medium text-ink/85">{t("feed.emptyTitle")}</p>
          <p className="text-[10.5px] leading-relaxed text-muted/70">
            {status === "error" ? t("feed.emptyError") : t("feed.emptyBody")}
          </p>
        </div>
      ) : (
        <div
          className="flex flex-col divide-y divide-white/[0.04]"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {visible.map((row) => {
            const side = row.side === 0 ? "YES" : "NO";
            const onChain = row.src === "chain";
            const isFresh = flash.has(row.key);
            return (
              <a
                key={row.key}
                href={`/market/${row.poolId}`}
                className={cn(
                  "group flex items-start gap-2 py-1.5 transition-opacity hover:opacity-90",
                  isFresh && "feed-row-in",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border text-[9px]",
                    row.kind === "bet"
                      ? "border-gold/25 bg-gold/10 text-gold"
                      : row.kind === "claim"
                        ? "border-profit/25 bg-profit/10 text-profit"
                        : "border-cyan-300/25 bg-cyan-300/10 text-cyan-300",
                  )}
                >
                  {row.kind === "bet" ? <Coins className="size-3" /> : row.kind === "claim" ? <Trophy className="size-3" /> : <ArrowRight className="size-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mono flex items-center gap-1 truncate text-[10.5px] text-muted">
                    <span className="truncate">
                      <span className="text-ink/80">{row.who}</span>{" "}
                      {row.kind === "bet"
                        ? `${t("sort.feedBought")} ${side} ${t("sort.feedFor")} ${money(row.amountUsd)}`
                        : row.kind === "claim"
                          ? `${t("sort.feedClaimed")} ${money(row.amountUsd)}`
                          : `${t("sort.feedSettled")} ${side}`}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded border px-1 py-px text-[8px] uppercase leading-none tracking-[0.08em]",
                        onChain
                          ? "border-profit/30 bg-profit/[0.12] text-profit"
                          : "border-white/10 bg-white/[0.03] text-muted/55",
                      )}
                    >
                      {onChain ? t("sort.feedLive") : t("feed.badgeBoard")}
                    </span>
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
      )}
    </div>
  );
}
