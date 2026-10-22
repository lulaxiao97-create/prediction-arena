"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, Languages } from "lucide-react";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_STORAGE_KEY,
  translate,
  type Locale,
} from "@/lib/i18n";
import { cn } from "@/lib/format";

type I18nValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (path: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

function isLocale(value: string | null): value is Locale {
  return Boolean(value) && LOCALES.some((l) => l.id === value);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Always start from the default so prerender and the first client render agree.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isLocale(saved)) setLocaleState(saved);
    } catch {
      /* storage blocked */
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* storage blocked */
    }
    if (typeof document !== "undefined") document.documentElement.lang = next;
  }, []);

  const t = useCallback(
    (path: string, vars?: Record<string, string | number>) => translate(locale, path, vars),
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Safe fallback: components rendered outside the provider (e.g. isolated tests) use English.
    return { locale: DEFAULT_LOCALE, setLocale: () => {}, t: (p, v) => translate(DEFAULT_LOCALE, p, v) };
  }
  return ctx;
}

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const active = LOCALES.find((l) => l.id === locale) ?? LOCALES[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest("[data-locale-switcher]")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" data-locale-switcher>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("nav.language")}
        className="inline-flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2 text-[12px] text-muted transition-colors hover:border-white/20 hover:text-ink"
      >
        <Languages className="size-3.5" />
        <span className="text-[13px] leading-none">{active.flag}</span>
        {!compact && <span className="mono hidden sm:inline">{active.short}</span>}
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="glass absolute right-0 top-[calc(100%+6px)] z-50 w-44 overflow-hidden rounded-xl border border-white/10 p-1 shadow-2xl"
        >
          {LOCALES.map((item) => (
            <li key={item.id}>
              <button
                role="option"
                aria-selected={item.id === locale}
                onClick={() => {
                  setLocale(item.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors",
                  item.id === locale ? "bg-gold/12 text-gold-bright" : "text-muted hover:bg-white/5 hover:text-ink"
                )}
              >
                <span className="text-[14px] leading-none">{item.flag}</span>
                <span className="flex-1">{item.label}</span>
                <span className="mono text-[10px] text-muted/60">{item.short}</span>
                {item.id === locale && <Check className="size-3" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
