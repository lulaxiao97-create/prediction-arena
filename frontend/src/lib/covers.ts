/**
 * Cover engine — decides which artwork a market wears.
 *
 * Pure data + regex, no React and no `@/` imports, because two very different callers share it:
 *   • `scripts/gen-board.ts` writes the resolved `visual` block into `public/pools.json` at
 *     generation time, so the manifest is self-describing and the OG route never has to guess;
 *   • the app calls the same function as a fallback for older snapshots / chain rows.
 *
 * The rule is entity-first, category-second: "Will ETH close above $2,500" should wear the ETH
 * mark and Ethereum blue even though ETH lives in the Crypto lane next to BTC. Matching runs on
 * title + tags + the structured `marketData.asset`, never on invented copy.
 *
 * Every photo is self-hosted under /covers (see covers/CREDITS.json): a share card or a card
 * header must never depend on an outbound image request that can 404 at the wrong moment.
 */

export type CoverKind =
  | "token"
  | "football"
  | "basketball"
  | "esports"
  | "motorsport"
  | "politics"
  | "eu"
  | "macro"
  | "ai"
  | "neural"
  | "meme"
  | "chain"
  | "space";

export type CoverSpec = {
  kind: CoverKind;
  /** base name under /covers — the component asks for `<photo>-sm.jpg` on cards */
  photo: string;
  /** accent used by the mark, the kicker and the glow */
  accent: string;
  /** the subject: BTC, PREMIER LEAGUE, US SENATE, ZKML … */
  entity: string;
  /** the small line above it: SPOT, MATCHDAY, LEGISLATION … */
  kicker: string;
  /** real number or real state carried by the market (never synthesised) */
  metric?: string;
  /** 1–2 character mark drawn huge and ghosted over the photo (tokens) */
  mark?: string;
};

type Input = {
  title?: string;
  category?: string;
  tags?: string[];
  marketData?: {
    asset?: string;
    spotUsd?: number;
    strikeUsd?: number;
    direction?: "above" | "below";
    source?: string;
  } | null;
};

type TokenRow = { sym: string; re: RegExp; accent: string; mark: string; photo: string; label: string };

const TOKENS: TokenRow[] = [
  { sym: "BTC", re: /\bbtc\b|bitcoin|\bbtc\.d\b/i, accent: "#F7931A", mark: "₿", photo: "macro", label: "Bitcoin" },
  { sym: "ETH", re: /\beth\b|ethereum|\bether\b/i, accent: "#8A9BFF", mark: "Ξ", photo: "macro", label: "Ethereum" },
  { sym: "SOL", re: /\bsol\b|solana/i, accent: "#14F195", mark: "◎", photo: "macro", label: "Solana" },
  { sym: "AERO", re: /\baero\b|aerodrome/i, accent: "#3DA5FF", mark: "A", photo: "macro", label: "Aerodrome" },
  { sym: "DEGEN", re: /\bdegen\b/i, accent: "#A855F7", mark: "D", photo: "meme", label: "Degen" },
  { sym: "BRETT", re: /\bbrett\b/i, accent: "#3B82F6", mark: "B", photo: "meme", label: "Brett" },
  { sym: "TOSHI", re: /\btoshi\b/i, accent: "#F472B6", mark: "T", photo: "meme", label: "Toshi" },
  { sym: "USDC", re: /\busdc\b/i, accent: "#2775CA", mark: "$", photo: "macro", label: "USDC" },
];

const money = (v: number): string => {
  if (v >= 1_000) return `$${Math.round(v).toLocaleString("en-US")}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toPrecision(3)}`;
};

/** first tag that carries a real number — the manifest's tags are data, not decoration.
 *  Scientific notation ("gap $-2.66e+8") and bare source names are skipped: a metric chip is
 *  read at 10px, so it has to be a number a human can parse. */
const numericTag = (tags: string[]): string | undefined =>
  tags.find(
    (t) =>
      /\d/.test(t) &&
      !/e[+-]\d/i.test(t) &&
      !/^[a-z]+\d+$/i.test(t) &&
      !/l2beat|coingecko|defillama|binance|onchain|x402/i.test(t),
  );

/** "matchday 2026-11-01" → "NOV 01" for the sports metric chip */
const dateTag = (tags: string[]): string | undefined => {
  const hit = tags.map((t) => t.match(/(\d{4})-(\d{2})-(\d{2})/)).find(Boolean);
  if (!hit) return undefined;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${months[Number(hit[2]) - 1]} ${hit[3]}`;
};

const has = (hay: string, re: RegExp) => re.test(hay);

export function coverFor(input: Input): CoverSpec {
  const tags = input.tags ?? [];
  const md = input.marketData ?? null;
  const asset = (md?.asset ?? "").toUpperCase();
  /**
   * The category is deliberately NOT in this haystack: every sports market is filed under
   * "Sports & Esports", so /esports/ would otherwise win for football, the NBA and F1 alike.
   * Category is only the last-resort hint at the bottom of this function.
   */
  const subject = [input.title, ...tags, asset].filter(Boolean).join(" ");
  const category = (input.category ?? "").toLowerCase();

  /* 1 — sport, most specific first */
  if (has(subject, /esports|e-sports|deciding map|best-of-five|grand final/i)) {
    return { kind: "esports", photo: "esports", accent: "#FF4655", entity: "ESPORTS", kicker: "GRAND FINAL", metric: numericTag(tags) };
  }
  if (has(subject, /\bf1\b|formula\s?1|motorsport|grand prix/i)) {
    return { kind: "motorsport", photo: "motorsport", accent: "#FF2D55", entity: "FORMULA 1", kicker: "RACE MARGIN", metric: numericTag(tags) };
  }
  if (has(subject, /\bnba\b|basketball|points in regulation/i)) {
    return { kind: "basketball", photo: "basketball", accent: "#F97316", entity: "NBA", kicker: "SCORING", metric: numericTag(tags) };
  }
  if (has(subject, /premier league|champions league|\bucl\b|football|soccer|matchday|goals?\b/i)) {
    const entity = has(subject, /premier league/i)
      ? "PREMIER LEAGUE"
      : has(subject, /champions league|\bucl\b/i)
        ? "UEFA CHAMPIONS LEAGUE"
        : "FOOTBALL";
    return { kind: "football", photo: "football", accent: "#22D3EE", entity, kicker: "MATCHDAY", metric: dateTag(tags) };
  }

  /* 2 — policy: EU before US, then the Fed (rates are policy that reads like macro) */
  if (has(subject, /\beu\b|european|mica\b|brussels|member state/i)) {
    return { kind: "eu", photo: "eu", accent: "#4F8CFF", entity: "EUROPEAN UNION", kicker: "REGULATION", metric: numericTag(tags) };
  }
  if (has(subject, /\bg20\b|\bg7\b/i)) {
    return { kind: "eu", photo: "eu", accent: "#4F8CFF", entity: has(subject, /\bg20\b/i) ? "G20 REGULATORS" : "G7 POLICY", kicker: "REGULATION", metric: numericTag(tags) };
  }
  if (has(subject, /\bsenate\b|congress|capitol|legislation|\bbill\b|market structure|committee/i)) {
    return { kind: "politics", photo: "capitol", accent: "#FB7185", entity: "US SENATE", kicker: "LEGISLATION", metric: numericTag(tags) };
  }
  if (has(subject, /\bfed\b|fomc|federal reserve|rate cut|rate hike|inflation|\bcpi\b|treasury yield/i)) {
    return { kind: "macro", photo: "gold", accent: "#FBBF24", entity: "MACRO", kicker: "RATES & INFLATION", metric: numericTag(tags) };
  }
  if (has(subject, /regulator|jurisdiction|listing approval|\betf\b/i)) {
    return { kind: "eu", photo: "eu", accent: "#4F8CFF", entity: "GLOBAL REGULATORS", kicker: "POLICY", metric: numericTag(tags) };
  }

  /* 3 — AI: proof/research work reads as a lattice, product work as a compute hall */
  if (has(subject, /\bzkml\b|zero-knowledge|proof of|research|neural|benchmark/i)) {
    return { kind: "neural", photo: "neural", accent: "#C084FC", entity: has(subject, /\bzkml\b/i) ? "ZKML" : "AI RESEARCH", kicker: "VERIFICATION", metric: numericTag(tags) };
  }
  if (has(subject, /\bai\b|\bagi\b|\bllm\b|model|inference|agent|context window|nvidia|gpu|compute/i)) {
    const entity = has(subject, /agent/i)
      ? "AI AGENTS"
      : has(subject, /inference/i)
        ? "INFERENCE"
        : has(subject, /context/i)
          ? "FRONTIER MODELS"
          : "AI · COMPUTE";
    // Agents get the lattice photograph: a lane where five cards share one server hall looks
    // like a template, and "a network of agents" is exactly what the lattice says.
    const agents = /agent/i.test(subject);
    return {
      kind: agents ? "neural" : "ai",
      photo: agents ? "neural" : "ai-lab",
      accent: "#22D3EE",
      entity,
      kicker: agents ? "AUTONOMOUS AGENTS" : "MACHINE INTELLIGENCE",
      metric: numericTag(tags),
    };
  }

  /* 5 — memes & culture. A meme *token* keeps its ticker mark, but wears the street-art photo:
         that is the one place where "which coin" and "what culture" are the same card. */
  if (has(subject, /meme|culture|creator|viral|community/i)) {
    const memeToken = TOKENS.find((t) => (asset && t.sym === asset) || t.re.test(subject));
    if (memeToken) {
      const spot = typeof md?.spotUsd === "number" ? md.spotUsd : undefined;
      return {
        kind: "token",
        photo: "meme",
        accent: memeToken.accent,
        entity: memeToken.sym,
        kicker: spot !== undefined ? (md?.source ?? "SPOT").toUpperCase() : "CULTURE",
        metric: spot !== undefined ? money(spot) : numericTag(tags),
        mark: memeToken.mark,
      };
    }
    return { kind: "meme", photo: "meme", accent: "#E879F9", entity: "BASE MEMES", kicker: "CULTURE", metric: numericTag(tags) };
  }

  /* 6 — structural chain signals beat a token mention: "Ethereum TVL" is a chain card, not a
         price card, even though it names ETH. */
  if (has(subject, /\btvl\b|throughput|transactions|sequencer|rollup|\bl2\b|daily active|\bdau\b|market cap|on-?chain|stablecoin/i)) {
    const entity = has(subject, /\bbase\b/i)
      ? "BASE"
      : has(subject, /solana/i)
        ? "SOLANA"
        : has(subject, /ethereum|\beth\b/i)
          ? "ETHEREUM"
          : has(subject, /crypto/i)
            ? "CRYPTO MCAP"
            : "ON-CHAIN";
    return { kind: "chain", photo: "chain", accent: "#38BDF8", entity, kicker: "DEFI · L2", metric: numericTag(tags) };
  }

  /* 7 — a named token, now that structural and culture markets have been peeled off */
  const token = TOKENS.find((t) => (asset && t.sym === asset) || t.re.test(subject));
  if (token) {
    const spot = typeof md?.spotUsd === "number" ? md.spotUsd : undefined;
    return {
      kind: "token",
      photo: token.photo,
      accent: token.accent,
      entity: /dominance/i.test(subject) && token.sym === "BTC" ? "BTC.D" : token.sym,
      kicker: spot !== undefined ? (md?.source ?? "SPOT").toUpperCase() : "MARKET",
      metric: spot !== undefined ? money(spot) : numericTag(tags),
      mark: token.mark,
    };
  }

  /* 8 — science */
  if (has(subject, /space|orbit|rocket|nasa|spacex|mars|lunar|satellite|fusion|quantum|genome/i)) {
    return { kind: "space", photo: "space", accent: "#A78BFA", entity: "SCIENCE", kicker: "SPACE & RESEARCH", metric: numericTag(tags) };
  }

  /* 9 — last resort: the lane the market is filed in */
  if (category.includes("sport")) return { kind: "football", photo: "football", accent: "#22D3EE", entity: "SPORTS", kicker: "MATCHDAY", metric: dateTag(tags) };
  if (category.includes("politic")) return { kind: "politics", photo: "capitol", accent: "#FB7185", entity: "POLICY", kicker: "LEGISLATION", metric: numericTag(tags) };
  if (category.includes("meme")) return { kind: "meme", photo: "meme", accent: "#E879F9", entity: "CULTURE", kicker: "MEMES", metric: numericTag(tags) };
  if (category.includes("ai")) return { kind: "ai", photo: "ai-lab", accent: "#22D3EE", entity: "AI · WEB3", kicker: "MACHINE INTELLIGENCE", metric: numericTag(tags) };
  if (category.includes("crypto") || category.includes("macro")) return { kind: "macro", photo: "gold", accent: "#FBBF24", entity: "MARKETS", kicker: "MACRO", metric: numericTag(tags) };

  return { kind: "chain", photo: "chain", accent: "#38BDF8", entity: "MARKET", kicker: "PREDICTION ARENA", metric: numericTag(tags) };
}

/**
 * Cover for a pool — prefers the manifest's resolved `visual`, falls back to the live rules.
 * Chain rows and older snapshots have no `visual`, and a card must never render without art.
 */
export function coverOf(pool: {
  visual?: Partial<CoverSpec> | null;
  title?: string;
  category?: string;
  tags?: string[];
  marketData?: Input["marketData"];
}): CoverSpec {
  const v = pool.visual;
  if (v && typeof v.kind === "string" && typeof v.photo === "string" && typeof v.accent === "string" && v.entity) {
    return {
      kind: v.kind as CoverKind,
      photo: v.photo,
      accent: v.accent,
      entity: v.entity,
      kicker: v.kicker ?? "PREDICTION ARENA",
      metric: v.metric,
      mark: v.mark,
    };
  }
  return coverFor(pool);
}

/** Descriptive label per kind, used by the credits page. */
export const COVER_LABELS: Record<string, string> = {
  token: "Token marks + market tape",
  football: "Floodlit football pitch",
  basketball: "Indoor basketball arena",
  esports: "Esports arena stage",
  motorsport: "Formula 1 car on track",
  politics: "United States Capitol",
  eu: "European Parliament hemicycle",
  macro: "Rates & candlestick tape",
  ai: "AI compute hall",
  neural: "Neural network lattice",
  meme: "Street-art mural",
  chain: "Night skyline / on-chain",
  space: "Earth from orbit",
};
