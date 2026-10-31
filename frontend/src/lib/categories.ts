/**
 * Market taxonomy — the single source of truth for the category tabs.
 *
 * Nine lanes, the ones the board is actually generated into (scripts/gen-board.ts writes the
 * canonical strings verbatim) plus "All Markets" and "Macro & Economy" — the rates/Fed lane the
 * FRED- and Yahoo-quoted markets needed once the board went past crypto. On-chain pools still
 * carry a free-text `category` chosen by the owner, so `toMarketCategory()` folds that into a
 * lane and never leaves a tab empty because of a spelling variant. Unknown values land in
 * `other`, which only appears under "All".
 *
 * Adding a lane means three edits, in this order: this file, the `nav.*` + `category.*` keys in
 * lib/i18n.ts (all six locales), and the generator's category string.
 */

export type MarketCategory =
  | "all"
  | "crypto"
  | "defi"
  | "l2"
  | "memes"
  | "ai"
  | "macro"
  | "stocks"
  | "commodities"
  | "politics"
  | "global"
  | "sports"
  | "entertainment"
  | "meta"
  | "nft"
  | "infra"
  | "world"
  | "vc"
  | "asia"
  | "degen";
export type ResolvedCategory = Exclude<MarketCategory, "all"> | "other";

export const CATEGORY_TABS: { id: MarketCategory; emoji: string; i18n: string }[] = [
  { id: "all", emoji: "🌍", i18n: "nav.allMarkets" },
  { id: "crypto", emoji: "🪙", i18n: "nav.crypto" },
  { id: "defi", emoji: "🚀", i18n: "nav.defi" },
  { id: "l2", emoji: "🌐", i18n: "nav.l2" },
  { id: "memes", emoji: "🎭", i18n: "nav.memes" },
  { id: "ai", emoji: "🤖", i18n: "nav.ai" },
  { id: "macro", emoji: "🏦", i18n: "nav.macro" },
  { id: "stocks", emoji: "📈", i18n: "nav.stocks" },
  { id: "commodities", emoji: "🛢️", i18n: "nav.commodities" },
  { id: "politics", emoji: "🏛️", i18n: "nav.politics" },
  { id: "global", emoji: "🌍", i18n: "nav.global" },
  { id: "sports", emoji: "⚽", i18n: "nav.sports" },
  { id: "entertainment", emoji: "🎬", i18n: "nav.entertainment" },
  { id: "meta", emoji: "🎯", i18n: "nav.meta" },
  { id: "nft", emoji: "🖼️", i18n: "nav.nft" },
  { id: "infra", emoji: "🛠️", i18n: "nav.infra" },
  { id: "world", emoji: "🚀", i18n: "nav.world" },
  { id: "vc", emoji: "💰", i18n: "nav.vc" },
  { id: "asia", emoji: "🏯", i18n: "nav.asia" },
  { id: "degen", emoji: "🎲", i18n: "nav.degen" },
];

const ALIASES: Record<string, ResolvedCategory> = {
  "crypto": "crypto",
  "cryptocurrency": "crypto",
  "bitcoin": "crypto",
  "btc": "crypto",
  "eth": "crypto",
  "ethereum": "crypto",
  "sol": "crypto",
  "solana": "crypto",
  "crypto & macro": "crypto",
  "crypto core": "crypto",
  "defi": "defi",
  "defi & yield": "defi",
  "yield": "defi",
  "tvl": "defi",
  "dex": "defi",
  "lending": "defi",
  "aerodrome": "defi",
  "memes": "memes",
  "meme": "memes",
  "memes & social": "memes",
  "memes & culture": "memes",
  "culture": "memes",
  "social tokens": "memes",
  "degen": "memes",
  "ai": "ai",
  "ai agents": "ai",
  "ai & tech": "ai",
  "ai agents & tech": "ai",
  "agents": "ai",
  "llm": "ai",
  "tech": "ai",
  "research": "ai",
  "macro": "macro",
  "macro economy": "macro",
  "macro & economy": "macro",
  "macro & fed": "macro",
  "fed": "macro",
  "fomc": "macro",
  "rates": "macro",
  "inflation": "macro",
  "cpi": "macro",
  "treasury": "macro",
  "yields": "macro",
  "stocks": "stocks",
  "global stocks": "stocks",
  "equities": "stocks",
  "equity": "stocks",
  "megacap": "stocks",
  "index": "stocks",
  "s&p 500": "stocks",
  "nasdaq": "stocks",
  "apple": "stocks",
  "nvidia": "stocks",
  "commodities": "commodities",
  "commodities & metals": "commodities",
  "gold": "commodities",
  "silver": "commodities",
  "oil": "commodities",
  "wti": "commodities",
  "copper": "commodities",
  "metals": "commodities",
  "politics": "politics",
  "us politics": "politics",
  "us politics & policy": "politics",
  "election": "politics",
  "elections": "politics",
  "policy": "politics",
  "global": "global",
  "global policy": "global",
  "geopolitics": "global",
  "regulation": "global",
  "regulatory": "global",
  "world policy": "global",
  "sports": "sports",
  "sports & gaming": "sports",
  "sport": "sports",
  "esports": "sports",
  "football": "sports",
  "nba": "sports",
  "nfl": "sports",
  "f1": "sports",
  "tennis": "sports",
  "gaming": "sports",
  "entertainment": "entertainment",
  "entertainment & pop": "entertainment",
  "pop": "entertainment",
  "pop culture": "entertainment",
  "film": "entertainment",
  "box office": "entertainment",
  "music": "entertainment",
  "streaming": "entertainment",
  "celebrity": "entertainment",
  "meta": "meta",
  "prediction markets": "meta",
  "prediction market": "meta",
  "prediction markets meta": "meta",
  "polymarket": "meta",
  "kalshi": "meta",
  "nft": "nft",
  "nfts": "nft",
  "nfts & digital art": "nft",
  "digital art": "nft",
  "nft art": "nft",
  "art": "nft",
  "infra": "infra",
  "infrastructure": "infra",
  "web3 infrastructure": "infra",
  "uptime": "infra",
  "restaking": "infra",
  "staking": "infra",
  "blobs": "infra",
  "rpc": "infra",
  "world": "world",
  "real world": "world",
  "real world events": "world",
  "science": "world",
  "science & space": "world",
  "space": "world",
  "events": "world",
  "vc": "vc",
  "vc & startup deals": "vc",
  "startup": "vc",
  "startups": "vc",
  "funding": "vc",
  "ipo": "vc",
  "venture": "vc",
  "asia": "asia",
  "asia & regional": "asia",
  "asia & regional economy": "asia",
  "china": "asia",
  "japan": "asia",
  "korea": "asia",
  "india": "asia",
  "hong kong": "asia",
  "degen dials": "degen",
  "short term": "degen",
  "24h": "degen",
  "scalps": "degen",
  "high beta": "degen",
};


export function toMarketCategory(raw?: string | null): ResolvedCategory {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return ALIASES[key] ?? "other";
}

export function matchesTab(raw: string | undefined, tab: MarketCategory): boolean {
  if (tab === "all") return true;
  return toMarketCategory(raw) === tab;
}

/** Stable i18n key for a pool's category chip. */
export function categoryI18nKey(raw?: string | null): string {
  const resolved = toMarketCategory(raw);
  return `category.${resolved}`;
}
