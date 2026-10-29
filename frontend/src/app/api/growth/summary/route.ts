import { NextResponse } from "next/server";
import { createPublicClient, formatUnits, http, parseAbiItem } from "viem";
import { base } from "viem/chains";

/**
 * On-chain referral attribution.
 *
 * What this can prove, and what it cannot — worth stating because a growth dashboard that lies is
 * worse than no dashboard:
 *
 *  - **Provable here:** every `BetPlaced` log carries the `ref` address and the `referralCut` paid
 *    to it. So "how many bets came through a referrer", "who earned what", and "which market the
 *    referred money went into" are all read straight off Base.
 *  - **Not provable here:** the channel mix (Farcaster / X / Telegram / direct). Those are `utm_*`
 *    tags on the landing page, and a landing tag never reaches the contract — the contract's
 *    referrer must be an address. Channel attribution therefore needs an analytics sink
 *    (Plausible/Umami/PostHog). The app already tags every link; see docs/ANALYTICS.md.
 *
 * Reads are chunked to 1,000 blocks because the keyless Base endpoints reject wider `eth_getLogs`
 * ranges, the same ceiling the client-side activity feed works under.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL ?? "https://mainnet.base.org";
const ARENA = (process.env.NEXT_PUBLIC_ARENA_ADDRESS ?? "0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5") as `0x${string}`;
const CHUNK = 1_000n;
const MAX_CHUNKS = 24;

const BET = parseAbiItem(
  "event BetPlaced(uint256 indexed poolId, address indexed user, uint8 indexed option, uint256 amount, uint256 netStake, uint256 fee, address ref, uint256 referralCut)",
);

type Row = {
  poolId: string;
  user: string;
  option: number;
  amount: string;
  fee: string;
  ref: string;
  referralCut: string;
  block: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("chunks") ?? "6");
  const chunks = Math.max(1, Math.min(MAX_CHUNKS, Number.isFinite(requested) ? requested : 6));

  const client = createPublicClient({ chain: base, transport: http(RPC, { timeout: 12_000 }) });

  try {
    const latest = await client.getBlockNumber();

    // Windows are scanned in parallel: a sequential loop made six chunks feel like six timeouts,
    // and one slow window held up the whole panel. allSettled keeps a throttled window from
    // failing the rest.
    const windows = Array.from({ length: chunks }, (_, i) => {
      const to = latest - BigInt(i) * CHUNK;
      return { from: to - CHUNK + 1n, to };
    }).filter((w) => w.from >= 0n);

    const settled = await Promise.allSettled(
      windows.map((w) => client.getLogs({ address: ARENA, event: BET, fromBlock: w.from, toBlock: w.to })),
    );

    const rows: Row[] = [];
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      const logs = result.value;
      {
        for (const log of logs) {
          const a = log.args as unknown as {
            poolId?: bigint;
            user?: string;
            option?: number;
            amount?: bigint;
            fee?: bigint;
            ref?: string;
            referralCut?: bigint;
          };
          rows.push({
            poolId: String(a.poolId ?? 0n),
            user: (a.user ?? "").toLowerCase(),
            option: Number(a.option ?? 0),
            amount: String(a.amount ?? 0n),
            fee: String(a.fee ?? 0n),
            ref: (a.ref ?? "").toLowerCase(),
            referralCut: String(a.referralCut ?? 0n),
            block: String(log.blockNumber ?? 0n),
          });
        }
      }
    }

    const zero = "0x0000000000000000000000000000000000000000";
    const referred = rows.filter((r) => r.ref && r.ref !== zero);
    const byRef = new Map<string, { bets: number; volume: bigint; earned: bigint }>();
    let paid = 0n;
    for (const r of referred) {
      const cut = BigInt(r.referralCut || 0);
      paid += cut;
      const entry = byRef.get(r.ref) ?? { bets: 0, volume: 0n, earned: 0n };
      entry.bets += 1;
      entry.volume += BigInt(r.amount || 0);
      entry.earned += cut;
      byRef.set(r.ref, entry);
    }

    const perMarket = new Map<string, { bets: number; referred: number; volume: bigint }>();
    for (const r of rows) {
      const entry = perMarket.get(r.poolId) ?? { bets: 0, referred: 0, volume: 0n };
      entry.bets += 1;
      entry.volume += BigInt(r.amount || 0);
      if (r.ref && r.ref !== zero) entry.referred += 1;
      perMarket.set(r.poolId, entry);
    }

    const topReferrers = [...byRef.entries()]
      .sort((a, b) => (b[1].earned > a[1].earned ? 1 : b[1].earned < a[1].earned ? -1 : b[1].bets - a[1].bets))
      .slice(0, 10)
      .map(([address, v]) => ({
        address,
        bets: v.bets,
        volumeUsdc: Number(formatUnits(v.volume, 6)),
        earnedUsdc: Number(formatUnits(v.earned, 6)),
      }));

    return NextResponse.json(
      {
        ok: true,
        window: { chunks, blocksScanned: chunks * 1_000, latestBlock: String(latest) },
        totals: {
          bets: rows.length,
          bettors: new Set(rows.map((r) => r.user)).size,
          referredBets: referred.length,
          uniqueReferrers: byRef.size,
          referralPaidUsdc: Number(formatUnits(paid, 6)),
          volumeUsdc: Number(formatUnits(rows.reduce((n, r) => n + BigInt(r.amount || 0), 0n), 6)),
        },
        topReferrers,
        perMarket: [...perMarket.entries()]
          .sort((a, b) => b[1].bets - a[1].bets)
          .slice(0, 12)
          // `volumeUsdc` is gross stake, not revenue: the contract keeps a 4% fee and the rest is pool.
          .map(([poolId, v]) => ({
            poolId,
            bets: v.bets,
            referred: v.referred,
            volumeUsdc: Number(formatUnits(v.volume, 6)),
          })),
        channels: {
          note:
            "Channel mix (Farcaster / X / Telegram / direct) is not derivable from chain logs — the contract's referrer must be an address, while channels are utm_* tags on landing pages. Point NEXT_PUBLIC_ANALYTICS_* at a sink to fill this in.",
          taggedLinks: ["ref=fc (Farcaster frame)", "utm_source=farcaster", "utm_source=x", "utm_source=telegram", "utm_source=invite", "ref=copy"],
        },
        generatedAt: new Date().toISOString(),
      },
      { headers: { "cache-control": "public, max-age=60, s-maxage=60" } },
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error)?.message ?? "rpc unavailable" }, { status: 503 });
  }
}
