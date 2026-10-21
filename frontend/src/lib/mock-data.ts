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
 * Demo pools. Only used when NEXT_PUBLIC_ARENA_ADDRESS is not configured (or the chain read
 * fails), so the UI is fully explorable before deployment. Numbers are realistic USDC depths.
 */
export function buildDemoPools(nowSeconds: number = DEMO_ANCHOR): ArenaPool[] {
  const t = nowSeconds;
  return [
    {
      id: 1n,
      title: "美联储 12 月会降息 25bp 吗？",
      category: "Macro",
      endTime: t + 86_400 * 4 + 3_600 * 7,
      status: 1,
      winningOption: 0,
      totalNetPool: u(48_960),
      option0Pool: u(29_376),
      option1Pool: u(19_584),
      settlementHash: "",
      optionLabels: ["降息", "不降息"],
      source: "demo",
      traders: 412,
      volume24h: u(12_400),
    },
    {
      id: 2n,
      title: "Base 生态 TVL 会在 Q1 突破 $50B 吗？",
      category: "Ecosystem",
      endTime: t + 86_400 * 11 + 3_600 * 2,
      status: 1,
      winningOption: 0,
      totalNetPool: u(76_800),
      option0Pool: u(63_744),
      option1Pool: u(13_056),
      settlementHash: "",
      optionLabels: ["会突破", "不会"],
      source: "demo",
      traders: 836,
      volume24h: u(21_900),
    },
    {
      id: 3n,
      title: "GPT-6 会在 2026 上半年正式发布吗？",
      category: "Tech",
      endTime: t + 86_400 * 2 + 3_600 * 15,
      status: 1,
      winningOption: 1,
      totalNetPool: u(31_680),
      option0Pool: u(19_008),
      option1Pool: u(12_672),
      settlementHash: "",
      optionLabels: ["会发布", "不会"],
      source: "demo",
      traders: 274,
      volume24h: u(8_150),
    },
    {
      id: 4n,
      title: "某 KOL 的 100x 喊单会在一周内跌破发行价吗？",
      category: "CT Drama",
      endTime: t + 3_600 * 19 + 60 * 42,
      status: 1,
      winningOption: 0,
      totalNetPool: u(22_080),
      option0Pool: u(8_832),
      option1Pool: u(13_248),
      settlementHash: "",
      optionLabels: ["会崩", "不会"],
      source: "demo",
      traders: 531,
      volume24h: u(15_300),
    },
    {
      id: 5n,
      title: "ETH/BTC 汇率年底前重回 0.04 吗？",
      category: "Macro",
      endTime: t + 86_400 * 26,
      status: 1,
      winningOption: 0,
      totalNetPool: u(64_320),
      option0Pool: u(41_808),
      option1Pool: u(22_512),
      settlementHash: "",
      optionLabels: ["会", "不会"],
      source: "demo",
      traders: 388,
      volume24h: u(9_700),
    },
    {
      id: 6n,
      title: "Aerodrome 日交易量会反超 Uniswap 吗？",
      category: "Ecosystem",
      endTime: t + 86_400 * 7 + 3_600 * 6,
      status: 2,
      winningOption: 0,
      totalNetPool: u(39_360),
      option0Pool: u(25_920),
      option1Pool: u(13_440),
      settlementHash: "0x9f2c1b7d4e8a05c3b6d1f0e2a7c84b93d5e6f708192a3b4c5d6e7f809a1b2c3d",
      optionLabels: ["会", "不会"],
      source: "demo",
      traders: 205,
      volume24h: u(6_400),
    },
  ];
}

export const AGENTS: AgentProfile[] = [
  {
    id: "hawk",
    name: "宏观鹰派",
    role: "MACRO HAWK",
    emoji: "🦅",
    accent: "text-amber-300",
    ring: "border-amber-400/40",
    bio: "只看利率、流动性、期限结构。对“这次不一样”零容忍。",
  },
  {
    id: "detective",
    name: "链上侦探",
    role: "ONCHAIN DETECTIVE",
    emoji: "🔍",
    accent: "text-emerald-300",
    ring: "border-emerald-400/40",
    bio: "追踪巨鲸钱包、DEX 资金流、稳定币净流入。只信余额变动。",
  },
  {
    id: "meme",
    name: "Meme Master",
    role: "SENTIMENT DEGEN",
    emoji: "🐸",
    accent: "text-rose-300",
    ring: "border-rose-400/40",
    bio: "情绪面专家。看喊单密度、社群热度、KOL 一致性反向指标。",
  },
];

export const AGENT_LINES: Record<string, AgentLine[]> = {
  default: [
    {
      agent: "hawk",
      text: "点阵图没变，但通胀预期已经二次抬头。市场把降息当成必然，这就是最大的定价错误。",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "detective",
      text: "过去 72 小时有 3 个新钱包从 Coinbase 提出 420 万 USDC 直接打进这个盘口的反对侧，Gas 出价是同期均值的 3.4 倍。",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "meme",
      text: "CT 上 87% 的 KOL 都在喊同一个方向 —— 按反向指标，这里应该卖。我的青蛙直觉：押反侧。",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "hawk",
      text: "结论：赞成侧赔率被压到 1.02 倍，风险回报完全不对称。要么不玩，要么站在少数人那边。",
    },
  ],
  "ct-drama": [
    {
      agent: "detective",
      text: "那个喊单地址的解锁节奏对不上：团队钱包每 6 小时转出 1.5%，接收方全是同一个做市商的归集地址。",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "meme",
      text: "社群还在刷“钻石手”，但新增成员 4 天连续为负。叙事已经进入自我催眠阶段。",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "hawk",
      text: "没有现金流、没有真实需求，只有解锁。价格发现只有一个方向。",
    },
  ],
  tech: [
    {
      agent: "hawk",
      text: "算力供给的边际成本在上升，头部实验室的 capex 已经透支到 2027 年。发布节奏只会更慢。",
    },
    {
      agent: "detective",
      text: "链上推理支付合约的调用量环比 +240%，说明新模型已经在灰度跑，只是没官宣。",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "meme",
      text: "招聘页突然下架了 12 个 alignment 岗位 —— 这通常是“已经训完了”的信号。",
      evidenceCid: DEMO_CIDS[2],
    },
  ],
};

export function agentLinesFor(category: string): AgentLine[] {
  const key = category.toLowerCase().replace(/\s+/g, "-");
  return AGENT_LINES[key] ?? AGENT_LINES.default;
}
