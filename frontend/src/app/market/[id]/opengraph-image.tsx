import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { impliedYes, liquidityLabel, readPool } from "@/lib/market-manifest";

// Node runtime: the market manifest and the brand mark are read straight off disk, so a
// share card never depends on an outbound request at the moment someone posts a link.
export const runtime = "nodejs";
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

function clampTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return clean.length > 104 ? `${clean.slice(0, 101).trimEnd()}…` : clean;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [pool, mark] = await Promise.all([readPool(id), markDataUri()]);

  const yes = Math.round(impliedYes(pool) * 100);
  const no = 100 - yes;
  const title = clampTitle(pool?.title ?? `Market #${id}`);
  const category = (pool?.category ?? "market").toUpperCase();
  const liquidity = liquidityLabel(pool);
  const titleSize = title.length > 70 ? 44 : 54;

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

        <div style={{ display: "flex", alignItems: "center", marginTop: 24 }}>
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

  return new ImageResponse(card, { ...size });
}
