/**
 * Visual mapping for markets.
 *
 * Every market gets a cover that matches its subject: gold and rate charts for macro, chain grids
 * for crypto, silicon for AI, deep space for science, and so on. Two layers make this reliable:
 *
 *   1. a procedurally generated SVG scene (deterministic per theme) — always renders, never 404s,
 *      no external request, no layout shift, works offline;
 *   2. an optional photograph layered on top. If it loads it wins (soft-light blend, 20% dim);
 *      if it fails or the network is slow the SVG scene is already there, so the card is never blank.
 *
 * Matching is keyword-first (the title says more than the category does: "Fed cuts rates" filed
 * under Macro should read as gold, not as a generic chart).
 */

export type VisualTheme = {
  id: "macro" | "crypto" | "ai" | "space" | "politics" | "culture" | "default";
  label: string;
  /** base gradient, dark enough to keep white text readable */
  from: string;
  to: string;
  /** accent used by the icon strokes and glows */
  accent: string;
  /** optional cover photo; null keeps the pure vector look */
  photo: string | null;
  /** short glyph drawn in the corner of the cover */
  glyph: string;
  match: RegExp;
};

/**
 * Covers are self-hosted on purpose: Unsplash was blocked/slow from this network and an <img> that
 * never loads leaves a card looking broken. The files in /public/covers are 1400px JPEGs pulled from
 * Unsplash (free licence) at build-prep time, so the cover is always one local request away.
 */
const COVER = (id: string) => `/covers/${id}.jpg`;

export const THEMES: VisualTheme[] = [
  {
    id: "macro",
    label: "Macro · Rates · Gold",
    from: "#3B2A05",
    to: "#0B0F19",
    accent: "#FBBF24",
    photo: COVER("macro"),
    glyph: "◈",
    match: /\b(fed|fomc|rate|rates|inflation|cpi|yield|treasury|gold|dollar|recession|gdp|macro|econom\w*|ecb|boj|payroll|jolts|oer)\b/i,
  },
  {
    id: "crypto",
    label: "Crypto · On-chain",
    from: "#3A1D02",
    to: "#0B0F19",
    accent: "#F7931A",
    photo: COVER("crypto"),
    glyph: "₿",
    match: /\b(btc|bitcoin|eth|ethereum|crypto|token|defi|l2|layer\s?2|rollup|stablecoin|usdc|etf|halving|blockchain|on-?chain|whale|funding|perp)\b/i,
  },
  {
    id: "ai",
    label: "AI · Compute",
    from: "#0B2436",
    to: "#0B0F19",
    accent: "#22D3EE",
    photo: COVER("ai"),
    glyph: "⌬",
    match: /\b(ai|agi|llm|gpt|claude|gemini|deepseek|model|models|inference|token(s)? processed|agent|agents|capex|datacenter|nvidia|gpu|robot|silicon|chip|semiconductor)\b/i,
  },
  {
    id: "space",
    label: "Science · Space",
    from: "#141B4D",
    to: "#0B0F19",
    accent: "#A78BFA",
    photo: COVER("space"),
    glyph: "✧",
    match: /\b(space|orbit|rocket|launch|satellite|nasa|spacex|mars|moon|lunar|exoplanet|telescope|fusion|gene|genome|biotech|vaccine|quantum|physics|cern|asteroid)\b/i,
  },
  {
    id: "politics",
    label: "Politics · Global",
    from: "#2B1420",
    to: "#0B0F19",
    accent: "#FB7185",
    photo: COVER("politics"),
    glyph: "⬢",
    match: /\b(election|vote|votes|senate|house|congress|parliament|president|minister|budget|shutdown|bill|law|regulation|regulator|sec|eu|g7|g20|treaty|sanctions|war|ceasefire|cbdc|prime minister)\b/i,
  },
  {
    id: "culture",
    label: "Culture · Pop",
    from: "#2A1038",
    to: "#0B0F19",
    accent: "#F0ABFC",
    photo: COVER("culture"),
    glyph: "◍",
    match: /\b(film|movie|oscar|box office|album|song|grammy|game|gaming|platform|stream|netflix|spotify|creator|influencer|award|festival|sports|league|championship|tournament|meme)\b/i,
  },
];

const DEFAULT_THEME: VisualTheme = {
  id: "default",
  label: "Prediction Market",
  from: "#0F1B33",
  to: "#0B0F19",
  accent: "#38BDF8",
  photo: COVER("crypto"),
  glyph: "◇",
  match: /$^/,
};

const CATEGORY_HINT: Record<string, VisualTheme["id"]> = {
  crypto: "crypto",
  ai: "ai",
  "ai & tech": "ai",
  macro: "macro",
  "macro & economy": "macro",
  politics: "politics",
  "politics & global": "politics",
  science: "space",
  "science & space": "space",
  culture: "culture",
  "culture & pop": "culture",
};

/**
 * Resolve the cover. Title and tags are checked before the category, because "Will the Fed cut
 * rates" sitting in Macro should still read as gold rather than as an anonymous chart.
 */
export function themeFor(input: { category?: string; title?: string; tags?: string[] }): VisualTheme {
  const haystack = [input.title, ...(input.tags ?? [])].filter(Boolean).join(" ");
  for (const theme of THEMES) {
    if (haystack && theme.match.test(haystack)) return theme;
  }
  const key = (input.category ?? "").toLowerCase().trim();
  const byCategory = CATEGORY_HINT[key];
  if (byCategory) return THEMES.find((t) => t.id === byCategory) ?? DEFAULT_THEME;
  if (haystack) {
    for (const theme of THEMES) if (theme.match.test(haystack)) return theme;
  }
  return DEFAULT_THEME;
}

/** CSS custom properties consumed by <CategoryCover />. */
export function coverStyle(theme: VisualTheme): React.CSSProperties {
  return {
    ["--cv-from" as string]: theme.from,
    ["--cv-to" as string]: theme.to,
    ["--cv-accent" as string]: theme.accent,
  };
}
