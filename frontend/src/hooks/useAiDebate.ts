"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { generateDebate, type DebateLine } from "@/lib/auto-gen";

const CACHE_PREFIX = "pa:debate:";
const TTL_MS = 24 * 60 * 60 * 1000;

type Cached = { at: number; lines: DebateLine[] };

function readCache(key: string): DebateLine[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed?.lines?.length || Date.now() - parsed.at > TTL_MS) return null;
    return parsed.lines;
  } catch {
    return null;
  }
}

function writeCache(key: string, lines: DebateLine[]) {
  try {
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), lines } satisfies Cached));
  } catch {
    /* quota or private mode — the kernel result is already on screen */
  }
}

/**
 * Debate that is instant *and* generated.
 *
 * The deterministic kernel renders immediately (no spinner, no layout shift, SSR-safe), then the
 * server-side DeepSeek call upgrades it in place. Results are cached per market and probability
 * band for a day, so a revisit is instant and the API is not billed twice for the same argument set.
 * If anything fails the kernel output simply stays — there is no error state to handle.
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

  // probability band is part of the cache key: 41% and 78% should not share an argument set
  const band = Math.round(yesPct / 10) * 10;
  const cacheKey = `${poolId}:${band}`;

  const kernel = useMemo(
    () => generateDebate({ poolId, category, title, yesPct, netPoolUsdc }),
    [poolId, category, title, yesPct, netPoolUsdc]
  );

  const [lines, setLines] = useState<DebateLine[]>(kernel);
  const [source, setSource] = useState<"kernel" | "llm">("kernel");
  const [pending, setPending] = useState(false);
  const askedRef = useRef<string>("");

  // market changed → fall back to the kernel immediately, then ask the server
  useEffect(() => {
    setLines(kernel);
    setSource("kernel");
  }, [kernel]);

  useEffect(() => {
    if (!enabled) return;
    if (askedRef.current === cacheKey) return;
    askedRef.current = cacheKey;

    const cached = readCache(cacheKey);
    if (cached) {
      setLines(cached);
      setSource("llm");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    setPending(true);

    fetch("/api/ai/debate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ poolId, category, title, yesPct, netPoolUsdc }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { lines?: DebateLine[]; source?: string }) => {
        if (!data?.lines?.length) return;
        setLines(data.lines);
        setSource(data.source === "llm" ? "llm" : "kernel");
        if (data.source === "llm") writeCache(cacheKey, data.lines);
      })
      .catch(() => {
        /* keep the kernel debate — silence is the correct failure mode here */
      })
      .finally(() => {
        window.clearTimeout(timeout);
        setPending(false);
      });

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [cacheKey, enabled, poolId, category, title, yesPct, netPoolUsdc]);

  return { lines, source, pending };
}
