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
        <Link href="/" className="group flex shrink-0 items-center gap-2.5" aria-label="Prediction Arena">
          <span className="relative grid size-9 place-items-center rounded-xl border border-gold/40 bg-gradient-to-br from-gold-bright/25 to-gold/5 shadow-[0_0_24px_-6px_rgba(245,158,11,0.6)]">
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
              <defs>
                <linearGradient id="arena-gold" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#FDE68A" />
                  <stop offset="55%" stopColor="#FBBF24" />
                  <stop offset="100%" stopColor="#D97706" />
                </linearGradient>
              </defs>
              <path d="M12 2.5 22 12l-10 9.5L2 12 12 2.5Z" fill="url(#arena-gold)" opacity="0.92" />
              <path d="M12 7.2 17.2 12 12 16.8 6.8 12 12 7.2Z" fill="#0A0A0C" />
            </svg>
          </span>
          <span className="flex flex-col leading-none">
            <span className="gold-text text-[15px] font-semibold tracking-[0.04em]">Prediction Arena</span>
            <span className="mt-1 hidden text-[9px] font-medium tracking-[0.02em] text-muted/80 2xl:block">
              {t("nav.poweredBy")}
            </span>
          </span>
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

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <a
            href="https://basescan.org"
            target="_blank"
            rel="noreferrer"
            title="Open Base explorer"
            className="hidden items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:border-profit/40 hover:text-ink lg:flex"
          >
            <Activity className="size-3 text-profit" />
            <span className="size-1.5 rounded-full bg-profit shadow-[0_0_8px_2px_rgba(16,185,129,0.5)]" />
            <span className="mono">{t("nav.baseMainnet")}</span>
          </a>
          <button
            onClick={() => setPortfolioOpen(true)}
            aria-haspopup="dialog"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[12px] text-muted transition-colors hover:border-gold/40 hover:bg-gold/8 hover:text-gold-bright active:scale-[0.98]"
          >
            <Briefcase className="size-3.5" />
            <span className="hidden xl:inline">{t("portfolio.title")}</span>
          </button>
          <LocaleSwitcher />
          <WalletButton />
        </div>
      </div>

      {/* category rail — markets page only */}
      {onMarkets && onChange && (
        <div className="no-scrollbar flex gap-1 overflow-x-auto border-t border-white/[0.04] px-4 py-2">
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
