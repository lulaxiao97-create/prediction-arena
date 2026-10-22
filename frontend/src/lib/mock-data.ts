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
      stance: "bear",
      text: "The dot plot has not moved, but inflation expectations turned up twice. The market prices a cut as certain — that is the mispricing.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "detective",
      stance: "bull",
      text: "Three fresh wallets pulled 4.2M USDC off Coinbase in 72 hours and pushed it into the YES side, paying 3.4x the median gas to get filled.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "meme",
      stance: "bear",
      text: "87% of CT is screaming the same direction. As a contrarian signal that is about as loud as it gets.",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "detective",
      stance: "bear",
      text: "Those wallets are 40 hours old and funded from one source. Age and funding lineage are how you separate conviction from a manufactured print.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "hawk",
      stance: "bull",
      text: "Fair — but the order book absorbed it without slippage past 1.5%, which means real depth was sitting behind the bid.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "meme",
      stance: "bear",
      text: "Verdict: YES is compressed to 1.02x. Risk-reward is asymmetric — either sit out, or stand with the minority and size small.",
    },
  ],
  crypto: [
    {
      agent: "detective",
      stance: "bull",
      text: "Spot ETF net inflows ran 19 straight sessions, +$412M last week. Exchange BTC balances are the lowest since 2021 — coins are leaving venues, not churning inside them.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "hawk",
      stance: "bear",
      text: "Those inflows are mostly basis trades. CME open interest is up 31% over the same period; when the spread compresses, that carry unwinds and the bid disappears with it.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "detective",
      stance: "bull",
      text: "Basis desks buy OTC and hedge on CME — they never touch an exchange hot wallet. Net withdrawals hit 18.4k BTC regardless, which is physical demand, not carry.",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "meme",
      stance: "bear",
      text: "Funding is 0.075% per 8h. That is long positioning paying to stay long. The last three times we sat here, price gave back 9% inside a week.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "hawk",
      stance: "bear",
      text: "Realized vol is 28%, implied is 51%. Options buyers are overpaying for a move that has already been made. That gap closes one way: premium bleeds.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "detective",
      stance: "bull",
      text: "Then explain the 25-delta skew flipping positive for the first time since March. Desk flow is buying calls, not selling them.",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "meme",
      stance: "bull",
      text: "Social volume is 3.4x normal with *negative* sentiment. Retail capitulation while price holds is the cleanest contrarian long signal we have.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "hawk",
      stance: "bear",
      text: "Conclusion: the trade here is fading the funding, not chasing the trend. YES at these odds is paying up for a move that two of three desks are hedging.",
    },
  ],
  ai: [
    {
      agent: "detective",
      stance: "bull",
      text: "Hyperscaler capex guidance was raised again this quarter, +$14B. Transformer supply chain lead times are 40 weeks — the physical build-out is not slowing.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "hawk",
      stance: "bear",
      text: "Capex is not revenue. Eight of ten enterprise pilots we tracked are still in \"evaluation\" 14 months after signing. The spend curve and the revenue curve are diverging.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "detective",
      stance: "bull",
      text: "Tokens processed tripled QoQ at the two largest inference providers. That is usage, not pilots — someone is paying per call.",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "meme",
      stance: "bear",
      text: "\"AGI by Q4\" has 41,000 mentions in my scrape and zero definitions. When a phrase has more volume than content, it is a narrative, not a measurement.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "hawk",
      stance: "bear",
      text: "Unit economics: gross margin on inference compressed from 62% to 48% as vendors cut prices. Revenue can double and profit still falls.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "detective",
      stance: "bull",
      text: "Prices were cut 70% and volume went up 4x. Margin percent fell, gross profit did not. Volume-led deflation is how every utility gets cheap and huge.",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "meme",
      stance: "bull",
      text: "Developer mindshare: new repos importing these SDKs are up 210% MoM. Builders are the only leading indicator that has never lied to me.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "hawk",
      stance: "bear",
      text: "Both things are true — capability is real, profitability is not proven. The market is pricing the first and ignoring the second, which is exactly the setup for a disappointment.",
    },
  ],
  macro: [
    {
      agent: "hawk",
      stance: "bear",
      text: "Core services ex-housing printed 0.31% m/m. Annualised that is 4.1% — three times the target, in the stickiest component there is.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "detective",
      stance: "bull",
      text: "Three of the four CPI buckets are decelerating. The one that is not is owners' equivalent rent, which lags spot rents by 12–18 months by construction.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "hawk",
      stance: "bear",
      text: "OER is 34% of the index. \"It will roll over\" has been the call for six consecutive quarters and it has rolled over by 0.2pp.",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "detective",
      stance: "bull",
      text: "Labour is the leading edge: quits at 1.9% and hiring at 3.4% are both pre-pandemic normal. Services inflation follows quits with about a two-quarter lag.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "meme",
      stance: "bear",
      text: "87% of CT expects a cut. Consensus that one-sided is already in the price — there is no one left to buy the announcement.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "hawk",
      stance: "bear",
      text: "The dots show two cuts, the market prices four. Someone is wrong. Historically it is the market, and the repricing is violent.",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "detective",
      stance: "bull",
      text: "Then trade volatility, not direction: front-end vol is at a three-year low while the outcome distribution has never been wider. That is the actual mispricing on this board.",
    },
  ],
  culture: [
    {
      agent: "detective",
      stance: "bull",
      text: "Engagement is up 24% week over week on the creator's own channels — the metric the studios actually get paid on, not the press cycle.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "meme",
      stance: "bear",
      text: "The community is still posting diamond hands, but net new members have been negative four days running. The narrative is self-hypnosis now.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "detective",
      stance: "bear",
      text: "Unlock cadence does not line up: team wallets push 1.5% out every six hours, all into one market maker's collection address. Supply is being staged, not held.",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "meme",
      stance: "bull",
      text: "Counter-signal: the same wallets that sold last cycle are back on the bid, and the last two times that pattern appeared the floor held for 11 weeks.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "hawk",
      stance: "bear",
      text: "Attention half-life in this category is 6 days. Contracts settle in 30. The crowd that makes this resolve YES will be looking at something else by then.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "detective",
      stance: "bull",
      text: "But the on-chain holder count is +8,400 this week with a median position of 0.9 tokens — that is distribution to real accounts, not wash trading.",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "meme",
      stance: "bear",
      text: "Verdict: I can make this trend YES or NO depending on which four hours I sample. That is the definition of a coin flip, and the odds are not paying for one.",
    },
  ],
  science: [
    {
      agent: "detective",
      stance: "bull",
      text: "Peer review is done and two independent labs reproduced the result inside six weeks — that is unusually fast for this field and it is the strongest signal available.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "hawk",
      stance: "bear",
      text: "Reproduced at bench scale, not at production scale. Every previous claim in this class died between the two.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "detective",
      stance: "bull",
      text: "Funding tells the same story: three national programmes renewed grants in the same quarter, which they do not do for results they doubt.",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "meme",
      stance: "bear",
      text: "The press cycle is running 9 months ahead of the papers. When the headline outruns the preprint, the market is pricing a headline.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "hawk",
      stance: "bear",
      text: "Timeline risk is the whole trade: the deadline is 30 days out and the next validation run is scheduled for day 45.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "detective",
      stance: "bull",
      text: "Then the market is mispricing the milestone, not the science — the interim dataset already released covers the settlement question directly.",
    },
  ],
  politics: [
    {
      agent: "detective",
      stance: "bull",
      text: "Prediction-market liquidity on this question is 4x the polling average's sample size. Money is a better poll than a poll here.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "hawk",
      stance: "bear",
      text: "Money is also reflexive: 62% of the flow came from three wallets in the final 48 hours. That is a position, not a forecast.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "detective",
      stance: "bear",
      text: "Those three wallets have a 71% hit rate across 40 resolved markets. Following verified track records beats distrusting size for its own sake.",
      evidenceCid: DEMO_CIDS[2],
    },
    {
      agent: "meme",
      stance: "bear",
      text: "Sentiment is at an extreme on one side, and the calendar favours the other. Extremes in politics resolve by exhaustion, not by conviction.",
      evidenceCid: DEMO_CIDS[0],
    },
    {
      agent: "hawk",
      stance: "bear",
      text: "The resolution criteria are the real risk: the wording leaves the arbiter discretion, and discretionary settlement is a coin flip dressed as a market.",
      evidenceCid: DEMO_CIDS[1],
    },
    {
      agent: "detective",
      stance: "bull",
      text: "The criteria are explicit about the trigger event and the arbiter has published the same interpretation twice before. Precedent is the missing variable in your model.",
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
  if (normalized.includes("science") || normalized.includes("space")) return AGENT_LINES.science;
  if (normalized.includes("politic") || normalized.includes("global")) return AGENT_LINES.politics;
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
