import type { Metadata } from "next";
import Link from "next/link";
import { readManifest } from "@/lib/market-manifest";
import { impliedYes } from "@/lib/market-manifest";
import { SITE_URL } from "@/lib/site";

/**
 * /markets — the crawl hub the site never had.
 *
 * The home board renders ~86 cards; the other ~146 markets were reachable only
 * from the sitemap. A crawler spends its budget on links it can follow from a
 * page it already trusts, so every market gets one plain <a> here, grouped by
 * category, with its live implied probability in the anchor text.
 *
 * Nothing interactive: this page exists to be read by a crawler and skimmed by
 * a human who wants the whole board on one screen.
 */

export const metadata: Metadata = {
  title: "All prediction markets — 235 live questions on Base | Prediction Arena",
  description:
    "Every open binary market on Prediction Arena: crypto, macro, sports, tech. Each one states its settlement rule before you can bet, and settles in USDC on Base.",
  alternates: { canonical: "/markets" },
  openGraph: {
    title: "All prediction markets — Prediction Arena",
    description: "235 live binary markets on Base, each with its settlement rule on-chain.",
    url: "/markets",
    type: "website",
  },
};

export const revalidate = 900;

// Category pages only exist for the categories with enough live markets to be worth
// a page; the rest stay as headings here. Kept in sync with app/category/[slug].
const CATEGORY_SLUGS: Record<string, string> = {
  "Crypto Core": "crypto",
  "Global Stocks": "stocks",
  "Macro Economy": "macro",
  "DeFi & Yield": "defi",
  "Layer 2 & Base": "base",
  "Sports & Gaming": "sports",
  "AI Agents & Tech": "ai",
  "Memes & Social": "memes",
};

export default async function MarketsPage() {
  const manifest = await readManifest();
  const pools = (manifest?.pools ?? []).filter((p) => p.id && (p.status === 1 || p.status === undefined));

  const byCategory = new Map<string, typeof pools>();
  for (const p of pools) {
    const key = p.category?.trim() || "Other";
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Prediction Arena — live markets",
    numberOfItems: pools.length,
    itemListElement: pools.slice(0, 100).map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE_URL}/market/${p.id}`,
      name: p.title,
    })),
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} />
      <h1 className="text-3xl font-semibold text-ink">All prediction markets</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        {pools.length} open questions on Base. Every market states the rule that settles it before anyone can
        take a side, and every settlement is written on-chain in USDC.
      </p>

      {categories.map(([category, list]) => (
        <section key={category} className="mt-10">
          <h2 className="text-lg font-medium text-ink">
            {CATEGORY_SLUGS[category] ? (
              <Link className="hover:underline" href={`/category/${CATEGORY_SLUGS[category]}`}>
                {category}
              </Link>
            ) : (
              category
            )}{" "}
            <span className="text-xs text-muted">· {list.length}</span>
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {list.map((p) => {
              const yes = Math.round(impliedYes(p) * 100);
              return (
                <li key={p.id}>
                  <Link
                    href={`/market/${p.id}`}
                    className="block rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm text-ink/90 hover:border-white/20 hover:bg-white/[0.05]"
                  >
                    <span className="block leading-snug">{p.title}</span>
                    <span className="mt-1 block text-xs text-muted">
                      YES {yes}%{p.endTimeUtc ? ` · ends ${new Date(p.endTimeUtc).toISOString().slice(0, 10)}` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className="mt-12 text-xs text-muted">
        Settled markets stay readable at their own URL. The machine-readable board is{" "}
        <a className="underline" href="/api/board">
          /api/board
        </a>
        ; the sitemap is{" "}
        <a className="underline" href="/sitemap.xml">
          /sitemap.xml
        </a>
        .
      </p>
    </main>
  );
}
