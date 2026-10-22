"use client";

import { ArrowUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/format";
import { useI18n } from "@/components/LocaleProvider";

export type SortKey = "volume" | "liquidity" | "ending" | "newest";

export const SORT_OPTIONS: { id: SortKey; i18n: string }[] = [
  { id: "volume", i18n: "sort.volume" },
  { id: "liquidity", i18n: "sort.liquidity" },
  { id: "ending", i18n: "sort.ending" },
  { id: "newest", i18n: "sort.newest" },
];

export function SearchSortBar({
  query,
  onQuery,
  sort,
  onSort,
  count,
}: {
  query: string;
  onQuery: (value: string) => void;
  sort: SortKey;
  onSort: (value: SortKey) => void;
  count: number;
}) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted/60" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("nav.search")}
          className="w-full rounded-xl border border-white/8 bg-white/[0.03] py-2.5 pl-9 pr-9 text-[12.5px] text-ink outline-none transition-colors placeholder:text-muted/50 focus:border-gold/40"
        />
        {query && (
          <button
            onClick={() => onQuery("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1 text-[10.5px] uppercase tracking-[0.1em] text-muted/60 sm:flex">
          <ArrowUpDown className="size-3" />
          {t("sort.label")}
        </span>
        <div className="flex gap-1 rounded-xl border border-white/8 bg-white/[0.03] p-0.5">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.id}
              onClick={() => onSort(option.id)}
              aria-pressed={sort === option.id}
              className={cn(
                "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11.5px] transition-colors",
                sort === option.id ? "bg-gold/15 text-gold-bright" : "text-muted hover:text-ink"
              )}
            >
              {t(option.i18n)}
            </button>
          ))}
        </div>
        <span className="mono whitespace-nowrap text-[11px] text-muted/70">
          {count} {t("sort.results")}
        </span>
      </div>
    </div>
  );
}
