import { ImageResponse } from "next/og";

/**
 * The whitepaper's social card.
 *
 * A whitepaper link posted to X without an image renders as a bare URL — the exact opposite of what a
 * "flagship launch" post needs. This card is rendered at build time (static route, no request-path
 * satori work) and picked up automatically by the page's `openGraph` metadata.
 */
export const alt = "Prediction Arena — Whitepaper v1.0";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const OBSIDIAN = "#05080F";
const INK = "#E8EEF9";
const MUTED = "#8FA0BF";
const GOLD = "#FBBF24";
const CYAN = "#22D3EE";

/** Satori: every element is flex, every text node is one template literal. */
export default function WhitepaperCard() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: OBSIDIAN,
          backgroundImage:
            "radial-gradient(900px 520px at 12% -10%, rgba(251,191,36,0.16), rgba(5,8,15,0))",
          padding: "64px 72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                display: "flex",
                padding: "8px 14px",
                borderRadius: 999,
                border: "1px solid rgba(251,191,36,0.45)",
                color: GOLD,
                fontSize: 20,
                letterSpacing: 4,
              }}
            >
              WHITEPAPER · V1.0
            </div>
            <div style={{ display: "flex", color: MUTED, fontSize: 20, letterSpacing: 3 }}>
              PREDICTION ARENA
            </div>
          </div>
          <div style={{ display: "flex", color: MUTED, fontSize: 22 }}>predictionarena.online</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", color: INK, fontSize: 78, fontWeight: 700, lineHeight: 1.05 }}>
            232 markets. 19 sectors.
          </div>
          <div style={{ display: "flex", color: INK, fontSize: 78, fontWeight: 700, lineHeight: 1.05 }}>
            One on-chain venue.
          </div>
          <div style={{ display: "flex", color: MUTED, fontSize: 30, lineHeight: 1.35, maxWidth: 980 }}>
            24/7 AI-agent market generation · USDC escrow on Base · points replayed from chain history
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ display: "flex", color: GOLD, fontSize: 28 }}>42% genesis airdrop</div>
          <div style={{ display: "flex", color: CYAN, fontSize: 28 }}>4% fee loop</div>
          <div style={{ display: "flex", color: MUTED, fontSize: 28 }}>zero team allocation</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
