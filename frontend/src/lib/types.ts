export type PoolSource = "chain" | "demo";

export type ArenaPool = {
  id: bigint;
  title: string;
  category: string;
  /** unix seconds */
  endTime: number;
  /** 0 = none, 1 = open, 2 = settled, 3 = canceled (mirrors the contract enum) */
  status: number;
  winningOption: number;
  totalNetPool: bigint;
  option0Pool: bigint;
  option1Pool: bigint;
  /** bytes32 evidence digest recorded by settle(); empty for open pools */
  settlementHash: string;
  optionLabels: [string, string];
  source: PoolSource;
  /** demo-only analytics */
  traders?: number;
  volume24h?: bigint;
};

export type AgentId = "hawk" | "detective" | "meme";

export type AgentLine = {
  agent: AgentId;
  text: string;
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
