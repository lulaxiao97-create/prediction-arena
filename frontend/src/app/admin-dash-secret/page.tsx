"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Operator dashboard — unlisted route, shared key, read-only.
 *
 * Deliberately not linked from anywhere in the app and not in the sitemap. The key is typed once and
 * kept in localStorage; every fetch carries it, and the API re-checks it. Nothing on this page can
 * move money: settlements live in /admin (wallet-signed) and in scripts/settle-expired.ts.
 */

type Row = { ip: string; country: string | null; city: string | null; hits: number; last: string; source: string };
type Payload = {
  ok?: boolean;
  error?: string;
  at: string;
  traffic: {
    totals: { events: number; events24h: number; views24h: number; wallets: number; uniqueIps24h: number };
    bySource: Record<string, number>;
    byCountry: Record<string, number>;
    topPaths: { path: string; hits: number }[];
    recentIps: Row[];
    wallets: { address: string; firstSeen: string; lastSeen: string; connects: number; country: string | null; source: string }[];
  };
  telegram: { captains: number; bindGrants: number; crewGrants: number; boosts: number; referralEdges: number; topReferrers: { wallet: string; chiefs: number }[] };
  growth: { followers: number | null; posts: number | null; series: { at: string; followers: number; posts: number }[]; followsToday: number };
  pools: { total: number; open: number; expiredUnsettled: { id: string; title: string; hoursLate: number }[]; tvlUsdc: string; heat: { id: string; hits: number; title: string }[] };
  notes: string[];
};

const KEY_STORE = "pa-dash-key";

function Card({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="text-sm font-semibold tracking-wide text-white/80">{title}</h2>
      {hint ? <p className="mt-1 text-xs text-white/40">{hint}</p> : null}
      <div className="mt-3 space-y-2 text-sm text-white/70">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 pb-1">
      <span className="text-xs uppercase tracking-wider text-white/40">{label}</span>
      <span className="font-mono text-white/90">{value}</span>
    </div>
  );
}

export default function AdminDashSecret() {
  const [key, setKey] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (k: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin-dash-secret?key=${encodeURIComponent(k)}`, { cache: "no-store" });
      if (res.status === 401) {
        setError("wrong key");
        setData(null);
        return;
      }
      if (!res.ok) throw new Error(`http ${res.status}`);
      setData((await res.json()) as Payload);
      localStorage.setItem(KEY_STORE, k);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(KEY_STORE);
    if (saved) {
      setKey(saved);
      void load(saved);
    }
  }, [load]);

  if (!data) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-lg font-semibold text-white">Operator dashboard</h1>
        <p className="text-sm text-white/50">Shared key required. Stored locally, never sent anywhere else.</p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="dash key"
          className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-white/40"
        />
        <button
          onClick={() => void load(key)}
          className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
          disabled={loading || !key}
        >
          {loading ? "checking…" : "open"}
        </button>
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
      </main>
    );
  }

  if (data.ok === false || !data.traffic) {
    return (
      <main className="mx-auto max-w-lg space-y-3 p-6">
        <h1 className="text-lg font-semibold text-white">Operator dashboard</h1>
        <p className="text-sm text-red-400">Data endpoint failed: {data.error ?? "unknown error"}</p>
        <p className="text-xs text-white/40">
          The page and the key are fine — the API could not read its data files. On a host with an
          ephemeral filesystem those files only exist after the first event is recorded.
        </p>
        <button className="rounded border border-white/15 px-3 py-1 text-sm text-white/70" onClick={() => void load(key)}>
          retry
        </button>
      </main>
    );
  }
  const t = data.traffic;
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold text-white">Operator dashboard</h1>
        <div className="flex items-center gap-3 text-xs text-white/40">
          <span>{new Date(data.at).toLocaleString()}</span>
          <button className="rounded border border-white/15 px-2 py-1 text-white/70" onClick={() => void load(key)} disabled={loading}>
            {loading ? "…" : "refresh"}
          </button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card title="Traffic (24h)">
          <Stat label="events" value={t.totals.events24h} />
          <Stat label="views" value={t.totals.views24h} />
          <Stat label="unique IPs" value={t.totals.uniqueIps24h} />
          <Stat label="total stored" value={t.totals.events} />
        </Card>
        <Card title="Sources (24h)">
          {Object.entries(t.bySource).length === 0 ? <p className="text-white/40">no traffic yet</p> : null}
          {Object.entries(t.bySource)
            .sort((a, b) => b[1] - a[1])
            .map(([src, hits]) => (
              <Stat key={src} label={src} value={hits} />
            ))}
        </Card>
        <Card title="Growth">
          <Stat label="followers" value={data.growth.followers ?? "—"} />
          <Stat label="posts" value={data.growth.posts ?? "—"} />
          <Stat label="follows today" value={data.growth.followsToday} />
          <Stat label="wallets seen" value={t.totals.wallets} />
        </Card>
        <Card title="Book">
          <Stat label="pools" value={data.pools.total} />
          <Stat label="open" value={data.pools.open} />
          <Stat label="TVL" value={`$${data.pools.tvlUsdc}`} />
          <Stat label="expired" value={data.pools.expiredUnsettled.length} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Visitors" hint="IP + geo come from the edge headers; no GeoIP database is bundled.">
          {t.recentIps.length === 0 ? <p className="text-white/40">no visits recorded yet</p> : null}
          {t.recentIps.slice(0, 25).map((r) => (
            <div key={r.ip} className="flex items-center justify-between gap-2 border-b border-white/5 pb-1 font-mono text-xs">
              <span className="text-white/80">{r.ip}</span>
              <span className="text-white/40">{[r.country, r.city].filter(Boolean).join(" / ") || "—"}</span>
              <span className="text-white/50">{r.source}</span>
              <span className="text-white/30">{new Date(r.last).toLocaleTimeString()}</span>
            </div>
          ))}
        </Card>

        <Card title="Connected wallets">
          {t.wallets.length === 0 ? <p className="text-white/40">no wallet connections recorded yet</p> : null}
          {t.wallets.slice(0, 20).map((w) => (
            <div key={w.address} className="flex items-center justify-between gap-2 border-b border-white/5 pb-1 font-mono text-xs">
              <span className="text-white/80">
                {w.address.slice(0, 6)}…{w.address.slice(-4)}
              </span>
              <span className="text-white/40">{w.connects}×</span>
              <span className="text-white/30">{new Date(w.lastSeen).toLocaleDateString()}</span>
            </div>
          ))}
        </Card>

        <Card title="Telegram / captains">
          <Stat label="captains bound" value={data.telegram.captains} />
          <Stat label="referral edges" value={data.telegram.referralEdges} />
          {data.telegram.topReferrers.map((r) => (
            <div key={r.wallet} className="flex justify-between font-mono text-xs text-white/60">
              <span>
                {r.wallet.slice(0, 6)}…{r.wallet.slice(-4)}
              </span>
              <span>{r.chiefs} chiefs</span>
            </div>
          ))}
        </Card>

        <Card title="Market heat + settlement">
          {data.pools.heat.length === 0 ? <p className="text-white/40">no per-market clicks recorded yet</p> : null}
          {data.pools.heat.slice(0, 8).map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-white/70">{m.title || m.id}</span>
              <span className="font-mono text-white/50">{m.hits}</span>
            </div>
          ))}
          {data.pools.expiredUnsettled.length > 0 ? (
            <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
              {data.pools.expiredUnsettled.length} pools past endTime and still open — run{" "}
              <code className="font-mono">bun scripts/settle-expired.ts --execute</code>
              <ul className="mt-1 space-y-0.5">
                {data.pools.expiredUnsettled.slice(0, 5).map((p) => (
                  <li key={p.id}>
                    {p.id} · {p.hoursLate}h late
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-2 text-xs text-emerald-400/80">no expired pools open — settlement queue is clean</p>
          )}
        </Card>
      </div>

      <footer className="space-y-1 text-xs text-white/30">
        {data.notes.map((n) => (
          <p key={n}>· {n}</p>
        ))}
      </footer>
    </main>
  );
}
