import Link from "next/link";
import { BookOpen, Compass } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { SiteFooter } from "@/components/SiteFooter";

export default function NotFound() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="relative flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <p className="mono text-[11px] uppercase tracking-[0.3em] text-gold/70">404 · Not Found</p>
        <h1 className="mt-3 text-[32px] font-bold leading-tight text-ink sm:text-[42px]">
          This page left the arena.
        </h1>
        <p className="mt-3 max-w-md text-[12.5px] leading-relaxed text-muted">
          The market or document you are looking for does not exist, has been settled, or was never
          opened on-chain. Every pool id emitted by the contract is public — check Basescan if you
          followed a link from somewhere else.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <Link href="/" className="btn-gold text-[13px]">
            <Compass className="size-4" /> Browse markets
          </Link>
          <Link
            href="/docs"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[13px] text-muted transition-colors hover:border-gold/40 hover:text-ink"
          >
            <BookOpen className="size-4" /> Read the docs
          </Link>
        </div>
        <p className="mono mt-8 text-[10px] text-muted/40">Predicted, not found. That is the joke.</p>
      </div>
      <SiteFooter />
    </div>
  );
}
