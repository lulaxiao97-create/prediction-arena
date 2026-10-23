"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Activity, BarChart3, BookOpen, Briefcase, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/format";
import { CATEGORY_TABS, type MarketCategory } from "@/lib/categories";
import { useI18n } from "@/components/LocaleProvider";
import { LocaleSwitcher } from "@/components/LocaleProvider";
import { PortfolioDrawer } from "@/components/PortfolioDrawer";
import { LogoLockup } from "@/components/Logo";
import { GitHubNavLink } from "@/components/GitHubLink";

const WalletButton = dynamic(() => import("@/components/WalletButton").then((m) => m.WalletButton), {
  ssr: false,
  loading: () => (
    <span className="inline-flex h-9 w-28 animate-pulse rounded-xl border border-gold/20 bg-gold/10" />
  ),
});

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
  const onMarkets = pathname === "/";
  const onDocs = pathname?.startsWith("/docs");

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
          <GitHubNavLink />
          <LocaleSwitcher />
          <WalletButton />
        </div>
      </div>

      {/* category rail — markets page only */}
      {onMarkets && onChange && (
        <div className="no-scrollbar flex w-full min-w-0 max-w-full gap-1 overflow-x-auto overscroll-x-contain border-t border-white/[0.04] px-4 py-2">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              aria-current={active === tab.id ? "page" : undefined}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11.5px] transition-colors active:scale-[0.98]",
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
      )}

      <PortfolioDrawer open={portfolioOpen} onClose={() => setPortfolioOpen(false)} />
    </header>
  );
}
