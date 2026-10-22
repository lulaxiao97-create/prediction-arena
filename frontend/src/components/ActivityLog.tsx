"use client";

import { ArrowDownRight, ArrowUpRight, Clock3 } from "lucide-react";
import type { ActivityRow } from "@/lib/markets";
import { cn, formatUsdc, shortAddr } from "@/lib/format";
import { useI18n } from "@/components/LocaleProvider";

function relative(minutes: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (minutes < 1) return t("activity.now");
  if (minutes < 60) return `${minutes}${t("activity.min")}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}${t("activity.hour")}`;
  return `${Math.round(hours / 24)}${t("activity.day")}`;
}

export function ActivityLog({ rows, emptyLabel }: { rows: ActivityRow[]; emptyLabel?: string }) {
  const { t } = useI18n();

  if (rows.length === 0) {
    return <p className="px-3 py-6 text-center text-[11.5px] text-muted">{emptyLabel ?? t("detail.noActivity")}</p>;
  }

  return (
    <ul className="divide-y divide-white/[0.05]">
      {rows.map((row) => {
        const isYes = row.outcome === 0;
        return (
          <li key={row.id} className="flex items-center gap-3 px-3 py-2 text-[11.5px]">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-md border",
                row.kind === "buy" ? "border-profit/25 bg-profit/10 text-profit" : "border-loss/25 bg-loss/10 text-loss"
              )}
            >
              {row.kind === "buy" ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            </span>
            <span className="mono text-muted">{shortAddr(row.wallet, 3)}</span>
            <span className="text-muted/70">
              {row.kind === "buy" ? t("activity.bought") : t("activity.sold")}{" "}
              <span className={cn("font-semibold", isYes ? "text-profit" : "text-loss")}>
                {isYes ? t("activity.yes") : t("activity.no")}
              </span>
            </span>
            <span className="mono ml-auto font-semibold text-ink">${formatUsdc(BigInt(Math.round(row.amount * 1e6)))}</span>
            <span className="inline-flex w-14 items-center justify-end gap-1 text-[10px] text-muted/55">
              <Clock3 className="size-2.5" />
              {relative(row.minutesAgo, t)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
