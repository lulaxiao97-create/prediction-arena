"use client";

import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { Logo } from "@/components/Logo";
import { ARENA_ADDRESS } from "@/lib/docs";
import { explorerAddress, shortAddr } from "@/lib/format";
import { SOCIAL } from "@/lib/social";
import { BRAND_PATHS, BrandIcon } from "@/lib/brand-icons";

const COMMUNITY = [
  { label: SOCIAL.github.label, href: SOCIAL.github.url, handle: null, path: BRAND_PATHS.github },
  { label: SOCIAL.x.label, href: SOCIAL.x.url, handle: SOCIAL.x.handle, path: BRAND_PATHS.x },
  {
    label: SOCIAL.telegram.label,
    href: SOCIAL.telegram.url,
    handle: SOCIAL.telegram.handle,
    path: BRAND_PATHS.telegram,
  },
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
              <Logo size={32} />
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
                  rel="noopener noreferrer"
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
            <p className="mt-2 text-[10px] text-muted/50">{t("footer.license")}</p>
          </div>

          {/* community */}
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted/70">{t("footer.community")}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {COMMUNITY.map(({ label, href, handle, path }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={handle ? `${label} ${handle}` : label}
                  title={handle ? `${label} · ${handle}` : label}
                  className="grid size-8 place-items-center rounded-lg border border-white/8 bg-white/[0.02] text-muted transition-all hover:-translate-y-0.5 hover:border-gold/40 hover:text-gold-bright"
                >
                  <BrandIcon d={path} className="size-3.5" />
                </a>
              ))}
            </div>
            <ul className="mt-3 space-y-1 text-[10.5px]">
              <li>
                <a
                  href={SOCIAL.x.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mono text-muted/70 transition-colors hover:text-gold-bright"
                >
                  {SOCIAL.x.handle} <span className="text-muted/40">on X</span>
                </a>
              </li>
              <li>
                <a
                  href={SOCIAL.telegram.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mono text-muted/70 transition-colors hover:text-gold-bright"
                >
                  {SOCIAL.telegram.handle} <span className="text-muted/40">on Telegram</span>
                </a>
              </li>
            </ul>
            <p className="mt-3 text-[10px] text-muted/50">{t("footer.builtBy")}</p>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-white/[0.06] pt-4 text-[10px] text-muted/50 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {t("footer.copyright")} · {t("footer.rights")}{" "}
            <Link href="/credits" className="text-muted/70 underline-offset-2 transition-colors hover:text-gold-bright hover:underline">
              Image credits
            </Link>
          </span>
          <span className="mono">
            {ARENA_ADDRESS.slice(0, 10)}…{ARENA_ADDRESS.slice(-6)} · Base Mainnet 8453
          </span>
        </div>
      </div>
    </footer>
  );
}
