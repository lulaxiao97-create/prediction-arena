"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AD_SECONDS, type RewardsView } from "@/lib/rewards";
import { AdModal } from "@/components/AdModal";

/**
 * Rewards state for the whole app.
 *
 * The provider owns the ad modal because three different surfaces open it (dashboard strip,
 * portfolio drawer, trade panel when the ticket rail is empty). Nothing is cached in
 * localStorage: the signed cookie is the ledger, and every mutation returns the new view, so two
 * tabs cannot drift apart silently.
 */

type Stored = { view: RewardsView | null; loading: boolean; error: string | null };

type Ctx = Stored & {
  refresh: () => Promise<void>;
  startAd: () => Promise<{ token: string; seconds: number } | { error: string }>;
  completeAd: (token: string) => Promise<{ ok: boolean; awarded?: number; error?: string }>;
  redeem: (count?: number) => Promise<{ ok: boolean; redeemed?: number; error?: string }>;
  stake: (poolId: string, option: 0 | 1) => Promise<{ ok: boolean; error?: string; entryBps?: number }>;
  requestCashout: () => Promise<{ ok: boolean; error?: string }>;
  openAd: () => void;
  adOpen: boolean;
  closeAd: () => void;
};

const RewardsCtx = createContext<Ctx | null>(null);

export function useRewards(): Ctx {
  const ctx = useContext(RewardsCtx);
  if (!ctx) throw new Error("useRewards must be used inside <RewardsProvider>");
  return ctx;
}

async function call(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/rewards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; view?: RewardsView } & Record<string, unknown>;
  return { status: res.status, data };
}

export function RewardsProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<RewardsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adOpen, setAdOpen] = useState(false);
  const mounted = useRef(true);

  const apply = useCallback((next: RewardsView | undefined) => {
    if (next) setView(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/rewards", { cache: "no-store" });
      const data = (await res.json()) as { view?: RewardsView };
      if (mounted.current) {
        apply(data.view);
        setError(null);
      }
    } catch {
      if (mounted.current) setError("offline");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const startAd = useCallback(async () => {
    const { data } = await call("ad-start");
    if (data.ok && typeof data.token === "string") {
      return { token: data.token, seconds: AD_SECONDS };
    }
    return { error: String(data.error ?? "unavailable") };
  }, []);

  const completeAd = useCallback(
    async (token: string) => {
      const { data } = await call("ad-complete", { token });
      apply(data.view as RewardsView | undefined);
      if (data.ok) return { ok: true, awarded: Number(data.awarded ?? 0) };
      return { ok: false, error: String(data.error ?? "failed") };
    },
    [apply],
  );

  const redeem = useCallback(
    async (count = 1) => {
      const { data } = await call("redeem", { count });
      apply(data.view as RewardsView | undefined);
      if (data.ok) return { ok: true, redeemed: Number(data.redeemed ?? count) };
      return { ok: false, error: String(data.error ?? "failed") };
    },
    [apply],
  );

  const stake = useCallback(
    async (poolId: string, option: 0 | 1) => {
      const { data } = await call("stake", { poolId, option });
      apply(data.view as RewardsView | undefined);
      if (data.ok) return { ok: true, entryBps: Number(data.staked ?? 0) };
      return { ok: false, error: String(data.error ?? "failed") };
    },
    [apply],
  );

  const requestCashout = useCallback(async () => {
    const { data } = await call("cashout");
    apply(data.view as RewardsView | undefined);
    return { ok: Boolean(data.ok), error: data.ok ? undefined : String(data.error ?? "failed") };
  }, [apply]);

  const value = useMemo<Ctx>(
    () => ({
      view,
      loading,
      error,
      refresh,
      startAd,
      completeAd,
      redeem,
      stake,
      requestCashout,
      openAd: () => setAdOpen(true),
      closeAd: () => setAdOpen(false),
      adOpen,
    }),
    [view, loading, error, refresh, startAd, completeAd, redeem, stake, requestCashout, adOpen],
  );

  return (
    <RewardsCtx.Provider value={value}>
      {children}
      <AdModal open={adOpen} onClose={() => setAdOpen(false)} />
    </RewardsCtx.Provider>
  );
}
