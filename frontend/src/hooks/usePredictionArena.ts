"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { erc20Abi, isAddress, zeroAddress, type Abi, type Address } from "viem";
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

export const USDC_BY_CHAIN: Record<number, Address> = {
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [baseSepolia.id]: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

export const MIN_BET_USDC = 5n * 1_000_000n;
export const BOOTSTRAP_CAP_USDC = 50n * 1_000_000n;

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
    optionLabels: labels ?? ["赞成", "反对"],
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
      if (!ARENA_ADDRESS) throw new Error("合约地址未配置");
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
  [/BetBelowMinimum/, "下注金额低于 5 USDC 最低门槛"],
  [/BetExceedsCap/, "超出单笔上限（弱势方 20%，最低 50 USDC 保护）"],
  [/OwnerCannotBet/, "Owner 地址被禁止下注（防止裁判下场）"],
  [/EmergencyTooEarly/, "尚未到 30 天紧急退款窗口"],
  [/PoolEnded/, "该盘口已关盘，无法再下注"],
  [/PoolNotOpen/, "盘口当前不可下注"],
  [/PoolNotSettled/, "盘口尚未结算"],
  [/AlreadyClaimed/, "这笔奖励已经领取过了"],
  [/NothingToClaim/, "没有可领取的金额"],
  [/NothingToWithdraw/, "暂无可提取余额"],
  [/ZeroDataHash/, "缺少结算证据哈希"],
  [/InvalidOption/, "无效的选项"],
  [/OwnableUnauthorizedAccount|onlyOwner/i, "当前钱包没有该操作权限"],
  [/User rejected|rejected the request|denied transaction/i, "你取消了钱包签名"],
  [/insufficient funds/i, "钱包余额不足以支付 gas"],
  [/ConnectorNotConnected|not connected/i, "请先连接钱包"],
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
      if (!address) throw new Error("请先连接钱包");
      if (!ARENA_ADDRESS) throw new Error("合约地址未配置（NEXT_PUBLIC_ARENA_ADDRESS）");
      if (chainId !== TARGET_CHAIN_ID) throw new Error(`请切换到 ${TARGET_CHAIN.name} 网络`);
      if (!publicClient) throw new Error("RPC 未就绪，请稍后重试");

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
        if (receipt.status !== "success") throw new Error("交易已回滚");

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
      if (!ARENA_ADDRESS) throw new Error("合约地址未配置");
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
      if (!ARENA_ADDRESS) throw new Error("合约地址未配置");
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
