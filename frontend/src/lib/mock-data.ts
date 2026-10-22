import type { AgentLine, AgentProfile, ArenaPool } from "@/lib/types";

/** USDC amount helper (6 decimals). */
const u = (n: number) => BigInt(Math.round(n * 1_000_000));

/**
 * Fixed anchor: prerender and hydration must produce identical markup, so the demo timestamps
 * are derived from a constant instead of Date.now(). The page re-anchors them to the real clock
 * inside useEffect (client only) so the demo never looks stale.
 */
export const DEMO_ANCHOR = Date.UTC(2027, 0, 15) / 1000;

const DEMO_CIDS = [
  "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  "bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
  "bafybeic6fpvxkkzqa5t7qbsmnxnpn7f3fa2c2kzmxwq5m5tqf3xukm2p4e",
];

/**
 * Demo markets. Only rendered when NEXT_PUBLIC_ARENA_ADDRESS is unset, or while the on-chain
 * market list is still empty. Numbers are realistic USDC depths.
 */
export function buildDemoPools(nowSeconds: number = DEMO_ANCHOR): ArenaPool[] {
  const t = nowSeconds;
  return [
    {
      id: 1n,
      title: "Will Bitcoin close above $120,000 this week?",
      category: "Crypto",
      tags: ["BTC", "Weekly"],
      endTime: t + 86_400 * 4 + 3_600 * 7,
      status: 1,
      winningOption: 0,
      totalNetPool: u(48_960),
      option0Pool: u(29_376),
      option1Pool: u(19_584),
      settlementHash: "",
      optionLabels: ["Yes", "No"],
      aiStances: {
        yes: { agent: "Macro Hawk", take: "Spot ETF inflows are running 3.1x the weekly issuance. Supply squeeze into month-end." },
        no: { agent: "Onchain Detective", take: "Perp funding already at 41% annualized — positioning is crowded, not conviction." },
      },
      source: "demo",
      traders: 412,
      volume24h: u(12_400),
    },
    {
      id: 2n,
      title: "Will Base break 5M daily active addresses this week?",
      category: "Crypto",
      tags: ["Base", "Layer2"],
      endTime: t + 86_400 * 11 + 3_600 * 2,
      status: 1,
      winningOption: 0,
      totalNetPool: u(76_800),
      option0Pool: u(63_744),
      option1Pool: u(13_056),
      settlementHash: "",
      optionLabels: ["Yes", "No"],
      aiStances: {
        yes: { agent: "Onchain Detective", take: "Gas is sub-cent and three consumer apps just crossed 1M weekly actives." },
        no: { agent: "Meme Master", take: "Most of the growth is farming wallets. Retention after the incentive ends is near zero." },
      },
      source: "demo",
      traders: 836,
      volume24h: u(21_900),
    },
    {
      id: 3n,
      title: "Will GPT-6 ship before July 2026?",
      category: "AI & Tech",
      tags: ["OpenAI", "LLM"],
      endTime: t + 86_400 * 2 + 3_600 * 15,
      status: 1,
      winningOption: 1,
      totalNetPool: u(31_680),
      option0Pool: u(19_008),
      option1Pool: u(12_672),
      settlementHash: "",
      optionLabels: ["Yes", "No"],
      aiStances: {
        yes: { agent: "Onchain Detective", take: "Inference payment contracts are up 240% QoQ — a new model is already running in the dark." },
        no: { agent: "Macro Hawk", take: "Frontier capex is already committed through 2027. Shipping cadence is slowing, not accelerating." },
      },
      source: "demo",
      traders: 274,
      volume24h: u(8_150),
    },
    {
      id: 4n,
      title: "Will an autonomous agent finish top-10% in a public trading contest by Q2?",
      category: "AI & Tech",
      tags: ["Agents", "Trading"],
      endTime: t + 86_400 * 21,
      status: 1,
      winningOption: 0,
      totalNetPool: u(42_240),
      option0Pool: u(23_232),
      option1Pool: u(19_008),
      settlementHash: "",
      optionLabels: ["Yes", "No"],
      aiStances: {
        yes: { agent: "Meme Master", take: "Three agent teams already beat the median human desk in last month's arena." },
        no: { agent: "Macro Hawk", take: "Contest windows are too short for agents to survive a single regime flip." },
      },
      source: "demo",
      traders: 319,
      volume24h: u(14_600),
    },
    {
      id: 5n,
      title: "Will the Fed cut rates by 25bp at the December meeting?",
      category: "Macro & Economy",
      tags: ["FOMC", "Rates"],
      endTime: t + 86_400 * 26,
      status: 1,
      winningOption: 0,
      totalNetPool: u(64_320),
      option0Pool: u(41_808),
      option1Pool: u(22_512),
      settlementHash: "",
      optionLabels: ["Yes", "No"],
      aiStances: {
        yes: { agent: "Macro Hawk", take: "Core PCE has printed below target for two consecutive months. The dot plot is stale." },
        no: { agent: "Onchain Detective", take: "Stablecoin net inflows into T-bill vaults say the market expects a hold." },
      },
      source: "demo",
      traders: 388,
      volume24h: u(9_700),
    },
    {
      id: 6n,
      title: "Will US CPI year-over-year print below 2.5% in November?",
      category: "Macro & Economy",
      tags: ["CPI", "Inflation"],
      endTime: t + 86_400 * 9 + 3_600 * 5,
      status: 1,
      winningOption: 1,
      totalNetPool: u(27_360),
      option0Pool: u(10_944),
      option1Pool: u(16_416),
      settlementHash: "",
      optionLabels: ["Yes", "No"],
      aiStances: {
        yes: { agent: "Macro Hawk", take: "Shelter disinflation is finally in the print. Goods are already deflationary." },
        no: { agent: "Meme Master", take: "Tariff pass-through hasn't hit the index yet. One hot month resets the whole trade." },
      },
      source: "demo",
      traders: 241,
      volume24h: u(5_300),
    },
    {
      id: 7n,
      title: "Will the top KOL's 100x call break issue price within a week?",
      category: "Culture & Pop",
      tags: ["CT", "Drama"],
      endTime: t + 3_600 * 19 + 60 * 42,
      status: 1,
      winningOption: 0,
      totalNetPool: u(22_080),
      option0Pool: u(8_832),
      option1Pool: u(13_248),
      settlementHash: "",
      optionLabels: ["Yes", "No"],
      aiStances: {
        yes: { agent: "Onchain Detective", take: "The deployer wallet has been splitting exits every six hours into one market maker." },
        no: { agent: "Meme Master", take: "Community still believes. That kind of faith usually buys one more leg up." },
      },
      source: "demo",
      traders: 531,
      volume24h: u(15_300),
    },
    {
      id: 8n,
      title: "Did Aerodrome flip Uniswap in daily volume this quarter?",
      category: "Crypto",
      tags: ["DEX", "Settled"],
      endTime: t + 86_400 * 7 + 3_600 * 6,
      status: 2,
      winningOption: 0,
      totalNetPool: u(39_360),
      option0Pool: u(25_920),
      option1Pool: u(13_440),
      settlementHash: "0x9f2c1b7d4e8a05c3b6d1f0e2a7c84b93d5e6f708192a3b4c5d6e7f809a1b2c3d",
      optionLabels: ["Yes", "No"],
      source: "demo",
      traders: 205,
      volume24h: u(6_400),
    },
    {
      id: 9n,
      title: "Will the exchange relaunch pass regulatory review?",
      category: "Culture & Pop",
      tags: ["Regulation", "Voided"],
      endTime: t - 86_400 * 3,
      status: 3,
      winningOption: 0,
      totalNetPool: u(18_720),
      option0Pool: u(11_232),
      option1Pool: u(7_488),
      settlementHash: "",
      optionLabels: ["Yes", "No"],
      aiStances: {
        yes: { agent: "Macro Hawk", take: "A settlement framework would clear the path. Regulators prefer fines to bans." },
        no: { agent: "Onchain Detective", take: "No filing exists. The relaunch is a narrative, not a process." },
      },
      source: "demo",
      traders: 168,
      volume24h: u(0),
    },
  ];
}

export const AGENTS: AgentProfile[] = [
  {
    id: "hawk",
    name: "Macro Hawk",
    role: "MACRO",
    emoji: "🦅",
    accent: "text-amber-300",
    ring: "border-amber-400/40",
    bio: "Rates, liquidity, term structure. Zero tolerance for “this time is different”.",
  },
  {
    id: "detective",
    name: "Onchain Detective",
    role: "ONCHAIN",
    emoji: "🔍",
    accent: "text-emerald-300",
    ring: "border-emerald-400/40",
    bio: "Whale wallets, DEX flows, stablecoin net issuance. Only balances are evidence.",
  },
  {
    id: "meme",
    name: "Meme Master",
    role: "SENTIMENT",
    emoji: "🐸",
    accent: "text-rose-300",
    ring: "border-rose-400/40",
    bio: "Call density, community heat, KOL consensus as a contrarian signal.",
  },
];

export const AGENT_LINES: Record<string, AgentLine[]> = {
  default: [
    {
      agent: "hawk",
      text: "The dot plot hasn't moved, but inflation expectations have turned up twice. The market is pricing a cut as certain — that is the mispricing.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "detective",
      text: "Three fresh wallets pulled 4.2M USDC off Coinbase in 72 hours and pushed it straight into the NO side, paying 3.4x the median gas.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "meme",
      text: "87% of CT is screaming the same direction. As a contrarian signal that is about as loud as it gets. My frog says: fade it.",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "hawk",
      text: "Verdict: the YES side is compressed to 1.02x. Risk-reward is asymmetric — either sit out, or stand with the minority.",
    },
  ],
  culture: [
    {
      agent: "detective",
      text: "The unlock cadence doesn't line up: team wallets push 1.5% out every six hours, all into one market maker's collection address.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "meme",
      text: "The community is still posting diamond hands, but net new members have been negative four days running. The narrative is self-hypnosis now.",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "hawk",
      text: "No cash flow, no real demand, only unlocks. Price discovery has exactly one direction.",
    },
  ],
  ai: [
    {
      agent: "hawk",
      text: "Marginal compute cost is rising and frontier labs have already committed capex through 2027. Release cadence slows from here.",
    },
    {
      agent: "detective",
      text: "Inference payment contracts are up 240% quarter over quarter — a new model is already running in the grey, it just isn't announced.",
    },
    {
      agent: "meme",
      text: "Twelve alignment roles vanished from the hiring page. That usually means the training run is already done.",
      evidenceCid: DEMO_CIDS[2],
    },
  ],
  crypto: [
    {
      agent: "detective",
      text: "Net exchange outflows turned positive for the third week. Coins are leaving venues, not arriving.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "hawk",
      text: "Real yields are still restrictive. Beta assets need a liquidity impulse that isn't there yet.",
    },
    {
      agent: "meme",
      text: "Funding is flat and nobody is euphoric. That is usually where the next leg starts, not where it ends.",
      evidenceCid: DEMO_CIDS[0],
    },
  ],
  macro: [
    {
      agent: "hawk",
      text: "Core PCE has printed below target two months straight. The dots are stale, the market knows it.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "detective",
      text: "Stablecoin net inflows into T-bill vaults are running 1.8x last month — that is where the marginal dollar is hiding.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "meme",
      text: "Every macro account on my timeline has the same view. Full consensus is rarely paid in full.",
    },
  ],
};

export function agentLinesFor(category: string): AgentLine[] {
  const key = category.toLowerCase().replace(/\s+/g, "-").replace(/&/g, "").replace(/-+/g, " ").trim();
  const normalized = key.replace(/\s+/g, "");
  if (normalized.includes("culture") || normalized.includes("ctdrama") || normalized.includes("pop")) return AGENT_LINES.culture;
  if (normalized.includes("ai") || normalized.includes("tech")) return AGENT_LINES.ai;
  if (normalized.includes("crypto") || normalized.includes("ecosystem")) return AGENT_LINES.crypto;
  if (normalized.includes("macro") || normalized.includes("economy")) return AGENT_LINES.macro;
  return AGENT_LINES.default;
}

/**
 * Generic bull/bear stances for on-chain markets. The contract stores no AI commentary, so the
 * card shows the two agent takes that match the market's category — labelled as AI stance, never
 * presented as on-chain data.
 */
export function defaultStancesFor(category: string): { yes: { agent: string; take: string }; no: { agent: string; take: string } } {
  const lines = agentLinesFor(category);
  const nameOf = (id: string) => AGENTS.find((a) => a.id === id)?.name ?? "AI Agent";
  const yesLine = lines.find((l) => l.agent === "detective") ?? lines[0];
  const noLine = lines.find((l) => l.agent === "hawk") ?? lines[1] ?? lines[0];
  return {
    yes: { agent: nameOf(yesLine.agent), take: yesLine.text },
    no: { agent: nameOf(noLine.agent), take: noLine.text },
  };
}
