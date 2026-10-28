"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, RefreshCw, Users } from "lucide-react";

/**
 * Growth attribution panel for the ops console.
 *
 * Two halves, deliberately unequal:
 *  - the left/top half is chain truth — bets, referred bets, unique referrers and the USDC the
 *    contract actually paid out as referral cuts. Refreshed on demand, cached 60s server-side.
 *  - the right half is the channel mix, which the chain cannot answer. Instead of inventing
 *    numbers from a traffic source we never recorded, it states the exact tags every link carries
 *    and what a sink would need to receive. A dashboard that shows a made-up "Farcaster: 1,204
 *    visits" is worse than one that shows nothing.
 */

type Summary = {
  ok: boolean;
  window?: { chunks: number; blocksScanned: number; latestBlock: string };
  totals?: {
    bets: number;
    bettors: number;
    referredBets: number;
    uniqueReferrers: number;
    referralPaidUsdc: number;
    volumeUsdc: number;
  };
  topReferrers?: { address: string; bets: number; volumeUsdc: number; earnedUsdc: number }[];
  perMarket?: { poolId: string; bets: number; referred: number }[];
  channels?: { note: string; taggedLinks: string[] };
  error?: string;
};

function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function GrowthAttribution() {
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/growth/summary?chunks=6", { cache: "no-store" });
      const body = (await res.json()) as Summary;
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setErr((e as Error)?.message ?? "summary unavailable");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const t = data?.totals;
  const rate = t && t.bets > 0 ? Math.round((t.referredBets / t.bets) * 100) : 0;

  return (
    <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="size-4 text-cyan-bright" aria-hidden />
        <p className="text-[13px] font-semibold text-ink">Growth attribution</p>
        {data?.window && (
          <span className="mono rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-muted">
            last {data.window.blocksScanned.toLocaleString("en-US")} blocks · {data.window.chunks} chunks
          </span>
        )}
        <button
          onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-muted transition-colors hover:border-white/25 hover:text-ink"
        >
          <RefreshCw className={busy ? "size-3 animate-spin" : "size-3"} /> refresh
        </button>
      </div>

      {err && (
        <p className="mt-2 rounded-lg border border-loss/30 bg-loss/5 px-2.5 py-2 text-[11px] text-loss">
          {err} — the public Base RPC throttles wide log scans; try again in a minute.
        </p>
      )}

      {t && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Bets (window)", value: t.bets.toLocaleString("en-US") },
              { label: "Through a referrer", value: `${t.referredBets} · ${rate}%` },
              { label: "Unique referrers", value: t.uniqueReferrers.toLocaleString("en-US") },
              { label: "Referral paid", value: `$${t.referralPaidUsdc.toFixed(2)}` },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                <p className="text-[9.5px] uppercase tracking-[0.12em] text-muted/60">{s.label}</p>
                <p className="mono mt-0.5 text-[15px] font-semibold text-ink">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted/60">Top referrers (on-chain)</p>
              <div className="mt-1.5 space-y-1">
                {data.topReferrers && data.topReferrers.length > 0 ? (
                  data.topReferrers.map((r) => (
                    <div
                      key={r.address}
                      className="flex items-center gap-2 rounded-lg border border-white/6 bg-white/[0.015] px-2.5 py-1.5"
                    >
                      <span className="mono text-[11px] text-ink">{short(r.address)}</span>
                      <span className="mono ml-auto text-[10.5px] text-muted">{r.bets} bets</span>
                      <span className="mono text-[10.5px] text-profit">${r.earnedUsdc.toFixed(2)}</span>
                    </div>
                  ))
                ) : (
                  <p className="rounded-lg border border-white/6 bg-white/[0.015] px-2.5 py-2 text-[11px] text-muted">
                    No referred bets in this window. Every invite link carries <code className="mono">?ref=</code>, so
                    the first shared position will show up here.
                  </p>
                )}
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted/60">Channel mix</p>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">{data.channels?.note}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {data.channels?.taggedLinks.map((tag) => (
                  <span
                    key={tag}
                    className="mono rounded-md border border-white/8 bg-white/[0.02] px-1.5 py-0.5 text-[9.5px] text-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <Link
                href="/docs"
                className="mt-2 inline-flex items-center gap-1 text-[10.5px] text-cyan-bright hover:underline"
              >
                tagging scheme <ArrowUpRight className="size-3" />
              </Link>
            </div>
          </div>
        </>
      )}

      {!t && !err && <p className="mt-2 text-[11px] text-muted">loading on-chain summary…</p>}
    </section>
  );
}
