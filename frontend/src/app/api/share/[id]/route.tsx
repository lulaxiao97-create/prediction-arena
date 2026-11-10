import { ImageResponse } from "next/og";
import { impliedYes, readPool } from "@/lib/market-manifest";

/**
 * A shareable PNG of one visitor's call, not a screenshot of the site.
 *
 * QuickGuess used to "share" by copying a sentence to the clipboard. A sentence is fine in a quote
 * tweet and useless in a group chat, which is where a prediction actually travels. This route
 * renders the same facts the page shows — the question, the side the person took, and the crowd's
 * implied odds read from the manifest at request time — as an image the visitor can post.
 *
 * The odds are re-read here rather than passed in by the client: a caller could otherwise draw a
 * card that says anything, and a share card that lies is worse than no share card.
 */
export const runtime = "nodejs";
export const revalidate = 3600;

const OBSIDIAN = "#05080F";
const INK = "#E8EEF9";
const MUTED = "#8FA0BF";
const GOLD = "#FBBF24";
const CYAN = "#22D3EE";

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const side = new URL(req.url).searchParams.get("side") === "no" ? "no" : "yes";
  const pool = await readPool(id);
  const yes = Math.round(impliedYes(pool) * 100);
  const no = 100 - yes;
  const title = clamp(pool?.title ?? `Market #${id}`, 118);
  const titleSize = title.length > 84 ? 40 : 48;
  const mine = side === "yes" ? GOLD : CYAN;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 20,
          width: "100%",
          height: "100%",
          padding: "48px 58px",
          backgroundColor: OBSIDIAN,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            display: "flex",
            top: -220,
            right: -160,
            width: 760,
            height: 640,
            borderRadius: 9999,
            background: "radial-gradient(circle at center, rgba(18,76,110,0.85) 0%, rgba(5,8,15,0) 64%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            display: "flex",
            bottom: -260,
            left: -140,
            width: 720,
            height: 600,
            borderRadius: 9999,
            background: "radial-gradient(circle at center, rgba(251,191,36,0.28) 0%, rgba(5,8,15,0) 66%)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 20, fontWeight: 700, color: INK, letterSpacing: 4 }}>
            {"PREDICTION ARENA"}
          </div>
          <div style={{ display: "flex", fontSize: 16, color: MUTED, letterSpacing: 2 }}>
            {"BASE · USDC · ON-CHAIN"}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, gap: 26 }}>
          <div style={{ display: "flex", fontSize: titleSize, fontWeight: 700, color: INK, lineHeight: 1.24 }}>
            {title}
          </div>
          {/* the crowd's split, drawn — the two numbers on the right are the same two colours */}
          <div
            style={{
              display: "flex",
              width: "100%",
              height: 12,
              borderRadius: 9999,
              overflow: "hidden",
              backgroundColor: "rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ display: "flex", width: `${yes}%`, height: "100%", backgroundColor: GOLD }} />
            <div style={{ display: "flex", flex: 1, height: "100%", backgroundColor: CYAN }} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 15, color: MUTED, letterSpacing: 3 }}>{"MY CALL"}</div>
            <div style={{ display: "flex", fontSize: 86, fontWeight: 700, color: mine, lineHeight: 1.05 }}>
              {side === "yes" ? "YES" : "NO"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 22, color: GOLD, fontWeight: 700 }}>{`YES ${yes}%`}</div>
            <div style={{ display: "flex", fontSize: 22, color: CYAN, fontWeight: 700, marginTop: 6 }}>{`NO ${no}%`}</div>
            <div style={{ display: "flex", fontSize: 15, color: MUTED, marginTop: 10, letterSpacing: 1 }}>
              {"crowd price on the board"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 17, color: MUTED, letterSpacing: 1.2 }}>
            {"no wallet needed — take a side in one tap"}
          </div>
          <div style={{ display: "flex", fontSize: 19, color: INK, letterSpacing: 1.6 }}>{"predictionarena.online"}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
