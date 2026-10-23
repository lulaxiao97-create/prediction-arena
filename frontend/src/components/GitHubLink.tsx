"use client";

import { cn } from "@/lib/format";

/** The single place the public repository URL lives. */
export const GITHUB_REPO = "https://github.com/lulaxiao97-create/prediction-arena";

/**
 * GitHub's mark (simple-icons path — the same one the footer brand strip uses).
 * Lucide has no GitHub glyph, and the octocat is not a generic icon: it is a brand.
 */
export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden focusable="false">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 0 1 3-.405c1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/**
 * Header-sized control: icon only, with the label revealed from `sm` up so the
 * top bar still fits a 390px viewport next to the wallet button.
 */
export function GitHubNavLink({ className }: { className?: string }) {
  return (
    <a
      href={GITHUB_REPO}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Prediction Arena on GitHub"
      title="Source on GitHub"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[12px] text-muted",
        "transition-colors hover:border-white/25 hover:bg-white/[0.06] hover:text-ink active:scale-[0.98]",
        className
      )}
    >
      <GitHubIcon className="size-3.5" />
      <span className="hidden md:inline">GitHub</span>
    </a>
  );
}

/** Docs-page variant: a full-width card row that reads as a call to action. */
export function GitHubDocsLink() {
  return (
    <a
      href={GITHUB_REPO}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5",
        "transition-colors hover:border-gold/35 hover:bg-gold/[0.07]"
      )}
    >
      <span className="grid size-8 place-items-center rounded-lg border border-white/10 bg-void/60 text-ink transition-colors group-hover:border-gold/40 group-hover:text-gold-bright">
        <GitHubIcon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11.5px] font-medium text-ink">Source on GitHub</span>
        <span className="mono block truncate text-[10px] text-muted/80">lulaxiao97-create/prediction-arena</span>
      </span>
    </a>
  );
}
