import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/site";
import { impliedYes, readPool } from "@/lib/market-manifest";

/**
 * Farcaster Frame endpoint for a market.
 *
 * Warpcast renders the frame defined by the `<meta name="fc:frame:*">` tags on `/market/<id>`;
 * the buttons there are `link` actions, which means a tap opens the app with attribution
 * (`ref=fc`, `utm_source=farcaster`) instead of trying to sign a transaction inside a frame. That
 * is deliberate: the arena's bet flow is a wallet signature plus an approval on Base, and a frame
 * that pretends it can do that without the wallet would be a worse experience than a fast link.
 *
 * `post_url` still points here because Frame clients require one, and because it gives us a place
 * to answer with the live numbers when someone taps a button inside a client that supports POST.
 *
 * GET  /api/frame?id=700001  → the frame document (also what a crawler sees)
 * POST /api/frame            → same document, with the tapped side echoed back
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FrameAction = {
  untrustedData?: { buttonIndex?: number; url?: string; inputText?: string };
  buttonIndex?: number;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attribute(html: string, name: string, content: string): string {
  return html.replace(`__ATTR_${name}__`, esc(content));
}

/**
 * One template for both verbs: the frame spec expects a full HTML document whose head carries the
 * meta tags, so the response *is* the new frame rather than a JSON patch.
 */
function frameHtml(params: {
  id: string;
  title: string;
  yes: number;
  tapped?: "yes" | "no" | null;
}): string {
  const { id, title, yes, tapped } = params;
  const image = `${SITE_URL}/market/${id}/opengraph-image`;
  const target = (side: "yes" | "no") =>
    `${SITE_URL}/market/${id}?side=${side}&ref=fc&utm_source=farcaster&utm_medium=frame&utm_campaign=market_frame`;

  const headline = tapped
    ? `You picked ${tapped.toUpperCase()} — opening the market…`
    : `${yes}% YES · ${100 - yes}% NO`;

  const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<meta property="og:title" content="__ATTR_TITLE__" />
<meta property="og:image" content="__ATTR_IMAGE__" />
<meta name="fc:frame" content="vNext" />
<meta name="fc:frame:image" content="__ATTR_IMAGE__" />
<meta name="fc:frame:image:aspect_ratio" content="1.91:1" />
<meta name="fc:frame:button:1" content="🟢 Bet YES" />
<meta name="fc:frame:button:1:action" content="link" />
<meta name="fc:frame:button:1:target" content="__ATTR_YES__" />
<meta name="fc:frame:button:2" content="🔴 Bet NO" />
<meta name="fc:frame:button:2:action" content="link" />
<meta name="fc:frame:button:2:target" content="__ATTR_NO__" />
<meta name="fc:frame:button:3" content="📊 Open market" />
<meta name="fc:frame:button:3:action" content="link" />
<meta name="fc:frame:button:3:target" content="__ATTR_MARKET__" />
<meta name="fc:frame:post_url" content="__ATTR_POST__" />
<meta name="fc:frame:state" content="__ATTR_STATE__" />
</head>
<body style="margin:0;background:#05080F;color:#E8EEF9;font-family:system-ui,sans-serif">
<main style="padding:24px">
<h1 style="font-size:20px;margin:0 0 8px">${esc(title)}</h1>
<p style="margin:0 0 4px;color:#FBBF24">${esc(headline)}</p>
<p style="margin:0;color:#8FA0BF;font-size:13px">Prediction Arena — binary markets on Base, settled in USDC.</p>
<p style="margin-top:16px"><a style="color:#22D3EE" href="${esc(target("yes"))}">Bet YES</a> · <a style="color:#F87171" href="${esc(target("no"))}">Bet NO</a></p>
</main>
</body>
</html>`;

  let out = doc;
  out = attribute(out, "TITLE", title);
  out = attribute(out, "IMAGE", image);
  out = attribute(out, "YES", target("yes"));
  out = attribute(out, "NO", target("no"));
  out = attribute(out, "MARKET", `${SITE_URL}/market/${id}?ref=fc&utm_source=farcaster&utm_medium=frame`);
  out = attribute(out, "POST", `${SITE_URL}/api/frame`);
  out = attribute(out, "STATE", JSON.stringify({ id }));
  return out;
}

function htmlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Frames are cached by clients for a minute; the probability inside moves with the board.
      "cache-control": "public, max-age=60, s-maxage=60",
    },
  });
}

/**
 * Frame HTML is recomputed per request otherwise, and a Warpcast feed opens several frames at once.
 * The board refreshes every few minutes, so a 30-second memo is invisible to users and turns a
 * ~700ms render into a single memory read for everything after the first hit.
 */
const FRAME_CACHE = new Map<string, { at: number; html: string }>();
const FRAME_TTL_MS = 30_000;

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing id", usage: "/api/frame?id=<marketId>" },
      { status: 400 },
    );
  }
  const cached = FRAME_CACHE.get(id);
  if (cached && Date.now() - cached.at < FRAME_TTL_MS) {
    return htmlResponse(cached.html);
  }

  const pool = await readPool(id);
  if (!pool) return NextResponse.json({ ok: false, error: "market not found" }, { status: 404 });

  const html = frameHtml({ id, title: pool.title, yes: Math.round(impliedYes(pool) * 100) });
  FRAME_CACHE.set(id, { at: Date.now(), html });
  if (FRAME_CACHE.size > 64) FRAME_CACHE.clear();
  return htmlResponse(html);
}

export async function POST(request: Request) {
  let body: FrameAction = {};
  try {
    body = (await request.json()) as FrameAction;
  } catch {
    /* a frame client may POST an empty body; fall through to the generic frame */
  }

  const pressed = body.untrustedData?.buttonIndex ?? body.buttonIndex ?? 0;
  // The market id rides in the frame's URL (state is client-opaque), so recover it from there.
  const stateRaw = body.untrustedData?.url ?? "";
  const id = new URL(stateRaw || `${SITE_URL}/`).searchParams.get("id") ?? "700001";

  const pool = await readPool(id);
  if (!pool) return NextResponse.json({ ok: false, error: "market not found" }, { status: 404 });

  const tapped = pressed === 1 ? "yes" : pressed === 2 ? "no" : null;
  return htmlResponse(
    frameHtml({ id, title: pool.title, yes: Math.round(impliedYes(pool) * 100), tapped }),
  );
}
