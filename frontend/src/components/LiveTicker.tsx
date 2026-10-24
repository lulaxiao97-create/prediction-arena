"use client";

import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Radio } from "lucide-react";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/components/LocaleProvider";

/**
 * Live spot strip.
 *
 * Reads `public/prices.json` — the snapshot `scripts/fetch-prices.ts` writes from Binance
 * (majors) and CoinGecko (Base tokens). It exists so the numbers a visitor sees at the top of
 * the page are the same numbers the board generator used to strike its markets, and so a stale
 * feed is visible instead of implied.
 *
 * Mounted-gated: the snapshot is fetched, never prerendered, so the server HTML and the first
 * client render agree (no hydration mismatch), and a failed fetch renders nothing rather than
 * an empty shell.
 */

type Snap = {
  updatedAt: string;
  sources?: Record<string, string>;
  assets: Record<string, { usd: number; change24h: number | null; source: string; asOf: string }>;
  global?: { totalMarketCapUsd: number; change24h: number | null; btcDominance: number | null };
};

const SHOW = ["BTC", "ETH", "SOL", "AERO"];

function money(v: number): string {
  if (v >= 1_000) return `$${Math.round(v).toLocaleString("en-US")}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toPrecision(3)}`;
}

function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.round(ms / 60_000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

export function LiveTicker() {
  const mounted = useMounted();
  const { t } = useI18n();
  const [snap, setSnap] = useState<Snap | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/prices.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Snap) => {
        if (alive && d?.assets) setSnap(d);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // Nothing on the server, nothing on a failed fetch: a strip with dashes reads as a broken site.
  if (!mounted || failed || !snap) return null;

  const items = SHOW.filter((s) => snap.assets[s]);
  if (!items.length) return null;

  const freshness = ago(snap.updatedAt);
  const stale = Date.now() - Date.parse(snap.updatedAt) > 3 * 3600_000;

  return (
    <div className="border-b border-white/[0.05] bg-white/[0.015]">
      <div className="no-scrollbar mx-auto flex max-w-[1400px] items-center gap-3 overflow-x-auto px-4 py-1.5 sm:px-6">
        <span className="flex shrink-0 items-center gap-1.5 text-[9.5px] uppercase tracking-[0.18em] text-gold/90">
          <Radio className="size-3" />
          {t("nav.live")}
        </span>
        {items.map((sym) => {
          const q = snap.assets[sym];
          const up = (q.change24h ?? 0) >= 0;
          return (
            <span key={sym} className="mono flex shrink-0 items-center gap-1 text-[10.5px] text-muted">
              <span className="text-ink/80">{sym}</span>
              <span className="text-ink">{money(q.usd)}</span>
              {q.change24h !== null && (
                <span className={up ? "flex items-center text-profit" : "flex items-center text-loss"}>
                  {up ? <ArrowUpRight className="size-2.5" /> : <ArrowDownRight className="size-2.5" />}
                  {Math.abs(q.change24h).toFixed(2)}%
                </span>
              )}
            </span>
          );
        })}
        {snap.global?.btcDominance != null && (
          <span className="mono hidden shrink-0 text-[10.5px] text-muted sm:inline">
            BTC.D <span className="text-ink/85">{snap.global.btcDominance.toFixed(1)}%</span>
          </span>
        )}
        <span className="mono ml-auto shrink-0 pl-3 text-[9.5px] text-muted/60">
          {snap.assets.BTC?.source ?? "binance"} · {freshness} {stale ? "⚠" : ""}
        </span>
      </div>
    </div>
  );
}
