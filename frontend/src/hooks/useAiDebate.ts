"use client";

import { useMemo } from "react";
import { generateLocalizedDebate, type DebateLang, type DebateLine } from "@/lib/auto-gen";
import { useI18n } from "@/components/LocaleProvider";

/**
 * Debate for a market — generated in the browser, from the market's own facts.
 *
 * There is no model call and no pre-baked corpus: `lib/debate` builds six rounds per market from
 * the subject, the strike/expiry in the title, the live YES/NO split and the fee-net multiples, in
 * the language the page is being read in. The id hashes the deck, so the same market prints the
 * same argument on every render — server and client agree, and a reload does not reshuffle.
 *
 * A cached `public/debates.json` used to take precedence here. It was English-only and written per
 * *category*, which is exactly the "same paragraph on every market" failure this replaces, so the
 * hook no longer reads it. The file and its generator stay for the ops daemon, but the UI's text is
 * always the context engine's.
 */
export function useAiDebate(input: {
  poolId: string;
  category: string;
  title: string;
  yesPct: number;
  netPoolUsdc?: number;
  marketData?: {
    asset?: string;
    spotUsd?: number;
    strikeUsd?: number;
    direction?: string;
    windowDays?: number;
  };
  endTime?: number;
  depthUsdc?: number;
  /** Kept for call-site compatibility; generation is local and instant, so nothing is disabled. */
  enabled?: boolean;
}) {
  const { locale } = useI18n();
  const { poolId, category, title, yesPct, netPoolUsdc, marketData, endTime, depthUsdc } = input;

  const lines: DebateLine[] = useMemo(
    () =>
      generateLocalizedDebate(
        { poolId, category, title, yesPct, netPoolUsdc, marketData, endTime, depthUsdc },
        locale as DebateLang,
      ),
    [poolId, category, title, yesPct, netPoolUsdc, marketData, endTime, depthUsdc, locale],
  );

  return {
    lines,
    source: "kernel" as const,
    generatedAt: null,
    /** Always current: the text is derived, not cached against a probability band. */
    stale: false,
    staleReason: null as null | "missing" | "drift",
    cachedBand: null as number | null,
    pending: false,
  };
}
