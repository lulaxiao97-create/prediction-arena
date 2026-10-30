import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { impliedYes, liquidityLabel, readPool } from "@/lib/market-manifest";
import { coverOf } from "@/lib/covers";

// Node runtime: the market manifest and the brand mark are read straight off disk, so a
// share card never depends on an outbound request at the moment someone posts a link.
export const runtime = "nodejs";

/**
 * Cache the rendered card.
 *
 * Every response used to be `max-age=0, must-revalidate` and took ~3s of satori work, which is
 * outside the 2–3s window X's card crawler waits — the tweet then shows a broken image. With ISR the
 * first request paints once and every later one (crawlers included) is served from cache.
 */
export const revalidate = 3600;

/**
 * Prerender every card at build time.
 *
 * Satori needs 1.6–3s per card on this instance; X waits 2–3s. Caching helped machines that were
 * already warm and did nothing for the crawler that arrives first. So the cards become build
 * artifacts: a static PNG per open market, served by the CDN, no render on the request path. New
 * market ids still work — they fall back to the dynamic render and get prerendered by the next build.
 */
export async function generateStaticParams() {
  try {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), "public", "pools.json"), "utf8"),
    ) as { pools?: { id: string | number; status?: number }[] };
    return (manifest.pools ?? [])
      .filter((p) => (p.status ?? 1) === 1)
      .map((p) => ({ id: String(p.id) }));
  } catch {
    return [];
  }
}
export const alt = "Prediction Arena — market card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const OBSIDIAN = "#05080F";
const INK = "#E8EEF9";
const MUTED = "#8FA0BF";
const GOLD = "#FBBF24";
const CYAN = "#22D3EE";

/**
 * Satori rules this file lives by:
 *  - every element is flex (no block layout, no grid);
 *  - every text node is a single template literal — `{a}{b}` would make two children and
 *    a bare <div> with two children throws at render time.
 */

/** Base64 mark so satori embeds it — no network fetch, no CORS, no cold-cache flicker. */
async function markDataUri(): Promise<string | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), "public", "icon-512.png"));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * The market's own cover, inlined as a data URI.
 *
 * Satori cannot fetch a relative URL at render time (it has no document base), and a share card
 * that silently loses its artwork is worse than one that never had it — so the JPEG is read off
 * disk and embedded. Falls back to null if the file is missing; the gradients still carry it.
 */
async function coverDataUri(photo: string): Promise<string | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), "public", "covers", `${photo}.jpg`));
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function clampTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return clean.length > 104 ? `${clean.slice(0, 101).trimEnd()}…` : clean;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [pool, mark] = await Promise.all([readPool(id), markDataUri()]);
  const cover = coverOf({
    visual: pool?.visual,
    title: pool?.title,
    category: pool?.category,
    tags: pool?.tags,
    marketData: pool?.marketData,
  });
  const coverUri = await coverDataUri(cover.photo);

  const yes = Math.round(impliedYes(pool) * 100);
  const no = 100 - yes;
  const title = clampTitle(pool?.title ?? `Market #${id}`);
  const category = (pool?.category ?? "market").toUpperCase();
  const liquidity = liquidityLabel(pool);
  const titleSize = title.length > 70 ? 44 : 54;

  // Provenance badge: only claim a live feed when the manifest actually carries the numbers.
  const md = pool?.marketData;
  const money = (v: number) => {
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1000) return `$${Math.round(v).toLocaleString("en-US")}`;
    if (v >= 1) return `$${v.toFixed(2)}`;
    if (v >= 0.01) return `$${v.toFixed(4)}`;
    return `$${v.toPrecision(3)}`;
  };
  const feedLabel = md
    ? md.source.toLowerCase().includes("binance")
      ? "REAL-TIME FEED: BINANCE VERIFICATION"
      : md.source.toLowerCase().includes("coingecko")
        ? "REAL-TIME FEED: COINGECKO VERIFICATION"
        : "REAL-TIME FEED: DEFILLAMA VERIFICATION"
    : null;
  const feedLine = md
    ? `${md.asset} ${md.direction === "above" ? "ABOVE" : "BELOW"} ${money(md.strikeUsd)} · SPOT ${money(md.spotUsd)}`
    : null;

  const card = (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: "52px 60px",
        backgroundColor: OBSIDIAN,
        fontFamily: "sans-serif",
      }}
    >
      {/* the market's own cover, inlined — this is what makes the share card look like the site */}
      {coverUri ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverUri}
          width={1200}
          height={630}
          alt=""
          style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, objectFit: "cover", opacity: 0.62 }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          display: "flex",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background:
            "linear-gradient(104deg, rgba(5,8,15,0.97) 0%, rgba(5,8,15,0.9) 42%, rgba(5,8,15,0.52) 100%)",
        }}
      />
      {/* accent wash from the subject's colour, so BTC gold and EU blue cards differ at a glance */}
      <div
        style={{
          position: "absolute",
          display: "flex",
          top: -180,
          left: -120,
          width: 760,
          height: 620,
          borderRadius: 9999,
          background: `radial-gradient(circle at center, ${cover.accent}55 0%, rgba(5,8,15,0) 66%)`,
        }}
      />

      {/* deep-ocean light: two soft colour fields, no blur filter (satori has none) */}
      <div
        style={{
          position: "absolute",
          display: "flex",
          top: -240,
          left: -160,
          width: 900,
          height: 700,
          borderRadius: 9999,
          background: "radial-gradient(circle at center, rgba(18,76,110,0.8) 0%, rgba(5,8,15,0) 62%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          display: "flex",
          bottom: -300,
          right: -180,
          width: 820,
          height: 620,
          borderRadius: 9999,
          background: "radial-gradient(circle at center, rgba(122,84,16,0.6) 0%, rgba(5,8,15,0) 62%)",
        }}
      />
      {/* hairline grid — the same texture the app paints behind its cards */}
      <div
        style={{
          position: "absolute",
          display: "flex",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage:
            "linear-gradient(to right, rgba(232,238,249,0.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(232,238,249,0.055) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
        {mark ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mark} width={74} height={74} alt="" style={{ borderRadius: 18 }} />
        ) : (
          <div style={{ display: "flex", width: 74, height: 74 }} />
        )}
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 20 }}>
          <div style={{ display: "flex", fontSize: 25, fontWeight: 700, color: INK, letterSpacing: 3.2 }}>
            {"PREDICTION ARENA"}
          </div>
          <div style={{ display: "flex", fontSize: 15, color: MUTED, marginTop: 5, letterSpacing: 0.5 }}>
            {"Binary markets · argued by AI · settled in USDC"}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginLeft: "auto",
            padding: "9px 18px",
            borderRadius: 999,
            border: "1px solid rgba(251,191,36,0.35)",
            fontSize: 15,
            color: GOLD,
            letterSpacing: 1.4,
          }}
        >
          <div style={{ display: "flex", width: 8, height: 8, borderRadius: 999, backgroundColor: GOLD, marginRight: 10 }} />
          {"BASE MAINNET"}
        </div>
      </div>

      {/* headline */}
      <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
          <div
            style={{
              display: "flex",
              padding: "6px 14px",
              borderRadius: 8,
              border: "1px solid rgba(34,211,238,0.3)",
              fontSize: 14,
              color: CYAN,
              letterSpacing: 2.6,
            }}
          >
            {category}
          </div>
          <div style={{ display: "flex", marginLeft: 14, fontSize: 14, color: MUTED, letterSpacing: 1.6 }}>
            {`MARKET #${id}`}
          </div>
          <div
            style={{
              display: "flex",
              marginLeft: 14,
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${cover.accent}66`,
              fontSize: 14,
              color: cover.accent,
              letterSpacing: 2.2,
            }}
          >
            {cover.entity}
          </div>
          <div style={{ display: "flex", marginLeft: "auto", fontSize: 14, color: MUTED, letterSpacing: 1.2 }}>
            {`LIQUIDITY ${liquidity}`}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: titleSize,
            fontWeight: 700,
            color: INK,
            lineHeight: 1.16,
            letterSpacing: -0.6,
            maxWidth: 1010,
          }}
        >
          {title}
        </div>
      </div>

      {/* probability + footer */}
      <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 14 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 13, color: MUTED, letterSpacing: 2.4 }}>{"YES"}</div>
            <div style={{ display: "flex", fontSize: 52, fontWeight: 700, color: GOLD, lineHeight: 1.05 }}>
              {`${yes}%`}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginLeft: "auto", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 13, color: MUTED, letterSpacing: 2.4 }}>{"NO"}</div>
            <div style={{ display: "flex", fontSize: 52, fontWeight: 700, color: CYAN, lineHeight: 1.05 }}>
              {`${no}%`}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            width: "100%",
            height: 14,
            borderRadius: 999,
            backgroundColor: "#111A2B",
          }}
        >
          <div
            style={{
              display: "flex",
              width: `${Math.max(4, yes)}%`,
              height: 14,
              borderRadius: 999,
              background: "linear-gradient(90deg, #B45309 0%, #FBBF24 100%)",
            }}
          />
          <div style={{ display: "flex", flex: 1 }} />
        </div>

        {feedLine ? (
          <div style={{ display: "flex", alignItems: "center", marginTop: 20 }}>
            <div style={{ display: "flex", fontSize: 13, color: "#5C6C87", letterSpacing: 3.2 }}>
              {feedLine}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginLeft: "auto",
                padding: "8px 16px",
                borderRadius: 999,
                border: "1px solid rgba(34,211,238,0.35)",
                backgroundColor: "rgba(34,211,238,0.08)",
                fontSize: 13,
                color: CYAN,
                letterSpacing: 1.4,
              }}
            >
              <div style={{ display: "flex", width: 8, height: 8, borderRadius: 999, backgroundColor: CYAN, marginRight: 9 }} />
              {feedLabel}
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", marginTop: feedLine ? 12 : 24 }}>
          <div style={{ display: "flex", fontSize: 13, color: "#5C6C87", letterSpacing: 3.2 }}>
            {"PREDICTION ARENA · PA-MARK-1.0"}
          </div>
          <div style={{ display: "flex", marginLeft: "auto", fontSize: 14, color: MUTED, letterSpacing: 0.6 }}>
            {"0x108D5CDC…29A5D93 · 8453"}
          </div>
        </div>
      </div>
    </div>
  );

  return new ImageResponse(card, {
    ...size,
    headers: {
      // Crawlers respect this; the hour matches `revalidate` above so a cached card cannot outlive
      // the data it was rendered from by more than one refresh cycle.
      "cache-control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
