import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const USDC_DECIMALS = 6;

export function formatUsdc(value: bigint | undefined | null, digits = 2): string {
  if (value === undefined || value === null) return "0.00";
  const asNumber = Number(value) / 10 ** USDC_DECIMALS;
  return asNumber.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function toUsdcNumber(value: bigint | undefined | null): number {
  if (!value) return 0;
  return Number(value) / 10 ** USDC_DECIMALS;
}

/** Pari-mutuel multiplier if this side wins: total net pool / this side's pool. */
export function impliedMultiplier(totalNet: bigint, sidePool: bigint): number {
  if (!sidePool || sidePool === 0n) return 0;
  return Number(totalNet) / Number(sidePool);
}

export function sideShare(sidePool: bigint, otherPool: bigint): number {
  const total = Number(sidePool + otherPool);
  if (total === 0) return 0.5;
  return Number(sidePool) / total;
}

export function shortAddr(addr?: string, size = 4): string {
  if (!addr) return "";
  return `${addr.slice(0, 2 + size)}…${addr.slice(-size)}`;
}

export type Countdown = { d: number; h: number; m: number; s: number; ended: boolean; total: number };

export function countdown(endTime: number, nowMs = Date.now()): Countdown {
  const total = Math.max(0, endTime - Math.floor(nowMs / 1000));
  return {
    d: Math.floor(total / 86_400),
    h: Math.floor((total % 86_400) / 3_600),
    m: Math.floor((total % 3_600) / 60),
    s: total % 60,
    ended: total === 0,
    total,
  };
}

export function formatCountdown(c: Countdown): string {
  if (c.ended) return "已关盘";
  if (c.d > 0) return `${c.d}d ${String(c.h).padStart(2, "0")}h ${String(c.m).padStart(2, "0")}m`;
  return `${String(c.h).padStart(2, "0")}:${String(c.m).padStart(2, "0")}:${String(c.s).padStart(2, "0")}`;
}

export function formatEndDate(endTime: number): string {
  return new Date(endTime * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ipfsGatewayUrl(cidOrHash: string): string {
  const gateway = process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://ipfs.io/ipfs/";
  const base = gateway.endsWith("/") ? gateway : `${gateway}/`;
  return `${base}${cidOrHash.replace(/^ipfs:\/\//, "")}`;
}

export function explorerTx(hash: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_EXPLORER_URL || "https://basescan.org";
  return `${baseUrl}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_EXPLORER_URL || "https://basescan.org";
  return `${baseUrl}/address/${address}`;
}
