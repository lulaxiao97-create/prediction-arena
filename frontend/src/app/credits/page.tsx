import type { Metadata } from "next";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ArrowLeft } from "lucide-react";

/**
 * Image credits.
 *
 * Every market cover is a local file under /covers; the ones that are not CC0 (the esports arena
 * and the European Parliament hemicycle) are CC BY-SA and therefore need attribution somewhere a
 * visitor can reach. This page is that somewhere — it is linked from the footer and rendered from
 * the same CREDITS.json the asset pipeline writes, so it cannot drift from the shipped files.
 *
 * Rendered on the server at build time: no client JS, no manifest fetch.
 */
export const metadata: Metadata = {
  title: "Image credits",
  description: "Photography used behind Prediction Arena market covers, with licence and source.",
};

type Credit = { file: string; subject: string; license: string; source: string; credit?: string };
type Credits = { note?: string; images: Credit[] };

export default async function CreditsPage() {
  let data: Credits = { images: [] };
  try {
    data = JSON.parse(await readFile(path.join(process.cwd(), "public", "covers", "CREDITS.json"), "utf8")) as Credits;
  } catch {
    /* an empty list still renders an honest page rather than a 500 */
  }

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 py-10 sm:px-6">
      <Link href="/" className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11.5px] text-muted transition-colors hover:text-ink">
        <ArrowLeft className="size-3.5" /> Back to markets
      </Link>

      <p className="mono mt-6 text-[9.5px] uppercase tracking-[0.28em] text-gold/80">LEGAL · ATTRIBUTION</p>
      <h1 className="mt-1 text-[26px] font-bold tracking-tight text-ink">Image credits</h1>
      <p className="mt-2 max-w-[62ch] text-[12.5px] leading-relaxed text-muted">
        {data.note ??
          "Cover photography shipped with the app. Files are downscaled and colour-graded for the dark UI; the originals are unchanged."}
      </p>

      <ul className="mt-6 flex flex-col gap-2">
        {data.images.map((img) => (
          <li key={img.file} className="glass flex flex-col gap-1 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-medium text-ink">{img.subject}</p>
              <p className="mono mt-0.5 truncate text-[10px] text-muted/70">
                /covers/{img.file}
                {img.credit ? ` · ${img.credit}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="mono rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-muted">
                {img.license}
              </span>
              <a
                href={img.source}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10.5px] text-muted/70 transition-colors hover:text-gold-bright"
              >
                source
              </a>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-[10.5px] leading-relaxed text-muted/50">
        Token marks are typographic (₿, Ξ, ◎) and are not the registered logos of their issuers. Covers
        are illustrative; they are not an endorsement by any league, venue, government body or lab
        shown.
      </p>
    </main>
  );
}
