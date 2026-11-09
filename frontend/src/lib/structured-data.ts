import { SITE_URL } from "@/lib/site";

/**
 * JSON-LD for the pages that need to be understood by machines.
 *
 * Prediction markets have no first-class schema.org type, so the market page is
 * described as a `WebPage` whose `mainEntity` is a `Question` with the settlement
 * rule as its `acceptedAnswer`. That is the honest description of the document
 * (a question plus the condition that resolves it) and it is what Google's
 * "about this page" understanding reads.
 */

type MarketLd = {
  id: string;
  title: string;
  description?: string;
  resolution?: string;
  yesShare?: number;
  endTimeUtc?: string;
  updatedAt?: string;
};

export function marketJsonLd(m: MarketLd): string {
  const url = `${SITE_URL}/market/${m.id}`;
  const graph = [
    {
      "@type": "WebPage",
      "@id": url,
      url,
      name: m.title,
      description: m.description,
      isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website` },
      mainEntity: {
        "@type": "Question",
        name: m.title,
        text: m.description,
        acceptedAnswer: {
          "@type": "Answer",
          text: m.resolution ?? "Resolves YES or NO from the rule published on the market page.",
        },
      },
      ...(m.endTimeUtc ? { temporalCoverage: `${m.updatedAt ?? ""}/${m.endTimeUtc}` } : {}),
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Markets", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: m.title, item: url },
      ],
    },
  ];
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
}

export function siteJsonLd(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#org`,
        name: "Prediction Arena",
        url: SITE_URL,
        logo: `${SITE_URL}/icon-512.png`,
        sameAs: [
          "https://bsky.app/profile/predictionarena.bsky.social",
          "https://github.com/lulaxiao97-create/prediction-arena",
          "https://t.me/predictionarena_hq",
        ],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: "Prediction Arena",
        publisher: { "@id": `${SITE_URL}/#org` },
        inLanguage: "en",
      },
      {
        "@type": "WebApplication",
        name: "Prediction Arena",
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        url: SITE_URL,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        description:
          "Binary prediction markets priced from live market data, argued by AI agents, settled in USDC on Base.",
      },
    ],
  });
}
