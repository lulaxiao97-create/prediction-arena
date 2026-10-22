"use client";

import { useCallback, useEffect, useState } from "react";

export type TradeRecord = {
  id: string;
  poolId: string;
  title: string;
  option: 0 | 1;
  /** gross USDC (what left the wallet) */
  amount: number;
  txHash?: string;
  at: number;
  source: "chain" | "demo";
};

const KEY = "prediction-arena:trades";
const listeners = new Set<() => void>();

function read(): TradeRecord[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TradeRecord[];
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.poolId === "string") : [];
  } catch {
    return [];
  }
}

function write(rows: TradeRecord[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 100)));
  } catch {
    /* storage full / private mode — history is a convenience only */
  }
  listeners.forEach((fn) => fn());
}

export function recordTrade(record: Omit<TradeRecord, "id" | "at"> & { at?: number }) {
  if (typeof window === "undefined") return;
  const rows = read();
  rows.unshift({
    ...record,
    id: `${record.poolId}-${Date.now()}`,
    at: record.at ?? Math.floor(Date.now() / 1000),
  });
  write(rows);
}

export function clearTradeHistory() {
  write([]);
}

/** Local trade log — the chain has no per-user indexer, so the wallet's own receipts are kept here. */
export function useTradeHistory() {
  const [rows, setRows] = useState<TradeRecord[]>([]);

  useEffect(() => {
    setRows(read());
    const listener = () => setRows(read());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const clear = useCallback(() => clearTradeHistory(), []);
  return { rows, clear };
}
