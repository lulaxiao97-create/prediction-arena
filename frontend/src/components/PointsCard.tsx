"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Coins, Trophy } from "lucide-react";

/**
 * Arena Points — the user-facing half of the ledger.
 *
 * Reads /api/points, which is derived from on-chain BetPlaced events (scripts/sync-points.ts). The
 * card never computes a score client-side: it renders what the indexer says, and an address with no
 * bets honestly reads zero instead of a placeholder number.
 */
type PointsView = {
  ok?: boolean;
  points?: number;
  fromBets?: number;
  socialPoints?: number;
  fromReferrals?: number;
  bets?: number;
  rank?: number | null;
  estimatedArena?: number;
  totals?: { wallets: number; points: number; bets: number; volumeUsd: number };
  leaderboard?: { rank: number; address: string; points: number }[];
  disclaimer?: string;
  generatedAt?: string;
};

const fmt = (n: number | undefined) => (typeof n === "number" ? n.toLocaleString("en-US") : "—");

export function PointsCard() {
  const { address } = useAccount();
  const [data, setData] = useState<PointsView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const url = address ? `/api/points?address=${address}` : "/api/points";
    fetch(url)
      .then((r) => r.json())
      .then((json: PointsView) => live && setData(json))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [address]);

  const points = data?.points ?? 0;
  const estimated = data?.estimatedArena ?? 0;

  return (
    <div className="rounded-2xl border border-gold/25 bg-gold/[0.04] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-gold/90">
          <Coins className="size-3" /> Arena Points
        </span>
        <span className="mono rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[9.5px] text-gold-bright">
          🔥 Genesis airdrop live
        </span>
      </div>

      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <p className="text-[26px] font-semibold leading-none text-ink">{fmt(points)}</p>
          <p className="mono mt-1 text-[10px] text-muted">
            {address ? (data?.rank ? `rank #${data.rank} · ${fmt(data.fromBets)} from bets · ${fmt(data.fromReferrals)} referral` : "no bets scored yet") : "connect a wallet to see your score"}
          </p>
        </div>
        <div className="text-right">
          <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-muted">est. $ARENA</p>
          <p className="text-[15px] font-semibold text-gold-bright">
            {address ? fmt(estimated) : "—"}
          </p>
        </div>
      </div>

      <p className="mono mt-2 text-[9.5px] leading-relaxed text-muted/80">
        10 pts per $1 staked · ×2 for contrarian sides · ×1.5 for 48h markets · captains earn 20% of
        their referees&apos; points. Points convert 1:1 at genesis — nothing is purchasable today.
      </p>

      {data?.leaderboard && data.leaderboard.length > 0 && (
        <div className="mt-2 space-y-1 rounded-xl border border-white/6 bg-black/20 p-2">
          <p className="mono flex items-center gap-1 text-[9px] uppercase tracking-[0.18em] text-muted">
            <Trophy className="size-2.5" /> leaderboard
          </p>
          {data.leaderboard.slice(0, 5).map((row) => (
            <div key={row.address} className="mono flex justify-between text-[10px] text-muted">
              <span>#{row.rank} {row.address}</span>
              <span className="text-ink">{fmt(row.points)}</span>
            </div>
          ))}
        </div>
      )}

      {failed && <p className="mono mt-2 text-[9.5px] text-muted/70">points feed unavailable — retry in a minute</p>}
    </div>
  );
}
