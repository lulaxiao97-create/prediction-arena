import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * `/.well-known/walletconnect.txt` — WalletConnect / Reown domain verification.
 *
 * The dashboard hands out a token when a domain has to be proven (a custom domain, or any
 * origin that is not already allowlisted) and expects it at this exact path, as the whole
 * body of the response. Two ways to satisfy it, in this order:
 *
 *   1. `WALLETCONNECT_DOMAIN_VERIFICATION` on the host — one environment variable, no deploy
 *      of new code, so a token can be pasted in the dashboard and applied immediately.
 *   2. `public/.well-known/walletconnect.txt` — committed alongside the app, replaced wholesale
 *      when the token arrives.
 *
 * Served from a route handler (and rewritten ahead of the filesystem in next.config) because
 * Next's static handler does not guarantee dot-directories under `public/`.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const FROM_ENV = (process.env.WALLETCONNECT_DOMAIN_VERIFICATION ?? "").trim();

export async function GET() {
  let body = FROM_ENV;

  if (!body) {
    try {
      const file = await readFile(path.join(process.cwd(), "public", ".well-known", "walletconnect.txt"), "utf8");
      body = file.trim();
    } catch {
      body = "";
    }
  }

  if (!body) {
    return new Response("walletconnect verification token is not configured\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return new Response(`${body}\n`, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Verification pages get re-fetched right after the token changes; never let a CDN or
      // browser answer with the previous value.
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
