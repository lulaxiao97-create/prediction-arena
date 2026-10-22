"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ArenaPool } from "@/lib/types";
import { DEMO_ANCHOR } from "@/lib/mock-data";
import { demoPoolToArena, type Manifest } from "@/lib/markets";
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
        const res = await fetch(`/pools.json?t=${Date.now()}`, { cache: "no-store" });
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
      return {
        ...pool,
        category: meta?.category || pool.category,
        tags: meta?.tags ?? [],
        optionLabels: ["Yes", "No"] as [string, string],
      };
    });
    return [...enrichedChain, ...demoPools];
  }, [chainPools, demoPools, manifestMeta]);

  const stats = useMemo(() => {
    const tvl = pools.reduce((sum, p) => sum + p.totalNetPool, 0n);
    const volume24h = pools.reduce((sum, p) => sum + (p.volume24h ?? 0n), 0n);
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
