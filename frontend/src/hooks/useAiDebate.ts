"use client";

import { useEffect, useMemo, useState } from "react";
import { generateDebate, type DebateLine } from "@/lib/auto-gen";
import { SEED_DEBATES } from "@/lib/manifest";
import { pickDebate, type DebateCache } from "@/lib/debate-cache";

/** The daemon rewrites this file; a long-lived tab picks changes up without a reload. */
const POLL_MS = 5 * 60 * 1000;

/**
 * Debate for a market — read-only.
 *
 * Three sources, in order: the build-time cache (instant, zero network), the runtime cache file
 * (picks up markets the daemon added since the build), then the deterministic kernel as a floor so
 * a brand-new market is never blank.
 *
 * **No request is ever made to a model from this hook.** Generation lives in
 * `scripts/gen-debates.ts`, driven by the ops tick. Opening a market costs nothing.
 */
export function useAiDebate(input: {
  poolId: string;
  category: string;
  title: string;
  yesPct: number;
  netPoolUsdc?: number;
  enabled?: boolean;
}) {
  const { poolId, category, title, yesPct, netPoolUsdc, enabled = true } = input;

  const kernel = useMemo(
    () => generateDebate({ poolId, category, title, yesPct, netPoolUsdc }),
    [poolId, category, title, yesPct, netPoolUsdc]
  );

  // build-time snapshot → synchronous, identical on server and client
  const seeded = useMemo(() => pickDebate(SEED_DEBATES as unknown as DebateCache, poolId, yesPct), [poolId, yesPct]);

  const [cache, setCache] = useState<DebateCache | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`/debates.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as DebateCache;
        if (!cancelled) setCache(json);
      } catch {
        /* the seed and the kernel below are already on screen */
      }
    };

    void load();
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void load();
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  const runtime = useMemo(() => (cache ? pickDebate(cache, poolId, yesPct) : null), [cache, poolId, yesPct]);

  const entry = runtime ?? seeded;
  const lines: DebateLine[] = entry?.lines?.length ? (entry.lines as DebateLine[]) : kernel;

  return {
    lines,
    source: entry ? entry.source : ("kernel" as const),
    generatedAt: entry?.at ?? null,
    pending: false,
  };
}
