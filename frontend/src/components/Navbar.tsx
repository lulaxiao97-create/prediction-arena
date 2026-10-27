"use client";

import dynamic from "next/dynamic";

const PortfolioDrawer = dynamic(
  () => import("@/components/PortfolioDrawer").then((m) => m.PortfolioDrawer),
  { ssr: false },
);

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Activity, BarChart3, BookOpen, Briefcase, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/format";
import { CATEGORY_TABS, type MarketCategory } from "@/lib/categories";
import { useI18n } from "@/components/LocaleProvider";
import { LocaleSwitcher } from "@/components/LocaleProvider";
import { LogoLockup } from "@/components/Logo";
import { GitHubNavLink } from "@/components/GitHubLink";
import { SocialLinks } from "@/components/SocialLinks";
// Imported directly, not via `dynamic(..., { ssr: false })`: that left the header stuck on a
// loading skeleton whenever the lazily-loaded chunk did not resolve, and a connect button that
// sometimes never appears is worse than one render more of markup. RainbowKit's
// `ConnectButton.Custom` gates itself on `mounted`, so SSR is safe.
import { WalletButton } from "@/components/WalletButton";

export function Navbar({
  active = "all",
  onChange,
}: {
  active?: MarketCategory;
  onChange?: (category: MarketCategory) => void;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onMarkets = pathname === "/";
  const onDocs = pathname?.startsWith("/docs");

  // Keep the selected lane visible after a tap: the rail is ~1100px wide and a thumb that
  // scrolls to "Politics & Policy" should not have to hunt for it when it re-renders.
  // `block: "nearest"` keeps the sticky header from yanking the page down.
  useEffect(() => {
    if (!onMarkets) return;
    tabRefs.current[active]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [active, onMarkets]);

  const navItems = [
    { href: "/", label: t("nav.markets"), Icon: BarChart3, active: onMarkets },
    { href: "/docs", label: t("nav.docs"), Icon: BookOpen, active: onDocs && !pathname?.startsWith("/docs/security") },
    { href: "/docs/security", label: t("nav.security"), Icon: ShieldCheck, active: Boolean(pathname?.startsWith("/docs/security")) },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-void/85 backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] w-full max-w-[1400px] items-center gap-3 px-4 sm:px-6">
        {/* brand */}
        <Link href="/" className="group flex shrink-0 items-center" aria-label="Prediction Arena">
          <LogoLockup
            size={36}
            subtitle={t("nav.poweredBy")}
            subtitleClassName="hidden 2xl:block"
            wordmarkClassName="hidden sm:flex"
          />
        </Link>

        {/* primary navigation */}
        <nav className="ml-2 flex items-center gap-0.5" aria-label="Primary">
          {navItems.map(({ href, label, Icon, active: isActive }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-[12.5px] font-medium transition-colors",
                isActive ? "text-gold-bright" : "text-muted hover:text-ink"
              )}
            >
              <Icon className="size-3.5" />
              <span className="hidden sm:inline">{label}</span>
              {isActive && (
                <span className="absolute inset-x-2 -bottom-px h-px bg-gradient-to-r from-transparent via-gold to-transparent" />
              )}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <a
            href="https://basescan.org"
            target="_blank"
            rel="noopener noreferrer"
            title="Open Base explorer"
            className="hidden shrink-0 items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:border-profit/40 hover:text-ink lg:flex"
          >
            <Activity className="size-3 text-profit" />
            <span className="size-1.5 rounded-full bg-profit shadow-[0_0_8px_2px_rgba(16,185,129,0.5)]" />
            <span className="mono">{t("nav.baseMainnet")}</span>
          </a>
          <button
            onClick={() => setPortfolioOpen(true)}
            aria-haspopup="dialog"
            className="hidden shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[12px] text-muted transition-colors hover:border-gold/40 hover:bg-gold/8 hover:text-gold-bright active:scale-[0.98] sm:inline-flex"
          >
            <Briefcase className="size-3.5" />
            <span className="hidden xl:inline">{t("portfolio.title")}</span>
          </button>
          <SocialLinks className="hidden md:flex" />
          <GitHubNavLink />
          <LocaleSwitcher />
          <WalletButton />
        </div>
      </div>

      {/* category rail — markets page only */}
      {onMarkets && onChange && (
        <div className="relative">
          <div className="no-scrollbar flex w-full min-w-0 max-w-full snap-x scroll-px-4 gap-1 overflow-x-auto overscroll-x-contain border-t border-white/[0.04] px-4 py-2">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[tab.id] = el;
                }}
                onClick={() => onChange(tab.id)}
                aria-current={active === tab.id ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 shrink-0 snap-start touch-manipulation items-center whitespace-nowrap rounded-full border px-3.5 py-2 text-[12px] leading-none transition-colors active:scale-[0.98]",
                  active === tab.id
                    ? "border-gold/40 bg-gold/12 text-gold-bright"
                    : "border-white/8 text-muted hover:border-white/20 hover:text-ink"
                )}
              >
                <span className="mr-1">{tab.emoji}</span>
                {t(tab.i18n)}
              </button>
            ))}
          </div>
          {/* Scroll affordance: the 7 lanes overflow on every phone, and a hard cut at the
              viewport edge reads as "that's all there is". */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-px right-0 w-7 bg-gradient-to-l from-void via-void/70 to-transparent sm:hidden"
          />
        </div>
      )}

      <PortfolioDrawer open={portfolioOpen} onClose={() => setPortfolioOpen(false)} />
    </header>
  );
}
