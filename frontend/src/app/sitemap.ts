import type { MetadataRoute } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE_URL } from "@/lib/site";

/**
 * sitemap.xml — the acquisition surface nobody had.
 *
 * Every market page is server-rendered with a real question, live odds, both
 * sides of the AI debate and the settlement rule (see `market/[id]/page.tsx`),
 * which is exactly the shape Google answers "will X happen" queries from. The
 * pages existed; nothing pointed at them.
 *
 * Built from `public/pools.json` at build time. The board is rewritten on the
 * box every 30 min, but a sitemap only has to be roughly fresh — the crawl
 * budget is spent on new markets and on the ones closest to settlement, so
 * those get the higher priority.
 */

type Pool = {
  id: string;
  title?: string;
  status?: number;
  endTimeUtc?: string;
  updatedAt?: string;
};

const STATIC_ROUTES: MetadataRoute.Sitemap = [
  { url: SITE_URL, changeFrequency: "hourly", priority: 1 },
  { url: `${SITE_URL}/markets`, changeFrequency: "hourly", priority: 0.9 },
  ...["crypto", "stocks", "macro", "defi", "base", "sports", "ai", "memes"].map((slug) => ({
    url: `${SITE_URL}/category/${slug}`,
    changeFrequency: "hourly" as const,
    priority: 0.8,
  })),
  { url: `${SITE_URL}/docs`, changeFrequency: "weekly", priority: 0.6 },
  { url: `${SITE_URL}/whitepaper`, changeFrequency: "monthly", priority: 0.5 },
  { url: `${SITE_URL}/credits`, changeFrequency: "monthly", priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let pools: Pool[] = [];
  try {
    const raw = await readFile(path.join(process.cwd(), "public", "pools.json"), "utf8");
    const manifest = JSON.parse(raw) as { pools?: Pool[]; updatedAt?: string };
    pools = Array.isArray(manifest.pools) ? manifest.pools : [];
  } catch {
    // A sitemap with only the static routes beats a 500 on /sitemap.xml.
    return STATIC_ROUTES;
  }

  const now = new Date();
  const marketRoutes: MetadataRoute.Sitemap = pools
    .filter((p) => p?.id)
    .map((p) => {
      const ends = p.endTimeUtc ? new Date(p.endTimeUtc) : undefined;
      const closing = ends && ends.getTime() > now.getTime() && ends.getTime() - now.getTime() < 48 * 3600 * 1000;
      return {
        url: `${SITE_URL}/market/${p.id}`,
        lastModified: ends && ends.getTime() < now.getTime() ? ends : now,
        changeFrequency: closing ? ("hourly" as const) : ("daily" as const),
        priority: closing ? 0.9 : 0.7,
      };
    });

  return [...STATIC_ROUTES, ...marketRoutes];
}
