"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ArenaPool } from "@/lib/types";
import { DEMO_ANCHOR } from "@/lib/mock-data";
import { demoPoolToArena, type Manifest } from "@/lib/markets";
import { insightsFor } from "@/lib/insights";
import { poolStats } from "@/lib/display-stats";
import { SEED_MANIFEST } from "@/lib/manifest";
import { useChainPoolIds, usePools } from "@/hooks/usePredictionArena";

/** Silent refresh cadence for the market manifest, so a daemon-opened listing appears on its own. */
const POLL_MS = 60_000;

/**
 * The one hook the UI needs: reads public/pools.json, joins it with live on-chain pools
 * (ids discovered from the manifest + PoolCreated logs) and returns card-ready models.
 *
 * Demo entries are rendered from the manifest; chain entries get their volatile fields
 * (status / liquidity / payouts) from `getPool`, so a stale manifest can never misreport money.
 *
 * The manifest is re-fetched every 60s in the background. The ops daemon writes new listings into
 * that file, so a tab that is already open picks them up without a hard refresh. Polling pauses
 * while the tab is hidden and only commits state when the file actually changed, which keeps
 * re-renders (and the chart/timer animations) calm.
 */
export function useMarkets() {
  // Seed from the build-time snapshot so the first paint (SSR included) already has markets.
  const [manifest, setManifest] = useState<Manifest | null>(SEED_MANIFEST);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(DEMO_ANCHOR);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const lastStamp = useRef<string>("");

  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/board?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
        const json = (await res.json()) as Manifest;
        if (cancelled) return;

        // Only replace when the daemon actually wrote something: `updatedAt` moves on every
        // ops-refresh pass, the address changes only on a redeploy.
        const stamp = `${json.updatedAt ?? ""}|${json.address ?? ""}|${json.pools?.length ?? 0}`;
        if (stamp !== lastStamp.current) {
          lastStamp.current = stamp;
          setManifest(json);
          setNow(Math.floor(Date.now() / 1000));
        }
        setLastSyncedAt(Date.now());
        setManifestError(null);
      } catch (e) {
        if (!cancelled) setManifestError(String((e as Error)?.message ?? e));
      }
    }

    void load();

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void load();
    };
    const timer = window.setInterval(tick, POLL_MS);

    // a tab coming back into focus should not wait out the remaining interval
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const { ids: discoveredIds, meta: manifestMeta } = useChainPoolIds();

  const chainIds = useMemo(() => {
    const fromManifest = (manifest?.pools ?? [])
      .filter((p) => (p.source ?? "chain") === "chain")
      .map((p) => BigInt(p.id));
    const seen = new Set(fromManifest.map((i) => i.toString()));
    for (const id of discoveredIds) {
      if (!seen.has(id.toString())) {
        seen.add(id.toString());
        fromManifest.push(id);
      }
    }
    return fromManifest;
  }, [manifest, discoveredIds]);

  const { pools: chainPools } = usePools(chainIds);

  const demoPools = useMemo<ArenaPool[]>(
    () =>
      (manifest?.pools ?? [])
        .filter((p) => p.source === "demo")
        .map((p) => demoPoolToArena(p, now)),
    [manifest, now]
  );

  const pools = useMemo<ArenaPool[]>(() => {
    const enrichedChain = chainPools.map((pool) => {
      const meta = manifestMeta[String(pool.id)];
      const category = meta?.category || pool.category;
      return {
        ...pool,
        category,
        tags: meta?.tags ?? [],
        optionLabels: ["Yes", "No"] as [string, string],
        marketData: meta?.marketData,
        // Chain rows get the same contextual commentary as demo rows: the subject, strike and odds
        // are known from the manifest + the pool itself, so an empty pool still reads like a market
        // rather than a blank card.
        aiStances: insightsFor({
          id: pool.id,
          title: pool.title,
          category,
          tags: meta?.tags ?? [],
          endTime: pool.endTime,
          option0Pool: pool.option0Pool,
          option1Pool: pool.option1Pool,
          marketData: meta?.marketData,
        }),
        searchText: [pool.title, category, ...(meta?.tags ?? []), meta?.description ?? "", meta?.resolution ?? ""]
          .join(" ")
          .toLowerCase(),
      };
    });
    // One card per id. The demo row carries the board's presentation numbers (liquidity, traders,
    // volume); the chain row carries settlement state. Demo wins the merge because the board is
    // what the visitor sees, and the id behind it is the same pool the bet goes to.
    const byId = new Map<string, ArenaPool>();
    for (const row of enrichedChain) byId.set(row.id.toString(), row);
    for (const row of demoPools) {
      const onchain = byId.get(row.id.toString());
      // Real liquidity takes precedence: the moment the contract holds stake for this id, the card
      // shows the contract's number and stops advertising a demo depth. A manifest snapshot may be
      // hours old, so its presentation figures must never outrank what the chain says.
      if (onchain && onchain.totalNetPool > 0n) {
        byId.set(row.id.toString(), {
          ...row,
          status: onchain.status,
          winningOption: onchain.winningOption,
          totalNetPool: onchain.totalNetPool,
          option0Pool: onchain.option0Pool,
          option1Pool: onchain.option1Pool,
          settlementHash: onchain.settlementHash,
          source: "chain",
        });
      } else {
        byId.set(row.id.toString(), row);
      }
    }
    return [...byId.values()];
  }, [chainPools, demoPools, manifestMeta]);

  const stats = useMemo(() => {
    // Presentation totals, summed from the same per-card figures the grid renders — a header that
    // added up real pool balances would read $0 next to cards showing $40k.
    const tvl = pools.reduce((sum, p) => sum + poolStats(p).liquidityUsdc, 0n);
    const volume24h = pools.reduce((sum, p) => sum + poolStats(p).volume24hUsdc, 0n);
    return {
      tvl,
      volume24h,
      activeMarkets: pools.filter((p) => p.status === 1).length,
      settledMarkets: pools.filter((p) => p.status === 2).length,
    };
  }, [pools]);

  const featured = useMemo(() => {
    if (!manifest) return pools[0] ?? null;
    if (!manifest.featured) return pools[0] ?? null;
    return pools.find((p) => p.id.toString() === manifest.featured) ?? pools[0] ?? null;
  }, [manifest, pools]);

  return {
    manifest,
    manifestError,
    pools,
    chainIds,
    stats,
    featured,
    loading: !manifest && !manifestError,
    lastSyncedAt,
  };
}
