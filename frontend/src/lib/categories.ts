/**
 * Market taxonomy — the single source of truth for the category tabs.
 *
 * On-chain pools carry a free-text `category` (owner chosen, e.g. "Macro", "Crypto", "CT Drama").
 * `toMarketCategory()` folds that into one of the four curated lanes so the tabs never go empty
 * because of a spelling variant. Unknown values land in `other`, which only shows under "All".
 */

export type MarketCategory = "all" | "crypto" | "ai" | "macro" | "culture";
export type ResolvedCategory = Exclude<MarketCategory, "all"> | "other";

export const CATEGORY_TABS: { id: MarketCategory; label: string; short: string; emoji: string }[] = [
  { id: "all", label: "All Markets", short: "All", emoji: "🌐" },
  { id: "crypto", label: "Crypto", short: "Crypto", emoji: "⚡" },
  { id: "ai", label: "AI & Tech", short: "AI", emoji: "🤖" },
  { id: "macro", label: "Macro & Economy", short: "Macro", emoji: "📈" },
  { id: "culture", label: "Culture & Pop", short: "Culture", emoji: "🎮" },
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
  // macro
  macro: "macro",
  "macro & economy": "macro",
  economy: "macro",
  economics: "macro",
  fed: "macro",
  rates: "macro",
  macroeconomics: "macro",
  // culture
  culture: "culture",
  "culture & pop": "culture",
  pop: "culture",
  "ct drama": "culture",
  meme: "culture",
  memes: "culture",
  community: "culture",
  social: "culture",
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

export function categoryLabel(raw?: string | null): string {
  const resolved = toMarketCategory(raw);
  if (resolved === "other") return String(raw ?? "Market");
  return CATEGORY_TABS.find((t) => t.id === resolved)?.label ?? "Market";
}
