"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContract, useSignMessage, useWriteContract } from "wagmi";
import { keccak256, toHex } from "viem";
import { Check, Copy, ExternalLink, Loader2, Pause, Play, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

import { adminMessage } from "@/lib/admin-auth";
import { ARENA_ABI, ARENA_ADDRESS, usePools } from "@/hooks/usePredictionArena";
import { useMarkets } from "@/hooks/useMarkets";
import type { Cashout, Grant, OpsSnapshot } from "@/lib/ops-metrics";
import { formatCompactUsdc } from "@/lib/format";

/**
 * Operations console (internal).
 *
 * Access = an allowlisted address (`NEXT_PUBLIC_ADMIN_ADDRESSES`) plus an EIP-191 signature, which
 * the metrics API re-verifies server-side. The console itself moves no money: settlement, pausing
 * and USDC transfers are all wallet transactions the operator signs, and the contract's `onlyOwner`
 * is the real permission check. This page is a view + a well-formed transaction builder.
 */

type Tab = "ads" | "payouts" | "settle" | "ledger";

const ECPM_USD = 3.5; // conservative HypeLab display estimate, editable in the UI

function usd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function Pill({ tone, children }: { tone: "ok" | "warn" | "mute" | "bad"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-profit/30 bg-profit/10 text-profit"
      : tone === "warn"
        ? "border-gold/30 bg-gold/10 text-gold-bright"
        : tone === "bad"
          ? "border-loss/30 bg-loss/10 text-loss"
          : "border-white/10 bg-white/[0.03] text-muted";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${cls}`}>
      {children}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted/60">{label}</p>
      <p className="mono mt-1 text-2xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted/60">{hint}</p>}
    </div>
  );
}

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const allow = useMemo(
    () =>
      (process.env.NEXT_PUBLIC_ADMIN_ADDRESSES ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    []
  );
  const isOperator = Boolean(address && allow.includes(address.toLowerCase()));

  const [auth, setAuth] = useState<{ address: string; ts: number; sig: string } | null>(null);
  const [snapshot, setSnapshot] = useState<OpsSnapshot | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("ads");
  const [busy, setBusy] = useState(false);

  const signIn = useCallback(async () => {
    if (!address) return;
    setApiError(null);
    setBusy(true);
    try {
      const ts = Date.now();
      const sig = await signMessageAsync({ message: adminMessage(address, ts) });
      setAuth({ address, ts, sig });
    } catch (e) {
      setApiError((e as Error)?.message ?? "signature rejected");
    } finally {
      setBusy(false);
    }
  }, [address, signMessageAsync]);

  const load = useCallback(async () => {
    if (!auth) return;
    try {
      const q = new URLSearchParams({ address: auth.address, ts: String(auth.ts), sig: auth.sig });
      const res = await fetch(`/api/admin/metrics?${q}`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSnapshot((await res.json()) as OpsSnapshot);
      setApiError(null);
    } catch (e) {
      setApiError((e as Error)?.message ?? "metrics unavailable");
    }
  }, [auth]);

  useEffect(() => {
    if (!auth) return;
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [auth, load]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-gold/70">Internal</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">Operations console</h1>
          <p className="mt-1 text-[12px] text-muted">
            Monetisation, payouts, settlement and ledger for PredictionArena · Base mainnet
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className="chip border-white/10 text-[11px] text-muted hover:text-ink">
            ← Board
          </Link>
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
        </div>
      </header>

      {!isConnected && (
        <div className="mt-8 rounded-2xl border border-white/8 bg-white/[0.02] p-6 text-sm text-muted">
          Connect the operator wallet to continue.
        </div>
      )}

      {isConnected && !isOperator && (
        <div className="mt-8 rounded-2xl border border-loss/25 bg-loss/[0.04] p-6">
          <p className="flex items-center gap-2 text-sm font-medium text-loss">
            <TriangleAlert className="size-4" /> Wallet not on the operator allowlist
          </p>
          <p className="mt-2 break-all text-[12px] text-muted">
            {address} — add it to <span className="mono">ADMIN_ADDRESSES</span> (and{" "}
            <span className="mono">NEXT_PUBLIC_ADMIN_ADDRESSES</span>) to grant access.
          </p>
        </div>
      )}

      {isOperator && !auth && (
        <div className="mt-8 rounded-2xl border border-gold/25 bg-gold/[0.04] p-6">
          <p className="text-sm text-ink">Sign a timestamped message to unlock the metrics API.</p>
          <p className="mt-1 text-[12px] text-muted">No gas, no transaction — the signature expires in 5 minutes.</p>
          <button
            onClick={() => void signIn()}
            disabled={busy}
            className="btn-gold mt-4 inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Sign in
          </button>
          {apiError && <p className="mt-3 text-[12px] text-loss">{apiError}</p>}
        </div>
      )}

      {isOperator && auth && (
        <>
          <nav className="mt-6 flex flex-wrap items-center gap-2">
            {(
              [
                ["ads", "Monetisation"],
                ["payouts", snapshot ? `Payouts (${snapshot.cashouts.pending})` : "Payouts"],
                ["settle", "Settlement"],
                ["ledger", "Ledger audit"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={
                  tab === id
                    ? "rounded-full border border-gold/40 bg-gold/15 px-3.5 py-1.5 text-[12px] font-medium text-gold-bright"
                    : "rounded-full border border-white/8 bg-white/[0.02] px-3.5 py-1.5 text-[12px] text-muted hover:text-ink"
                }
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => void load()}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/8 px-3 py-1.5 text-[11px] text-muted hover:text-ink"
            >
              <RefreshCw className="size-3" /> Refresh
            </button>
            <span className="mono text-[10px] text-muted/50">
              signed in as {auth.address.slice(0, 6)}…{auth.address.slice(-4)}
            </span>
          </nav>

          {apiError && (
            <p className="mt-3 rounded-lg border border-loss/25 bg-loss/[0.05] px-3 py-2 text-[12px] text-loss">{apiError}</p>
          )}

          {tab === "ads" && <AdsPanel snapshot={snapshot} />}
          {tab === "payouts" && <PayoutsPanel snapshot={snapshot} auth={auth} onChanged={load} />}
          {tab === "settle" && <SettlePanel />}
          {tab === "ledger" && <LedgerPanel snapshot={snapshot} />}

          <p className="mt-8 text-[10.5px] leading-relaxed text-muted/45">
            Counters are held in the server process: they reset on the next deploy and are per-instance. The
            dashboard says so instead of implying a database that does not exist.
          </p>
        </>
      )}
    </main>
  );
}

/* ── Monetisation ─────────────────────────────────────────────────────── */

function AdsPanel({ snapshot }: { snapshot: OpsSnapshot | null }) {
  const [ecpm, setEcpm] = useState(ECPM_USD);
  if (!snapshot) return <PanelSkeleton />;

  const { attempts, filled, empty204, fillRate, recent } = snapshot.ads;
  const revenue = (filled * ecpm) / 1000;

  return (
    <section className="mt-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Auctions" value={attempts} hint="visible mounts + off-screen probes" />
        <Stat label="Filled (200)" value={filled} hint={`${(fillRate * 100).toFixed(1)}% fill rate`} />
        <Stat label="No bid (204)" value={empty204} hint={attempts ? `${((empty204 / attempts) * 100).toFixed(1)}% empty` : "—"} />
        <Stat label="Est. revenue" value={`$${revenue.toFixed(2)}`} hint={`at $${ecpm.toFixed(2)} eCPM`} />
      </div>

      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-muted">Assumed eCPM (display only — the venue&apos;s real rate comes from HypeLab reporting)</p>
          <label className="inline-flex items-center gap-2 text-[12px] text-muted">
            $
            <input
              type="number"
              step="0.5"
              min="0"
              value={ecpm}
              onChange={(e) => setEcpm(Number(e.target.value) || 0)}
              className="mono w-20 rounded-lg border border-white/10 bg-void px-2 py-1 text-ink outline-none focus:border-gold/50"
            />
          </label>
        </div>
      </div>

      <Table
        head={["Time", "Surface", "Status", "Result"]}
        rows={recent.slice(0, 20).map((r) => [
          new Date(r.ts).toLocaleTimeString(),
          r.surface,
          String(r.status),
          r.filled ? <Pill tone="ok" key={r.ts}>filled</Pill> : <Pill tone="mute" key={r.ts}>no bid</Pill>,
        ])}
        empty="No auction attempts since the last deploy."
      />
    </section>
  );
}

/* ── Payouts ──────────────────────────────────────────────────────────── */

function PayoutsPanel({
  snapshot,
  auth,
  onChanged,
}: {
  snapshot: OpsSnapshot | null;
  auth: { address: string; ts: number; sig: string };
  onChanged: () => Promise<void> | void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!snapshot) return <PanelSkeleton />;

  const copy = async (row: Cashout) => {
    const payload = {
      network: "base",
      chainId: 8453,
      asset: "USDC",
      amount: (row.amountCents / 100).toFixed(2),
      to: row.address,
      ref: row.ref,
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(row.ref);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const markSent = async (row: Cashout) => {
    await fetch("/api/admin/metrics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...auth, ref: row.ref }),
    });
    await onChanged();
  };

  return (
    <section className="mt-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Requests" value={snapshot.cashouts.count} hint="since deploy" />
        <Stat label="Pending" value={snapshot.cashouts.pending} hint="waiting on a transfer" />
        <Stat label="Pending value" value={usd(snapshot.cashouts.pendingCents)} hint="realised profit only" />
      </div>

      <Table
        head={["Requested", "Base address", "Amount", "Ref", ""]}
        rows={snapshot.cashouts.recent.map((row) => [
          new Date(row.ts).toLocaleString(),
          <span className="mono break-all text-[11px] text-ink" key={`a${row.ref}`}>{row.address}</span>,
          <span className="mono" key={`c${row.ref}`}>{usd(row.amountCents)}</span>,
          <span className="mono text-[11px] text-muted" key={`r${row.ref}`}>{row.ref}</span>,
          <span className="flex items-center gap-1.5" key={`x${row.ref}`}>
            <button
              onClick={() => void copy(row)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-muted hover:text-ink"
            >
              {copied === row.ref ? <Check className="size-3 text-profit" /> : <Copy className="size-3" />}
              payload
            </button>
            {row.status === "pending" ? (
              <button
                onClick={() => void markSent(row)}
                className="inline-flex items-center gap-1 rounded-lg border border-profit/30 bg-profit/10 px-2 py-1 text-[11px] text-profit"
              >
                mark sent
              </button>
            ) : (
              <Pill tone="ok">sent</Pill>
            )}
          </span>,
        ])}
        empty="No payout requests since the last deploy."
      />
    </section>
  );
}

/* ── Settlement ───────────────────────────────────────────────────────── */

function SettlePanel() {
  const { pools } = useMarkets();
  const { pools: chainPools } = usePools(pools.map((p) => p.id));
  const { writeContractAsync } = useWriteContract();

  const [poolId, setPoolId] = useState<string>("");
  const [outcome, setOutcome] = useState<0 | 1>(0);
  const [evidence, setEvidence] = useState("");
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pausedRead = useReadContract({
    address: ARENA_ADDRESS,
    abi: ARENA_ABI,
    functionName: "paused",
    query: { enabled: Boolean(ARENA_ADDRESS), refetchInterval: 20_000, retry: false },
  });
  const supportsPause = !pausedRead.isError && typeof pausedRead.data === "boolean";

  const rows = useMemo(() => {
    const byId = new Map(chainPools.map((p) => [p.id.toString(), p]));
    return pools.map((p) => {
      const onchain = byId.get(p.id.toString());
      return {
        id: p.id,
        title: p.title,
        status: onchain?.status ?? 0,
        endTime: onchain?.endTime ?? p.endTime,
        stake: onchain?.totalNetPool ?? 0n,
      };
    });
  }, [pools, chainPools]);

  const settle = async () => {
    setErr(null);
    setHash(null);
    setBusy(true);
    try {
      if (!ARENA_ADDRESS) throw new Error("ARENA_ADDRESS is not configured");
      if (!poolId) throw new Error("pick a market");
      if (evidence.trim().length < 8) throw new Error("paste the evidence bundle or its URI");
      // Same convention as scripts/settle-pool.ts: the on-chain digest is keccak(evidence text).
      const digest = keccak256(toHex(evidence.trim()));
      const tx = await writeContractAsync({
        address: ARENA_ADDRESS,
        abi: ARENA_ABI,
        functionName: "settle",
        args: [BigInt(poolId), outcome, digest],
      });
      setHash(tx);
    } catch (e) {
      setErr((e as Error)?.message ?? "settle failed");
    } finally {
      setBusy(false);
    }
  };

  const flip = async (pause: boolean) => {
    setErr(null);
    setBusy(true);
    try {
      if (!ARENA_ADDRESS) throw new Error("ARENA_ADDRESS is not configured");
      const tx = await writeContractAsync({
        address: ARENA_ADDRESS,
        abi: ARENA_ABI,
        functionName: pause ? "pause" : "unpause",
        args: [],
      });
      setHash(tx);
    } catch (e) {
      setErr((e as Error)?.message ?? "transaction failed");
    } finally {
      setBusy(false);
    }
  };

  const open = rows.filter((r) => r.status === 1);

  return (
    <section className="mt-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Markets" value={rows.length} hint={`${open.length} still open`} />
        <Stat
          label="Contract"
          value={supportsPause ? (pausedRead.data ? "PAUSED" : "LIVE") : "OLD ABI"}
          hint={supportsPause ? "bets gated · claims always open" : "deployed contract has no pause switch"}
        />
        <Stat
          label="Staked (open)"
          value={`$${formatCompactUsdc(open.reduce((sum, r) => sum + r.stake, 0n))}`}
          hint="net of rake, chain-read"
        />
      </div>

      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] font-medium text-ink">Circuit breaker</p>
          <div className="flex gap-2">
            <button
              onClick={() => void flip(true)}
              disabled={!supportsPause || busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-loss/30 bg-loss/10 px-2.5 py-1 text-[11px] text-loss disabled:opacity-40"
            >
              <Pause className="size-3" /> Pause betting
            </button>
            <button
              onClick={() => void flip(false)}
              disabled={!supportsPause || busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-profit/30 bg-profit/10 px-2.5 py-1 text-[11px] text-profit disabled:opacity-40"
            >
              <Play className="size-3" /> Resume
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted/60">
          Pausing never blocks claims — a user can always exit with money that is already theirs.
        </p>
      </div>

      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
        <p className="text-[12px] font-medium text-ink">Settle a market</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] text-muted">
            Market
            <select
              value={poolId}
              onChange={(e) => setPoolId(e.target.value)}
              className="mono mt-1 w-full rounded-lg border border-white/10 bg-void px-2 py-2 text-[12px] text-ink outline-none focus:border-gold/50"
            >
              <option value="">— select —</option>
              {rows.map((r) => (
                <option key={r.id.toString()} value={r.id.toString()}>
                  #{r.id.toString()} · {r.title.slice(0, 48)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-muted">
            Winning outcome
            <select
              value={outcome}
              onChange={(e) => setOutcome(Number(e.target.value) === 1 ? 1 : 0)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-void px-2 py-2 text-[12px] text-ink outline-none focus:border-gold/50"
            >
              <option value={0}>Yes (option 0)</option>
              <option value={1}>No (option 1)</option>
            </select>
          </label>
        </div>
        <label className="mt-3 block text-[11px] text-muted">
          Evidence bundle (hash is keccak256 of this text, stored on-chain)
          <textarea
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            rows={3}
            placeholder="ipfs://… or the resolution JSON"
            className="mono mt-1 w-full rounded-lg border border-white/10 bg-void px-2 py-2 text-[11.5px] text-ink outline-none focus:border-gold/50"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void settle()}
            disabled={busy}
            className="btn-gold inline-flex items-center gap-2 px-4 py-2 text-[12.5px] font-semibold disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Submit settlement
          </button>
          {evidence.trim().length > 8 && (
            <span className="mono text-[10.5px] text-muted/60">digest {keccak256(toHex(evidence.trim())).slice(0, 18)}…</span>
          )}
        </div>
        {hash && (
          <a
            href={`https://basescan.org/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
            className="mono mt-3 inline-flex items-center gap-1 text-[11.5px] text-gold-bright hover:underline"
          >
            {hash.slice(0, 12)}…{hash.slice(-8)} <ExternalLink className="size-3" />
          </a>
        )}
        {err && <p className="mt-3 rounded-lg border border-loss/25 bg-loss/[0.05] px-3 py-2 text-[11.5px] text-loss">{err}</p>}
      </div>

      <Table
        head={["#", "Market", "Status", "Ends", "Staked"]}
        rows={rows.slice(0, 40).map((r) => [
          <span className="mono" key={`i${r.id}`}>{r.id.toString()}</span>,
          r.title.slice(0, 56),
          r.status === 1 ? <Pill tone="ok" key={`s${r.id}`}>open</Pill> : r.status === 2 ? <Pill tone="mute" key={`s${r.id}`}>settled</Pill> : r.status === 3 ? <Pill tone="warn" key={`s${r.id}`}>voided</Pill> : <Pill tone="bad" key={`s${r.id}`}>not on chain</Pill>,
          new Date(r.endTime * 1000).toLocaleString(),
          <span className="mono" key={`v${r.id}`}>${formatCompactUsdc(r.stake)}</span>,
        ])}
        empty="No markets."
      />
    </section>
  );
}

/* ── Ledger ───────────────────────────────────────────────────────────── */

function LedgerPanel({ snapshot }: { snapshot: OpsSnapshot | null }) {
  if (!snapshot) return <PanelSkeleton />;
  return (
    <section className="mt-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Grants" value={snapshot.grants.count} hint="ad credits + ticket redemptions" />
        <Stat label="Points moved" value={snapshot.grants.points} hint="signed server-side only" />
        <Stat label="Uptime" value={`${Math.floor(snapshot.uptimeSec / 60)}m`} hint="counters live in this process" />
      </div>

      <Table
        head={["Time", "Kind", "Points", "Note"]}
        rows={snapshot.grants.recent.map((g: Grant) => [
          new Date(g.ts).toLocaleTimeString(),
          <Pill tone={g.kind === "ad" ? "ok" : "mute"} key={`k${g.ts}${g.kind}`}>{g.kind}</Pill>,
          <span className="mono" key={`p${g.ts}${g.kind}`}>{g.points > 0 ? `+${g.points}` : g.points}</span>,
          g.note ?? "",
        ])}
        empty="No grants since the last deploy."
      />

      <p className="text-[11px] leading-relaxed text-muted/60">
        Points are only credited against a receipt the server signed at ad-start (≥14s, single-use, daily-capped), so
        a replayed or hand-crafted request cannot mint points. Ad credits, redemptions and cashout requests appear
        here as they happen; the ledger itself stays in a signed cookie, never in a database.
      </p>
    </section>
  );
}

/* ── Shared bits ──────────────────────────────────────────────────────── */

function PanelSkeleton() {
  return (
    <div className="mt-5 flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.02] p-6 text-[12px] text-muted">
      <Loader2 className="size-3.5 animate-spin" /> loading metrics…
    </div>
  );
}

function Table({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/8 bg-white/[0.02]">
      <table className="w-full min-w-[640px] border-collapse text-left text-[12px]">
        <thead>
          <tr className="border-b border-white/8 text-[10px] uppercase tracking-[0.1em] text-muted/55">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="px-3 py-6 text-center text-[12px] text-muted/50">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 align-middle text-muted">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
