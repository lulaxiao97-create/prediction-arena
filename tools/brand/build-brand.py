#!/usr/bin/env python3
"""Prediction Arena brand asset generator — PA-MARK-1.0.

Emits the official mark as SVG plus the two raster assets GitHub consumes
(repository avatar, social preview). Rasterisation is done by sharp (already in
frontend/node_modules) because it bundles librsvg.

    python3 tools/brand/build-brand.py
"""
from __future__ import annotations

import pathlib
import subprocess
import textwrap

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "branding"
OUT.mkdir(parents=True, exist_ok=True)

OBSIDIAN = "#05080F"
OBSIDIAN_2 = "#0A1020"
GOLD_A, GOLD_B, GOLD_C = "#FEF3C7", "#FBBF24", "#B45309"
CYAN_A, CYAN_B = "#22D3EE", "#3B82F6"
INK = "#E8EEF9"
MUTED = "#8FA0BF"

# ---------------------------------------------------------------- the mark --
# Shield plate, two opposing arrows (the two sides of a market), and the
# diamond at the crossing point (the resolution). Identical geometry to the
# app icon so the favicon, PWA icon and repository avatar read as one system.
def mark(scale: float = 1.0) -> str:
    return f'''
<g transform="scale({scale})">
  <path d="M24 2.6 42.4 9.6v13.9c0 10.2-7.4 18.1-18.4 21.9C13 41.6 5.6 33.7 5.6 23.5V9.6L24 2.6Z"
        fill="url(#plate)" stroke="url(#gold)" stroke-width="1.7" stroke-linejoin="round"/>
  <path d="M17.4 30.6 30.6 17.4" stroke="url(#gold)" stroke-width="2.5" stroke-linecap="round" fill="none"/>
  <path d="M30.9 17.1 24.5 18.9l4.9 4.9 1.5-6.7Z" fill="url(#gold)"/>
  <path d="M30.6 30.6 17.4 17.4" stroke="url(#cyan)" stroke-width="2.5" stroke-linecap="round" fill="none"/>
  <path d="M17.1 17.1 23.5 18.9l-4.9 4.9-1.5-6.7Z" fill="url(#cyan)"/>
  <path d="M24 20.4 27.6 24 24 27.6 20.4 24 24 20.4Z" fill="{OBSIDIAN}" stroke="url(#cyan)" stroke-width="1.2" stroke-linejoin="round"/>
  <circle cx="24" cy="24" r="1.15" fill="#ECFEFF"/>
</g>'''


DEFS = f'''<defs>
  <linearGradient id="gold" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="{GOLD_A}"/><stop offset="42%" stop-color="{GOLD_B}"/><stop offset="100%" stop-color="{GOLD_C}"/>
  </linearGradient>
  <linearGradient id="cyan" x1="10" y1="38" x2="38" y2="10" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="{CYAN_A}"/><stop offset="60%" stop-color="#38BDF8"/><stop offset="100%" stop-color="{CYAN_B}"/>
  </linearGradient>
  <linearGradient id="plate" x1="24" y1="2" x2="24" y2="46" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="#16161C"/><stop offset="100%" stop-color="#0A0A0D"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.42" r="0.62">
    <stop offset="0%" stop-color="#1B4B6B" stop-opacity="0.85"/>
    <stop offset="55%" stop-color="#0C1A2C" stop-opacity="0.9"/>
    <stop offset="100%" stop-color="{OBSIDIAN}" stop-opacity="1"/>
  </radialGradient>
  <linearGradient id="hair" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="{GOLD_B}" stop-opacity="0"/>
    <stop offset="45%" stop-color="{GOLD_B}" stop-opacity="0.9"/>
    <stop offset="100%" stop-color="{CYAN_A}" stop-opacity="0"/>
  </linearGradient>
  <!-- objectBoundingBox gradients: independent of the host canvas coordinate space -->
  <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="{GOLD_B}" stop-opacity="0"/>
    <stop offset="50%" stop-color="{GOLD_B}" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="{CYAN_A}" stop-opacity="0.35"/>
  </linearGradient>
  <linearGradient id="goldH" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="{GOLD_C}"/><stop offset="55%" stop-color="{GOLD_B}"/><stop offset="100%" stop-color="#F59E0B"/>
  </linearGradient>
  <linearGradient id="cyanH" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="{CYAN_B}"/><stop offset="60%" stop-color="#38BDF8"/><stop offset="100%" stop-color="{CYAN_A}"/>
  </linearGradient>
  <radialGradient id="glowC" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#124C6E" stop-opacity="0.75"/>
    <stop offset="55%" stop-color="#0B2C44" stop-opacity="0.35"/>
    <stop offset="100%" stop-color="#05080F" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="glowG" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#7A5410" stop-opacity="0.55"/>
    <stop offset="60%" stop-color="#3A2908" stop-opacity="0.25"/>
    <stop offset="100%" stop-color="#05080F" stop-opacity="0"/>
  </radialGradient>
</defs>'''


def avatar_svg() -> str:
    """1024x1024, repo avatar. GitHub crops to a circle: keep the mark inside 72%."""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
{DEFS}
  <rect width="1024" height="1024" fill="{OBSIDIAN}"/>
  <rect width="1024" height="1024" fill="url(#glowC)"/>
  <g opacity="0.10" stroke="{INK}" stroke-width="1">
    {''.join(f'<path d="M{x} 0V1024"/>' for x in range(64, 1024, 64))}
    {''.join(f'<path d="M0 {y}H1024"/>' for y in range(64, 1024, 64))}
  </g>
  <circle cx="512" cy="512" r="360" fill="#060B14" opacity="0.55"/>
  <circle cx="512" cy="512" r="360" fill="none" stroke="url(#ring)" stroke-width="2"/>
  <g transform="translate(512 512) scale(14.6) translate(-24 -24)">{mark()}</g>
</svg>'''


def wordmark(x: int, y: int) -> str:
    return f'''
  <text x="{x}" y="{y}" font-family="Segoe UI Semibold, Segoe UI" font-size="46" font-weight="600"
        letter-spacing="1.2" fill="{INK}">PREDICTION ARENA</text>'''


def social_svg() -> str:
    """1280x640 social preview (GitHub recommends 1280x640, 2:1)."""
    bars = [
        # (label, pct, colour)
        ("YES", 0.62, "url(#goldH)"),
        ("NO", 0.38, "url(#cyanH)"),
    ]
    bar_nodes = []
    top = 250
    for i, (label, pct, colour) in enumerate(bars):
        y = top + i * 132
        width = int(520 * pct)
        bar_nodes.append(f'''
  <text x="700" y="{y - 14}" font-family="Segoe UI Semibold, Segoe UI" font-size="17" letter-spacing="2.6" fill="{MUTED}">{label}</text>
  <text x="1220" y="{y - 14}" text-anchor="end" font-family="Consolas, monospace" font-size="17" fill="{INK}">{int(pct * 100)}%</text>
  <rect x="700" y="{y}" width="520" height="26" rx="13" fill="#111A2B"/>
  <rect x="700" y="{y}" width="{width}" height="26" rx="13" fill="{colour}" opacity="0.92"/>
  <circle cx="{700 + width}" cy="{y + 13}" r="5" fill="#FFFFFF" opacity="0.95"/>''')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
{DEFS}
  <rect width="1280" height="640" fill="{OBSIDIAN}"/>
  <ellipse cx="300" cy="80" rx="620" ry="440" fill="url(#glowC)"/>
  <ellipse cx="1150" cy="620" rx="560" ry="380" fill="url(#glowG)"/>
  <g opacity="0.075" stroke="{INK}" stroke-width="1">
    {''.join(f'<path d="M{x} 0V640"/>' for x in range(40, 1280, 40))}
    {''.join(f'<path d="M0 {y}H1280"/>' for y in range(40, 640, 40))}
  </g>

  <g transform="translate(96 132) scale(1.85)">{mark()}</g>
{wordmark(96, 300)}
  <text x="98" y="352" font-family="Segoe UI, Arial" font-size="21" fill="{MUTED}">
    Decentralized prediction markets argued by AI agents.
  </text>
  <text x="98" y="384" font-family="Segoe UI, Arial" font-size="21" fill="{MUTED}">
    Settled in native USDC on Base. Auditable by anyone.
  </text>

  <g>
    {''.join(bar_nodes)}
  </g>
  <text x="1220" y="500" text-anchor="end" font-family="Segoe UI, Arial" font-size="16" fill="#6E7F9B">
    Implied probability · AI agents argue both sides · resolved on-chain
  </text>

  <g font-family="Segoe UI Semibold, Segoe UI" font-size="15" letter-spacing="2">
    <rect x="96" y="452" width="176" height="38" rx="19" fill="#101A2C" stroke="#1E3350"/>
    <text x="184" y="477" text-anchor="middle" fill="{GOLD_B}">BASE MAINNET</text>
    <rect x="288" y="452" width="146" height="38" rx="19" fill="#101A2C" stroke="#1E3350"/>
    <text x="361" y="477" text-anchor="middle" fill="{CYAN_A}">V2 · LIVE</text>
    <rect x="450" y="452" width="196" height="38" rx="19" fill="#101A2C" stroke="#1E3350"/>
    <text x="548" y="477" text-anchor="middle" fill="{INK}">NON-CUSTODIAL</text>
  </g>

  <g>
    <rect x="96" y="524" width="640" height="46" rx="10" fill="#0A1220" stroke="#1A2A44"/>
    <text x="118" y="553" font-family="Consolas, monospace" font-size="19" fill="#9FB2D0">0x108D5CDC23123Fa97929Cf197151fb9dc29A5D93</text>
  </g>

  <path d="M96 604H1184" stroke="url(#hair)" stroke-width="1.5" opacity="0.55"/>
  <text x="96" y="628" font-family="Segoe UI Semibold, Segoe UI" font-size="13" letter-spacing="3.4" fill="#5C6C87">
    PREDICTION ARENA · PA-MARK-1.0
  </text>
  <text x="1184" y="628" text-anchor="end" font-family="Consolas, monospace" font-size="13" fill="#5C6C87">
    USDC · ERC-20 · 8453
  </text>
</svg>'''


def write(name: str, content: str) -> pathlib.Path:
    p = OUT / name
    p.write_text(content, encoding="utf-8")
    return p


def main() -> None:
    write("pa-mark.svg", f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 48 48">{DEFS}{mark()}</svg>\n')
    write("avatar.svg", avatar_svg())
    write("social-preview.svg", social_svg())

    # Rasterise with sharp: the only renderer on this box that has librsvg + fontconfig wired.
    js = textwrap.dedent(f'''
        const sharp = require({str(ROOT / "frontend" / "node_modules" / "sharp")!r});
        const fs = require("fs");
        const out = {str(OUT)!r};
        (async () => {{
          await sharp(out + "/avatar.svg").resize(1024, 1024).png({{ compressionLevel: 9 }}).toFile(out + "/avatar-1024.png");
          await sharp(out + "/social-preview.svg").png({{ compressionLevel: 9 }}).toFile(out + "/social-preview-1280x640.png");
          console.log("ok");
        }})().catch((e) => {{ console.error(e); process.exit(1); }});
    ''')
    script = pathlib.Path("/tmp/render-brand.cjs")
    script.write_text(js)
    subprocess.run(["node", str(script)], check=True)

    for f in ("avatar-1024.png", "social-preview-1280x640.png"):
        size = (OUT / f).stat().st_size
        print(f"{f}: {size/1024:.1f} KiB")


if __name__ == "__main__":
    main()
