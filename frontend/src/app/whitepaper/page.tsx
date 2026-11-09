import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { MarkdownDoc } from "@/components/MarkdownDoc";
import { WHITEPAPER_MARKDOWN } from "@/content/whitepaper";

/** The page paints its own <h1>; the markdown title would render as a duplicate line above it. */
const DOC_BODY = WHITEPAPER_MARKDOWN.replace(/^#\s+.*\n/, "");

/**
 * /whitepaper — the canonical document, rendered from docs/WHITEPAPER.md at build time.
 *
 * The page is static: the markdown is exported into src/content by scripts/export-whitepaper.ts, so
 * what a visitor reads here and what GitHub shows cannot drift, and no request ever parses a file.
 */
export const metadata: Metadata = {
  title: "Whitepaper v1.0 · Prediction Arena",
  description:
    "235 markets across 19 sectors, 100% on-chain settlement in USDC on Base, a points ledger replayed from chain history, and a 1B-supply token with a 42% genesis airdrop.",
  openGraph: {
    title: "Prediction Arena — Whitepaper v1.0",
    description: "24/7 autonomous prediction markets on Base. 235 markets · 19 sectors · USDC escrow.",
    type: "article",
  },
};

export default function WhitepaperPage() {
  return (
    <main className="mx-auto w-full max-w-[900px] px-4 pb-16 pt-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-[12px] text-muted transition-colors hover:border-gold/40 hover:text-ink"
        >
          <ArrowLeft className="size-3.5" /> Markets
        </Link>
        <a
          href="/WHITEPAPER.md"
          download
          className="inline-flex items-center gap-1.5 rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 text-[12px] font-medium text-gold-bright transition-colors hover:bg-gold/15"
        >
          <Download className="size-3.5" /> Download .md
        </a>
      </div>

      <article className="glass rounded-3xl p-5 sm:p-8">
        <p className="mono text-[9.5px] uppercase tracking-[0.28em] text-gold/80">Whitepaper · v1.0</p>
        <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-tight text-ink sm:text-[32px]">
          Prediction Arena
        </h1>
        <p className="mt-2 max-w-[62ch] text-[12.5px] leading-relaxed text-muted">
          24/7 autonomous prediction markets on Base. 235 markets · 19 sectors · USDC escrow · a points
          ledger you can rebuild from chain history.
        </p>
        <div className="mt-6">
          <MarkdownDoc markdown={DOC_BODY} />
        </div>
      </article>
    </main>
  );
}
