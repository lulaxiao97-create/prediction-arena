"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { createPublicClient, erc20Abi, http, isAddress, zeroAddress, type Abi, type Address } from "viem";
import { base, baseSepolia } from "wagmi/chains";
import arenaArtifact from "@/lib/contracts/PredictionArena.json";
import type { ArenaPool, BetStep } from "@/lib/types";

export const ARENA_ABI = arenaArtifact.abi as Abi;

/** Address baked in at export time (`bun run abi:export`), overridable per environment. */
export const ARENA_ADDRESS = ((process.env.NEXT_PUBLIC_ARENA_ADDRESS ?? arenaArtifact.address ?? "").trim() ||
  undefined) as Address | undefined;

export const hasArena = Boolean(ARENA_ADDRESS && isAddress(ARENA_ADDRESS));

export const TARGET_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_CHAIN_ID ?? base.id
) === baseSepolia.id
  ? baseSepolia.id
  : base.id;

export const TARGET_CHAIN = TARGET_CHAIN_ID === baseSepolia.id ? baseSepolia : base;

/** First block the arena was deployed at — the event scan starts here. */
export const ARENA_DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_ARENA_DEPLOY_BLOCK ?? 52921545);

/** Settled pools keep claimable rewards; the 30-day fallback lets anyone void a stuck pool. */
export const EMERGENCY_REFUND_DELAY_SECONDS = 30 * 24 * 60 * 60;

export const USDC_BY_CHAIN: Record<number, Address> = {
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [baseSepolia.id]: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

// Mirrors contracts/PredictionArena.sol v2: flat 50 – 10,000 USDC ticket window.
export const MIN_BET_USDC = 50n * 1_000_000n;
export const MAX_BET_USDC = 10_000n * 1_000_000n;
/** @deprecated use MAX_BET_USDC — kept so older imports keep compiling. */
export const BOOTSTRAP_CAP_USDC = MAX_BET_USDC;

export type PoolRead = {
  title: string;
  category: string;
  endTime: bigint;
  winningOption: number;
  status: number;
  totalNetPool: bigint;
  option0Pool: bigint;
  option1Pool: bigint;
  settlementHash: string;
};

function normalizePool(id: bigint, raw: any, labels?: [string, string]): ArenaPool | null {
  if (!raw) return null;
  return {
    id,
    title: String(raw.title ?? ""),
    category: String(raw.category ?? ""),
    endTime: Number(raw.endTime ?? 0),
    status: Number(raw.status ?? 0),
    winningOption: Number(raw.winningOption ?? 0),
    totalNetPool: BigInt(raw.totalNetPool ?? 0n),
    option0Pool: BigInt(raw.option0Pool ?? 0n),
    option1Pool: BigInt(raw.option1Pool ?? 0n),
    settlementHash: String(raw.settlementHash ?? ""),
    tags: [],
    optionLabels: labels ?? ["Yes", "No"],
    source: "chain",
  };
}

// ─────────────────────────────────────────────────────────────── reads

export function usePools(poolIds: bigint[], labels?: Record<string, [string, string]>) {
  const contracts = useMemo(
    () =>
      poolIds.map((id) => ({
        address: (ARENA_ADDRESS ?? zeroAddress) as Address,
        abi: ARENA_ABI,
        functionName: "getPool" as const,
        args: [id] as const,
      })),
    [poolIds]
  );

  const query = useReadContracts({
    contracts: contracts as any,
    query: {
      enabled: hasArena && poolIds.length > 0,
      refetchInterval: 12_000,
      staleTime: 6_000,
    },
  });

  const pools = useMemo(() => {
    const rows = query.data as any[] | undefined;
    if (!rows) return [] as ArenaPool[];
    return rows
      .map((row, index) => {
        if (!row || row.status !== "success") return null;
        return normalizePool(poolIds[index], row.result, labels?.[String(poolIds[index])]);
      })
      .filter((p): p is ArenaPool => Boolean(p));
  }, [query.data, poolIds, labels]);

  return { ...query, pools };
}

export function usePool(poolId: bigint) {
  const { data, ...rest } = useReadContract({
    address: ARENA_ADDRESS,
    abi: ARENA_ABI,
    functionName: "getPool",
    args: [poolId],
    query: { enabled: hasArena, refetchInterval: 12_000 },
  });

  const pool = useMemo(() => normalizePool(poolId, data), [data, poolId]);
  return { ...rest, pool };
}

export function useMaxBet(poolId: bigint) {
  return useReadContract({
    address: ARENA_ADDRESS,
    abi: ARENA_ABI,
    functionName: "maxBetFor",
    args: [poolId],
    query: { enabled: hasArena, refetchInterval: 12_000 },
  });
}

export function useStake(poolId: bigint, user?: Address) {
  return useReadContract({
    address: ARENA_ADDRESS,
    abi: ARENA_ABI,
    functionName: "getStake",
    args: user ? [poolId, user] : undefined,
    query: { enabled: hasArena && Boolean(user), refetchInterval: 12_000 },
  });
}

export function usePendingRewards(poolId: bigint, user?: Address) {
  return useReadContract({
    address: ARENA_ADDRESS,
    abi: ARENA_ABI,
    functionName: "pendingRewards",
    args: user ? [poolId, user] : undefined,
    query: { enabled: hasArena && Boolean(user), refetchInterval: 12_000 },
  });
}

/** 100% of the gross stake (net + the 4% rake) on a canceled pool. */
export function usePendingRefund(poolId: bigint, user?: Address) {
  return useReadContract({
    address: ARENA_ADDRESS,
    abi: ARENA_ABI,
    functionName: "pendingRefund",
    args: user ? [poolId, user] : undefined,
    query: { enabled: hasArena && Boolean(user), refetchInterval: 12_000 },
  });
}

/**
 * Every pool the owner ever opened, newest first, read from the PoolCreated logs.
 *
 * The contract has no enumerable id counter (ids are caller-chosen timestamps), so events are
 * the only on-chain source of truth. Public Base RPCs rate-limit `eth_getLogs`, so the scan is:
 *   • chunked (1,000 blocks — the public endpoint's practical ceiling),
 *   • incremental — the last scanned block is cached in localStorage, so a reload only asks for
 *     the new blocks instead of replaying the whole history,
 *   • retried with backoff on 429.
 */
// Measured ceiling for a keyless eth_getLogs: Tenderly's public gateway rejects anything
// wider than 1,000 blocks ("Block range too large for public access"), and the other public
// Base endpoints answer a 5,000-block query with 429 / 400 / 403. Scanning in 1,000-block
// windows keeps every request inside the limit, which is what makes the incremental scan
// actually finish instead of breaking out after the first rejected chunk.
const POOL_SCAN_CHUNK = 1_000n;
const POOL_CACHE_PREFIX = "arena:poolids:";

/**
 * The log scan gets its own single-endpoint client.
 *
 * wagmi's transport is a ranked fallback, and viem re-orders it from live stability scores —
 * which means a `getLogs` can still be sent to an endpoint that only answers `eth_call`
 * (base.org replies 429, drpc 400, publicnode 403). Each of those attempts is a red line in
 * the browser console even though the retry succeeds. The scan is background work on a
 * separate budget: pin it to the endpoint that actually serves 1,000-block `getLogs` windows.
 */
const LOG_RPC_URL = "https://base.gateway.tenderly.co";
// Typed loosely on purpose: this client is only used for one call shape, and pinning the
// generic here fights the wagmi-typed `client` in the `??` fallback below for no benefit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let logClient: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLogClient(): any {
  if (typeof window === "undefined") return null;
  logClient ??= createPublicClient({ chain: base, transport: http(LOG_RPC_URL, { retryCount: 0, timeout: 12_000 }) });
  return logClient;
}

type PoolIdCache = { ids: string[]; lastBlock: number };

export type PoolManifestEntry = {
  id: string;
  title?: string;
  category?: string;
  tags?: string[];
  description?: string;
  resolution?: string;
  dataSource?: string;
  marketData?: {
    asset: string;
    spotUsd: number;
    strikeUsd: number;
    direction: "above" | "below";
    windowDays: number;
    source: string;
    asOf: string;
  };
};
export type ManifestStats = {
  tvlUsdc?: string;
  volume24hUsdc?: string;
  activeMarkets?: number;
  settledMarkets?: number;
};
type PoolIndex = {
  ids: bigint[];
  meta: Record<string, PoolManifestEntry>;
  stats: ManifestStats | null;
};

function readPoolCache(key: string): PoolIdCache {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { ids: [], lastBlock: 0 };
    const parsed = JSON.parse(raw) as PoolIdCache;
    return { ids: Array.isArray(parsed.ids) ? parsed.ids : [], lastBlock: Number(parsed.lastBlock) || 0 };
  } catch {
    return { ids: [], lastBlock: 0 };
  }
}

function writePoolCache(key: string, value: PoolIdCache) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — cache is an optimisation only */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useChainPoolIds() {
  const publicClient = usePublicClient();

  const query = useQuery({
    queryKey: ["arena", "poolIds", ARENA_ADDRESS, TARGET_CHAIN_ID],
    enabled: Boolean(publicClient && hasArena && ARENA_ADDRESS),
    staleTime: 30_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const client = publicClient!;
      const cacheKey = `${POOL_CACHE_PREFIX}${ARENA_ADDRESS}`;
      const cached = typeof window !== "undefined" ? readPoolCache(cacheKey) : { ids: [], lastBlock: 0 };

      // 1) static manifest — same-origin file, immune to RPC rate limits (see
      //    scripts/sync-pool-list.ts). Only ids are trusted from it; every field is read live.
      const seen = new Set<string>(cached.ids);
      const meta: Record<string, PoolManifestEntry> = {};
      let stats: ManifestStats | null = null;
      try {
        const res = await fetch("/pools.json", { cache: "no-store" });
        if (res.ok) {
          const manifest = (await res.json()) as {
            address?: string;
            pools?: PoolManifestEntry[];
            stats?: ManifestStats;
          };
          if (String(manifest.address ?? "").toLowerCase() === ARENA_ADDRESS?.toLowerCase()) {
            for (const entry of manifest.pools ?? []) {
              const id = String(entry.id);
              seen.add(id);
              meta[id] = { ...entry, id };
            }
            stats = manifest.stats ?? null;
          }
        }
      } catch {
        /* manifest is an optimisation, never a requirement */
      }

      // 2) incremental log scan — best effort; a 429 keeps whatever we already have
      try {
        const latest = await client.getBlockNumber();
        const startAt = BigInt(Math.max(cached.lastBlock + 1, 0));
        const from = startAt > ARENA_DEPLOY_BLOCK ? startAt : ARENA_DEPLOY_BLOCK;

        if (from <= latest) {
          for (let block = from; block <= latest; block += POOL_SCAN_CHUNK) {
            const to = block + POOL_SCAN_CHUNK - 1n > latest ? latest : block + POOL_SCAN_CHUNK - 1n;
            let logs: any[] = [];
            let failed = false;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                logs = (await (getLogClient() ?? client).getContractEvents({
                  address: ARENA_ADDRESS,
                  abi: ARENA_ABI,
                  eventName: "PoolCreated",
                  fromBlock: block,
                  toBlock: to,
                } as any)) as any[];
                break;
              } catch {
                if (attempt === 2) failed = true;
                else await sleep(600 * (attempt + 1));
              }
            }
            if (failed) break; // stop scanning; manifest + cache still serve the list
            // Space the windows out: a cold visit scans ~24 one-thousand-block windows, and
            // the public gateway answers more than ~3 requests/second with 429. 350ms keeps
            // the scan under that ceiling — it is background work, so the extra seconds cost
            // nothing the user can see, and no request fails into the console.
            await sleep(350);
            for (const log of logs) {
              const id = log?.args?.poolId as bigint | undefined;
              if (id !== undefined) seen.add(id.toString());
            }
          }
        }

        if (typeof window !== "undefined" && from <= latest) {
          writePoolCache(cacheKey, {
            ids: [...seen],
            lastBlock: Number(latest),
          });
        }
      } catch {
        /* keep manifest/cached ids */
      }

      const ids = [...seen].map((s) => BigInt(s)).sort((a, b) => (a < b ? 1 : -1));
      return { ids, meta, stats } as PoolIndex;
    },
  });

  const data = query.data as PoolIndex | undefined;

  return {
    ids: data?.ids ?? ([] as bigint[]),
    meta: data?.meta ?? ({} as Record<string, PoolManifestEntry>),
    stats: data?.stats ?? null,
    // `isLoading` is also true for a *disabled* query (status pending + fetchStatus idle),
    // which would pin the page in a permanent loading state. Only report a real in-flight fetch.
    loading: query.fetchStatus === "fetching",
    error: query.error ? describeError(query.error) : null,
  };
}

export function useUsdc() {
  const { address } = useAccount();
  const chainId = useChainId();
  const usdc = USDC_BY_CHAIN[chainId] ?? USDC_BY_CHAIN[TARGET_CHAIN_ID];

  const balance = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });

  const allowance = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && ARENA_ADDRESS ? [address, ARENA_ADDRESS] : undefined,
    query: { enabled: Boolean(address && ARENA_ADDRESS), refetchInterval: 15_000 },
  });

  return { usdc, balance, allowance };
}

/**
 * Rake is escrowed per pool until settlement, so KOL commission is read per pool
 * (`poolReferral(poolId, kol)`) rather than as one global counter.
 */
export function useAdminFees(poolId?: bigint) {
  const { address } = useAccount();
  const accumulated = useReadContract({
    address: ARENA_ADDRESS,
    abi: ARENA_ABI,
    functionName: "accumulatedAdminFees",
    query: { enabled: hasArena, refetchInterval: 30_000 },
  });
  const referral = useReadContract({
    address: ARENA_ADDRESS,
    abi: ARENA_ABI,
    functionName: "poolReferral",
    args: address && poolId !== undefined ? [poolId, address] : undefined,
    query: { enabled: hasArena && Boolean(address) && poolId !== undefined, refetchInterval: 30_000 },
  });
  return { accumulated, referral };
}

/** KOL commission withdrawal is per pool after the audit patch. */
export function useWithdrawReferralFees() {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withdraw = useCallback(
    async (poolId: bigint) => {
      if (!ARENA_ADDRESS) throw new Error("Contract address is not configured");
      setPending(true);
      setError(null);
      try {
        const hash = await writeContractAsync({
          address: ARENA_ADDRESS,
          abi: ARENA_ABI,
          functionName: "withdrawReferralFees",
          args: [poolId],
        });
        await publicClient?.waitForTransactionReceipt({ hash });
        return hash;
      } catch (e) {
        setError(describeError(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [publicClient, writeContractAsync]
  );

  return { withdraw, pending, error };
}

// ─────────────────────────────────────────────────────────────── errors

const ERROR_MESSAGES: Array<[RegExp, string]> = [
  [/BetBelowMinimum/, "Amount is below the 5 USDC minimum"],
  [/BetExceedsCap/, "Above the per-trade cap (20% of the lighter side, 50 USDC floor)"],
  [/OwnerCannotBet/, "The owner address cannot place predictions (oracle conflict of interest)"],
  [/EmergencyTooEarly/, "Protection withdrawal opens 30 days after the market closes"],
  [/PoolEnded/, "This market has closed for trading"],
  [/PoolNotOpen/, "This market is not open for trading"],
  [/PoolNotSettled/, "This market has not been resolved yet"],
  [/AlreadyClaimed/, "Winnings already claimed"],
  [/NothingToClaim/, "Nothing to claim"],
  [/NothingToWithdraw/, "Nothing to withdraw"],
  [/ZeroDataHash/, "Missing settlement evidence hash"],
  [/InvalidOption/, "Invalid outcome"],
  [/OwnableUnauthorizedAccount|onlyOwner/i, "This wallet does not have permission for that action"],
  [/User rejected|rejected the request|denied transaction/i, "You rejected the signature request"],
  [/insufficient funds/i, "Wallet balance cannot cover gas"],
  [/ConnectorNotConnected|not connected/i, "Connect a wallet first"],
];

export function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  for (const [pattern, message] of ERROR_MESSAGES) {
    if (pattern.test(raw)) return message;
  }
  const firstLine = raw.split("\n")[0];
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine;
}

// ─────────────────────────────────────────────────────────────── chain guard

export function useChainGuard() {
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();
  const wrongChain = chainId !== TARGET_CHAIN_ID;
  const switchToTarget = useCallback(() => {
    switchChain?.({ chainId: TARGET_CHAIN_ID });
  }, [switchChain]);
  return { wrongChain, switchToTarget, switching: isPending, targetChain: TARGET_CHAIN };
}

// ─────────────────────────────────────────────────────────────── referrer

export function useReferrer(): Address | undefined {
  const [referrer, setReferrer] = useState<Address | undefined>();
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref && isAddress(ref)) setReferrer(ref as Address);
    } catch {
      /* no window */
    }
  }, []);
  return referrer;
}

// ─────────────────────────────────────────────────────────────── writes

export function useBet() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState<BetStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | undefined>();

  const reset = useCallback(() => {
    setStep("idle");
    setError(null);
    setHash(undefined);
  }, []);

  const bet = useCallback(
    async (args: { poolId: bigint; option: 0 | 1; amount: bigint; referrer?: Address }) => {
      const usdc = USDC_BY_CHAIN[chainId] ?? USDC_BY_CHAIN[TARGET_CHAIN_ID];
      if (!address) throw new Error("Connect a wallet first");
      if (!ARENA_ADDRESS) throw new Error("Contract address not configured (NEXT_PUBLIC_ARENA_ADDRESS)");
      if (chainId !== TARGET_CHAIN_ID) throw new Error(`Please switch to ${TARGET_CHAIN.name}`);
      if (!publicClient) throw new Error("RPC not ready — please retry");

      setError(null);
      setHash(undefined);

      try {
        // 1) allowance check → approve only when needed (no pointless two-tx flow)
        const allowance = (await publicClient.readContract({
          address: usdc,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, ARENA_ADDRESS],
        })) as bigint;

        if (allowance < args.amount) {
          setStep("approving");
          const approveHash = await writeContractAsync({
            address: usdc,
            abi: erc20Abi,
            functionName: "approve",
            args: [ARENA_ADDRESS, args.amount],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        // 2) bet in the same flow
        setStep("betting");
        const betHash = await writeContractAsync({
          address: ARENA_ADDRESS,
          abi: ARENA_ABI,
          functionName: "bet",
          args: [args.poolId, args.option, args.amount, args.referrer ?? zeroAddress],
        });
        setHash(betHash);

        setStep("confirming");
        const receipt = await publicClient.waitForTransactionReceipt({ hash: betHash });
        if (receipt.status !== "success") throw new Error("Transaction reverted");

        setStep("done");
        return betHash;
      } catch (e) {
        setError(describeError(e));
        setStep("idle");
        throw e;
      }
    },
    [address, chainId, publicClient, writeContractAsync]
  );

  return { bet, step, error, hash, reset };
}

export function useApproveUsdc() {
  const { usdc } = useUsdc();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const approve = useCallback(
    async (amount: bigint = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")) => {
      if (!ARENA_ADDRESS) throw new Error("Contract address is not configured");
      setPending(true);
      setError(null);
      try {
        const hash = await writeContractAsync({
          address: usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [ARENA_ADDRESS, amount],
        });
        await publicClient?.waitForTransactionReceipt({ hash });
        return hash;
      } catch (e) {
        setError(describeError(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [publicClient, usdc, writeContractAsync]
  );

  return { approve, pending, error };
}

export function useClaimRewards() {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | undefined>();

  const claim = useCallback(
    async (poolId: bigint) => {
      if (!ARENA_ADDRESS) throw new Error("Contract address is not configured");
      setPending(true);
      setError(null);
      try {
        const txHash = await writeContractAsync({
          address: ARENA_ADDRESS,
          abi: ARENA_ABI,
          functionName: "claimRewards",
          args: [poolId],
        });
        setHash(txHash);
        await publicClient?.waitForTransactionReceipt({ hash: txHash });
        return txHash;
      } catch (e) {
        setError(describeError(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [publicClient, writeContractAsync]
  );

  return { claim, pending, error, hash };
}

/** Pull back 100% of the gross stake from a Canceled pool (net + the 4% rake). */
export function useClaimRefund() {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | undefined>();

  const refund = useCallback(
    async (poolId: bigint) => {
      if (!ARENA_ADDRESS) throw new Error("Contract address is not configured");
      setPending(true);
      setError(null);
      try {
        const txHash = await writeContractAsync({
          address: ARENA_ADDRESS,
          abi: ARENA_ABI,
          functionName: "claimRefund",
          args: [poolId],
        });
        setHash(txHash);
        await publicClient?.waitForTransactionReceipt({ hash: txHash });
        return txHash;
      } catch (e) {
        setError(describeError(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [publicClient, writeContractAsync]
  );

  return { refund, pending, error, hash };
}

/**
 * Permissionless safety valve: once `endTime + 30 days` has passed on a still-Open pool, ANY
 * wallet can void it so every bettor gets a 100% refund. Needed when the owner key is lost.
 */
export function useEmergencyRefund() {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | undefined>();

  const forceCancel = useCallback(
    async (poolId: bigint) => {
      if (!ARENA_ADDRESS) throw new Error("Contract address is not configured");
      setPending(true);
      setError(null);
      try {
        const txHash = await writeContractAsync({
          address: ARENA_ADDRESS,
          abi: ARENA_ABI,
          functionName: "emergencyRefund",
          args: [poolId],
        });
        setHash(txHash);
        await publicClient?.waitForTransactionReceipt({ hash: txHash });
        return txHash;
      } catch (e) {
        setError(describeError(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [publicClient, writeContractAsync]
  );

  return { forceCancel, pending, error, hash };
}
