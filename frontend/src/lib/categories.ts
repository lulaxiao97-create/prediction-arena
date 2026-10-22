/**
 * Market taxonomy — the single source of truth for the category tabs (7 Polymarket-style lanes).
 *
 * On-chain pools carry a free-text `category` (owner chosen, e.g. "Macro", "Crypto", "CT Drama").
 * `toMarketCategory()` folds that into one of the six curated lanes so tabs never go empty because
 * of a spelling variant. Unknown values land in `other`, which only shows under "All".
 */

export type MarketCategory = "all" | "crypto" | "ai" | "macro" | "politics" | "science" | "culture";
export type ResolvedCategory = Exclude<MarketCategory, "all"> | "other";

export const CATEGORY_TABS: { id: MarketCategory; emoji: string; i18n: string }[] = [
  { id: "all", emoji: "🌐", i18n: "nav.allMarkets" },
  { id: "crypto", emoji: "⚡", i18n: "nav.crypto" },
  { id: "ai", emoji: "🤖", i18n: "nav.ai" },
  { id: "macro", emoji: "📈", i18n: "nav.macro" },
  { id: "politics", emoji: "🗳️", i18n: "nav.politics" },
  { id: "science", emoji: "🧬", i18n: "nav.science" },
  { id: "culture", emoji: "🎮", i18n: "nav.culture" },
];

const ALIASES: Record<string, ResolvedCategory> = {
  // crypto
  crypto: "crypto",
  cryptocurrency: "crypto",
  bitcoin: "crypto",
  btc: "crypto",
  eth: "crypto",
  ethereum: "crypto",
  layer2: "crypto",
  l2: "crypto",
  defi: "crypto",
  ecosystem: "crypto",
  onchain: "crypto",
  // ai & tech
  ai: "ai",
  "ai & tech": "ai",
  "ai tech": "ai",
  tech: "ai",
  technology: "ai",
  agents: "ai",
  llm: "ai",
  robotics: "ai",
  // macro
  macro: "macro",
  "macro & economy": "macro",
  economy: "macro",
  economics: "macro",
  fed: "macro",
  rates: "macro",
  macroeconomics: "macro",
  inflation: "macro",
  // politics & global
  politics: "politics",
  "politics & global": "politics",
  political: "politics",
  election: "politics",
  elections: "politics",
  geopolitics: "politics",
  global: "politics",
  world: "politics",
  policy: "politics",
  // science & space
  science: "science",
  "science & space": "science",
  space: "science",
  biology: "science",
  biotech: "science",
  health: "science",
  climate: "science",
  physics: "science",
  // culture
  culture: "culture",
  "culture & pop": "culture",
  pop: "culture",
  "ct drama": "culture",
  meme: "culture",
  memes: "culture",
  community: "culture",
  social: "culture",
  sports: "culture",
  entertainment: "culture",
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
