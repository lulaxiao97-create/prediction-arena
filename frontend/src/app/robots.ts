import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * robots.txt — until 2026-11-04 this file did not exist at all.
 *
 * The app has 232+ server-rendered market pages and zero of them were indexed
 * (`site:predictionarena.online` returned nothing). A missing robots.txt is not
 * itself a blocker for Google, but the missing sitemap that goes with it is: it
 * is the only cheap way to tell a crawler that 232 pages exist and changed.
 *
 * `/admin*` and `/api/*` stay out: the operator dashboard is deliberately
 * unlisted and the API answers JSON, not pages.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/admin-dash-secret", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
