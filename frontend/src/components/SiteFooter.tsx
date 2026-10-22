"use client";

import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { ARENA_ADDRESS } from "@/lib/docs";
import { explorerAddress, shortAddr } from "@/lib/format";

/** Brand marks (lucide dropped them) — official simple-icons paths. */
function BrandIcon({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const PATHS = {
  github:
    "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 0 1 3-.405c1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  discord:
    "M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03M8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418m7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418",
  telegram:
    "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
};

const COMMUNITY = [
  { label: "GitHub", href: "https://github.com", path: PATHS.github },
  { label: "X / Twitter", href: "https://x.com", path: PATHS.x },
  { label: "Discord", href: "https://discord.com", path: PATHS.discord },
  { label: "Telegram", href: "https://telegram.org", path: PATHS.telegram },
];

export function SiteFooter() {
  const { t } = useI18n();

  return (
    <footer className="border-t border-white/[0.07] bg-void/70">
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr_1.6fr_0.8fr]">
          {/* brand */}
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg border border-gold/40 bg-gradient-to-br from-gold-bright/25 to-gold/5">
                <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                  <path d="M12 2.5 22 12l-10 9.5L2 12 12 2.5Z" fill="#FBBF24" opacity="0.9" />
                  <path d="M12 7.2 17.2 12 12 16.8 6.8 12 12 7.2Z" fill="#0A0A0C" />
                </svg>
              </span>
              <div>
                <p className="gold-text text-[13.5px] font-semibold tracking-[0.04em]">Prediction Arena</p>
                <p className="text-[9.5px] text-muted/80">{t("nav.poweredBy")}</p>
              </div>
            </div>
            <p className="mt-3 max-w-xs text-[11px] leading-relaxed text-muted">{t("footer.tagline")}</p>
            <p className="mt-3 text-[10.5px] text-muted/60">{t("footer.copyright")}</p>
          </div>

          {/* quick links */}
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted/70">{t("footer.quickLinks")}</p>
            <ul className="mt-2.5 space-y-1.5 text-[11.5px]">
              <li>
                <Link href="/" className="text-muted transition-colors hover:text-ink">
                  {t("nav.markets")}
                </Link>
              </li>
              <li>
                <Link href="/docs" className="text-muted transition-colors hover:text-ink">
                  {t("nav.docs")}
                </Link>
              </li>
              <li>
                <Link href="/docs/security" className="text-muted transition-colors hover:text-ink">
                  {t("nav.security")}
                </Link>
              </li>
              <li>
                <a
                  href={explorerAddress(ARENA_ADDRESS)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-muted transition-colors hover:text-gold-bright"
                >
                  {t("footer.contract")} {shortAddr(ARENA_ADDRESS, 4)}
                  <ArrowUpRight className="size-3" />
                </a>
              </li>
            </ul>
          </div>

          {/* legal / risk */}
          <div>
            <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-muted/70">
              <ShieldCheck className="size-3" /> {t("footer.risk")}
            </p>
            <p className="mt-2.5 max-w-sm text-[10.5px] leading-relaxed text-muted/80">{t("footer.riskBody")}</p>
            <p className="mt-2 text-[10px] text-muted/50">{t("footer.legal")}: MIT-licensed contracts · no custodian</p>
          </div>

          {/* community */}
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted/70">{t("footer.community")}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {COMMUNITY.map(({ label, href, path }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={label}
                  className="grid size-8 place-items-center rounded-lg border border-white/8 bg-white/[0.02] text-muted transition-all hover:-translate-y-0.5 hover:border-gold/40 hover:text-gold-bright"
                >
                  <BrandIcon d={path} className="size-3.5" />
                </a>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-muted/50">{t("footer.builtBy")}</p>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-white/[0.06] pt-4 text-[10px] text-muted/50 sm:flex-row sm:items-center sm:justify-between">
          <span>{t("footer.copyright")} · All rights reserved.</span>
          <span className="mono">
            {ARENA_ADDRESS.slice(0, 10)}…{ARENA_ADDRESS.slice(-6)} · Base Mainnet 8453
          </span>
        </div>
      </div>
    </footer>
  );
}
