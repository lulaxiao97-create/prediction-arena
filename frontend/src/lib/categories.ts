/**
 * Market taxonomy — the single source of truth for the category tabs.
 *
 * Seven lanes, the ones the board is actually generated into (scripts/gen-board.ts writes the
 * canonical strings verbatim) plus "All Markets". On-chain pools still carry a free-text
 * `category` chosen by the owner, so `toMarketCategory()` folds that into a lane and never
 * leaves a tab empty because of a spelling variant. Unknown values land in `other`, which only
 * appears under "All".
 *
 * Adding a lane means three edits, in this order: this file, the `nav.*` + `category.*` keys in
 * lib/i18n.ts (all six locales), and the generator's category string.
 */

export type MarketCategory =
  | "all"
  | "crypto"
  | "defi"
  | "ai"
  | "memes"
  | "sports"
  | "politics"
  | "base";
export type ResolvedCategory = Exclude<MarketCategory, "all"> | "other";

export const CATEGORY_TABS: { id: MarketCategory; emoji: string; i18n: string }[] = [
  { id: "all", emoji: "🌍", i18n: "nav.allMarkets" },
  { id: "crypto", emoji: "🪙", i18n: "nav.crypto" },
  { id: "defi", emoji: "🚀", i18n: "nav.defi" },
  { id: "ai", emoji: "🤖", i18n: "nav.ai" },
  { id: "memes", emoji: "🎭", i18n: "nav.memes" },
  { id: "sports", emoji: "⚽", i18n: "nav.sports" },
  { id: "politics", emoji: "🏛️", i18n: "nav.politics" },
  { id: "base", emoji: "🌐", i18n: "nav.base" },
];

const ALIASES: Record<string, ResolvedCategory> = {
  // 🪙 Crypto & Macro
  crypto: "crypto",
  cryptocurrency: "crypto",
  bitcoin: "crypto",
  btc: "crypto",
  eth: "crypto",
  ethereum: "crypto",
  sol: "crypto",
  solana: "crypto",
  macro: "crypto",
  "macro & economy": "crypto",
  "crypto & macro": "crypto",
  economy: "crypto",
  economics: "crypto",
  fed: "crypto",
  rates: "crypto",
  inflation: "crypto",
  macroeconomics: "crypto",
  // 🚀 DeFi & L2
  defi: "defi",
  "defi & l2": "defi",
  l2: "defi",
  layer2: "defi",
  "layer 2": "defi",
  layer: "defi",
  rollup: "defi",
  rollups: "defi",
  tvl: "defi",
  dex: "defi",
  lending: "defi",
  yield: "defi",
  // 🤖 AI & Web3 Tech
  ai: "ai",
  "ai & tech": "ai",
  "ai tech": "ai",
  "ai & web3 tech": "ai",
  "ai & web3": "ai",
  tech: "ai",
  technology: "ai",
  agents: "ai",
  llm: "ai",
  robotics: "ai",
  science: "ai",
  "science & space": "ai",
  // 🎭 Memes & Culture
  memes: "memes",
  meme: "memes",
  "memes & culture": "memes",
  culture: "memes",
  "culture & pop": "memes",
  pop: "memes",
  "ct drama": "memes",
  community: "memes",
  social: "memes",
  entertainment: "memes",
  creators: "memes",
  // ⚽ Sports & Esports
  sports: "sports",
  sport: "sports",
  "sports & esports": "sports",
  esports: "sports",
  "e-sports": "sports",
  football: "sports",
  soccer: "sports",
  nba: "sports",
  basketball: "sports",
  f1: "sports",
  formula1: "sports",
  // 🏛️ Politics & Policy
  politics: "politics",
  "politics & global": "politics",
  "politics & policy": "politics",
  political: "politics",
  election: "politics",
  elections: "politics",
  geopolitics: "politics",
  global: "politics",
  world: "politics",
  policy: "politics",
  regulation: "politics",
  regulatory: "politics",
  governance: "politics",
  // 🌐 Base Ecosystem
  base: "base",
  "base ecosystem": "base",
  "base eco": "base",
  basechain: "base",
  aerodrome: "base",
  degen: "base",
  onchain: "base",
  ecosystem: "base",
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
