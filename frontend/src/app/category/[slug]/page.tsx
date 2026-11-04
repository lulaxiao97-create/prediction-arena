import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readManifest, impliedYes } from "@/lib/market-manifest";
import { SITE_URL } from "@/lib/site";

/**
 * Category landing pages.
 *
 * /markets is one long list; these are the pages a search engine can rank for
 * "crypto prediction markets" / "sports prediction markets on Base" without the
 * site having to write a blog post per topic. Each one carries a real intro
 * (not a keyword stub), the live markets in that category, and a canonical URL.
 *
 * Only categories with enough live markets get a page: a 2-market page is a
 * thin page, and thin pages dilute the whole site.
 */

type Cat = { slug: string; name: string; intro: string };

const CATEGORIES: Cat[] = [
  {
    slug: "crypto",
    name: "Crypto Core",
    intro:
      "Bitcoin, Ethereum and the majors, priced as yes/no questions instead of charts. Each market names a strike, a source and a time; the source print decides it. If you think spot is wrong, you can take the other side in one transaction rather than opening a perp with funding and liquidation risk.",
  },
  {
    slug: "stocks",
    name: "Global Stocks",
    intro:
      "Single names and indices as binary events: does the print land above or below this level, does the guidance cut happen this quarter. Settlement is written before the bet, so there is no argument about which number counts.",
  },
  {
    slug: "macro",
    name: "Macro Economy",
    intro:
      "Rates, inflation prints and central-bank decisions. These are the questions that move every other market, and they resolve against a published release rather than a headline interpretation.",
  },
  {
    slug: "defi",
    name: "DeFi & Yield",
    intro:
      "Protocol TVL, yield rates, depeg risk and governance outcomes. Crypto-native questions where the evidence is on-chain and the resolution can point at a block height instead of a news article.",
  },
  {
    slug: "base",
    name: "Layer 2 & Base",
    intro:
      "Base, the L2s and the on-chain activity around them. Prediction Arena itself settles on Base in USDC, so these markets resolve against the same chain their collateral lives on.",
  },
  {
    slug: "sports",
    name: "Sports & Gaming",
    intro:
      "Matches, series and tournaments as binary outcomes. No parlays, no margin: one question, two sides, a payout in USDC when the result is final.",
  },
  {
    slug: "ai",
    name: "AI Agents & Tech",
    intro:
      "Model releases, benchmarks and company milestones. Questions about an industry that ships weekly, settled against a named, checkable event.",
  },
  {
    slug: "memes",
    name: "Memes & Social",
    intro:
      "Attention as a market: which coin holds the timeline, which post crosses a threshold, which trend survives the week. Fast markets with short clocks and hard-to-fake references.",
  },
];

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const cat = CATEGORIES.find((c) => c.slug === slug);
  if (!cat) return {};
  const title = `${cat.name} prediction markets — live odds on Base | Prediction Arena`;
  const description = `${cat.name} as binary markets: ${cat.intro.slice(0, 120)}…`;
  return {
    title,
    description,
    alternates: { canonical: `/category/${cat.slug}` },
    openGraph: { title, description, url: `/category/${cat.slug}`, type: "website" },
  };
}

export const revalidate = 900;

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cat = CATEGORIES.find((c) => c.slug === slug);
  if (!cat) notFound();

  const manifest = await readManifest();
  const pools = (manifest?.pools ?? []).filter(
    (p) => p.category === cat.name && (p.status === 1 || p.status === undefined),
  );

  const collection = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${cat.name} prediction markets`,
    url: `${SITE_URL}/category/${cat.slug}`,
    isPartOf: { "@type": "WebSite", name: "Prediction Arena", url: SITE_URL },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: pools.length,
      itemListElement: pools.map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE_URL}/market/${p.id}`,
        name: p.title,
      })),
    },
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(collection) }} />
      <nav className="text-xs text-muted">
        <Link className="underline" href="/markets">
          All markets
        </Link>{" "}
        / {cat.name}
      </nav>
      <h1 className="mt-3 text-3xl font-semibold text-ink">{cat.name} prediction markets</h1>
      <p className="mt-4 text-sm leading-relaxed text-ink/80">{cat.intro}</p>
      <p className="mt-2 text-xs text-muted">
        {pools.length} open {pools.length === 1 ? "market" : "markets"} in this category · settled in USDC on Base
      </p>

      <ul className="mt-8 space-y-2">
        {pools.map((p) => (
          <li key={p.id}>
            <Link
              href={`/market/${p.id}`}
              className="block rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 hover:border-white/20 hover:bg-white/[0.05]"
            >
              <span className="block text-sm text-ink/90">{p.title}</span>
              <span className="mt-1 block text-xs text-muted">
                YES {Math.round(impliedYes(p) * 100)}% · {p.traders ?? 0} traders
                {p.endTimeUtc ? ` · ends ${new Date(p.endTimeUtc).toISOString().slice(0, 10)}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-xs text-muted">
        Every market states its settlement rule before you can take a side. Read{" "}
        <Link className="underline" href="/whitepaper">
          how resolution works
        </Link>
        .
      </p>
    </main>
  );
}
