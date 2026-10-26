export type PoolSource = "chain" | "demo";

/** Two-sided AI stances shown on every market card (bull case vs. bear case). */
export type AiStances = {
  yes: { agent: string; take: string };
  no: { agent: string; take: string };
};

export type ArenaPool = {
  id: bigint;
  title: string;
  /** Raw on-chain category string (e.g. "Crypto", "Macro"). Use lib/categories to bucket it. */
  category: string;
  /** Display tags: chain-sourced from the manifest, or derived from the category. */
  tags: string[];
  /** unix seconds */
  endTime: number;
  /** 0 = none, 1 = open, 2 = settled, 3 = canceled (mirrors the contract enum) */
  status: number;
  winningOption: number;
  /** Net liquidity in the pool (fees excluded) — what the UI calls Total Liquidity. */
  totalNetPool: bigint;
  option0Pool: bigint;
  option1Pool: bigint;
  /** bytes32 evidence digest recorded by settle(); empty for open pools */
  settlementHash: string;
  /** Outcome labels: [Yes, No] by default. */
  optionLabels: [string, string];
  /** AI debate stances rendered inside the card. */
  aiStances?: AiStances;
  source: PoolSource;
  /** demo-only analytics */
  traders?: number;
  volume24h?: bigint;
  /**
   * Numbers behind a data-driven market (spot, strike, feed). Present for price/TVL markets,
   * absent for editorial ones — the share card and the tweet read it instead of parsing the
   * title, and its absence is how the UI knows not to claim a live feed.
   */
  marketData?: MarketData;
  /** Lower-cased haystack: title + category + tags + description + resolution + feed name. */
  searchText?: string;
  /**
   * Resolved artwork (photo + accent + entity) written by scripts/gen-board.ts. Optional so an
   * older manifest still renders: the UI falls back to `coverOf(pool)` on the fly.
   */
  visual?: import("@/lib/covers").CoverSpec;
};

export type MarketData = {
  asset: string;
  spotUsd: number;
  strikeUsd: number;
  direction: "above" | "below";
  windowDays: number;
  source: string;
  asOf: string;
};

export type AgentId = "hawk" | "detective" | "meme";

export type AgentLine = {
  agent: AgentId;
  text: string;
  /** Which side of the binary this line argues. Drives the BULL/BEAR chip in the debate feed. */
  stance?: "bull" | "bear";
  evidenceCid?: string;
};

export type AgentProfile = {
  id: AgentId;
  name: string;
  role: string;
  emoji: string;
  accent: string; // tailwind text color class
  ring: string; // tailwind border color class
  bio: string;
};

export type BetStep = "idle" | "approving" | "betting" | "confirming" | "done";

/** Aggregate numbers for the dashboard banner (from public/pools.json or live chain reads). */
export type MarketStats = {
  tvl: bigint;
  activeMarkets: number;
  volume24h: bigint;
  settledMarkets: number;
};
