import { SITE_URL } from "@/lib/site";

/**
 * /llms.txt — the file AI crawlers look for before they try to parse a JS app.
 *
 * ChatGPT, Perplexity and Claude fetchers all request this path. Without it they
 * summarise the landing page (or nothing); with it they get the product, the
 * numbers and the stable URLs in the plain form a model can quote.
 */
export const dynamic = "force-static";

export function GET() {
  const body = `# Prediction Arena

> Binary prediction markets on Base. Each market is a yes/no question priced from live market data,
> carries the rule that settles it before anyone can bet, and settles in USDC with an on-chain
> evidence hash. Two AI agents argue the bull and bear case on every market page.

## Key facts
- Chain: Base (8453)
- Arena contract: 0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5 (no proxy, no mint, no owner withdrawal path)
- Markets: 232 live, each with a published settlement rule
- Collateral: native USDC on Base
- Token: none yet. 42% of the planned ARENA supply is reserved for points holders, distributed 1:1 at launch. No presale.
- Team allocation: 0%

## Pages
- ${SITE_URL}/ — board, featured market, live odds
- ${SITE_URL}/markets — every open market in one list
- ${SITE_URL}/market/{id} — one question, its odds, both AI arguments, and its settlement rule
- ${SITE_URL}/whitepaper — mechanics, fees, resolution
- ${SITE_URL}/docs — operator documentation
- ${SITE_URL}/api/board — machine-readable board (JSON)

## How it settles
A market resolves YES when the condition written in its rule is met at the stated time; the resolver
publishes the evidence hash on-chain with the payout. Fees are 4%, escrowed per market and auditable.

## Contact
- X: https://x.com/Predict065
- Telegram: https://t.me/predictionarena_hq
`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
