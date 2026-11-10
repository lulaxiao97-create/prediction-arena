"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { keccak256, toHex } from "viem";
import { ExternalLink, Loader2, Pause, Play, TriangleAlert } from "lucide-react";

import { SocialLinks } from "@/components/SocialLinks";
import { GrowthAttribution } from "@/components/GrowthAttribution";
import { SOCIAL } from "@/lib/social";
import { ARENA_ABI, ARENA_ADDRESS, usePools } from "@/hooks/usePredictionArena";
import { useMarkets } from "@/hooks/useMarkets";
import { formatCompactUsdc } from "@/lib/format";

/**
 * Operations console (internal).
 *
 * Access = an allowlisted address (`NEXT_PUBLIC_ADMIN_ADDRESSES`). The page moves no money it can
 * reach by itself: settlement, pausing and USDC transfers are all wallet transactions the operator
 * signs, and the contract's `onlyOwner` is the real permission check. This page is a view plus a
 * well-formed transaction builder.
 *
 * The monetisation, payout-queue and points-ledger panels are gone with the systems they watched:
 * the ad venue never onboarded us (predictionarena.online is under the impression floor), so there
 * are no auctions to count, no ad credits to pay out and no points to audit. Settlement is the only
 * thing an operator still does here.
 */

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

  const allow = useMemo(
    () =>
      (process.env.NEXT_PUBLIC_ADMIN_ADDRESSES ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    []
  );
  const isOperator = Boolean(address && allow.includes(address.toLowerCase()));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-gold/70">Internal</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">Operations console</h1>
          <p className="mt-1 text-[12px] text-muted">
            Settlement and circuit breaker for PredictionArena · Base mainnet ·{" "}
            <a
              href={`https://basescan.org/address/${ARENA_ADDRESS ?? ""}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mono text-gold/80 hover:text-gold-bright"
            >
              {ARENA_ADDRESS ? `${ARENA_ADDRESS.slice(0, 8)}…${ARENA_ADDRESS.slice(-6)}` : "contract not configured"}
            </a>{" "}
            ·{" "}
            <a
              href={SOCIAL.x.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mono text-muted hover:text-ink"
            >
              {SOCIAL.x.handle}
            </a>{" "}
            ·{" "}
            <a
              href={SOCIAL.telegram.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mono text-muted hover:text-ink"
            >
              {SOCIAL.telegram.handle}
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className="chip border-white/10 text-[11px] text-muted hover:text-ink">
            ← Board
          </Link>
          <SocialLinks className="hidden sm:flex" />
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
            {address} — add it to <span className="mono">NEXT_PUBLIC_ADMIN_ADDRESSES</span> to grant access.
          </p>
        </div>
      )}

      {isOperator && (
        <>
          {/* Chain-side attribution first: it is the only number here that nobody can fake. */}
          <GrowthAttribution />
          <SettlePanel />
        </>
      )}
    </main>
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

/* ── Shared bits ──────────────────────────────────────────────────────── */

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
