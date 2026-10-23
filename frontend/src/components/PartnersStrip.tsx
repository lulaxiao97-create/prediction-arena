"use client";

import { ArrowUpRight, Boxes, Code2, Cpu, ScanSearch, ShieldCheck } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { cn } from "@/lib/format";

type Partner = {
  name: string;
  role: string;
  href: string;
  Icon: typeof Boxes;
  tone: string;
};

const PARTNERS: Partner[] = [
  {
    name: "Base Mainnet",
    role: "Deployment Network",
    href: "https://base.org",
    Icon: Boxes,
    tone: "text-[#0052FF] border-[#0052FF]/30 bg-[#0052FF]/[0.07]",
  },
  {
    name: "Vigilo Security Agent",
    role: "Smart Contract Auditor",
    href: "https://basescan.org",
    Icon: ShieldCheck,
    tone: "text-emerald-300 border-emerald-400/30 bg-emerald-400/[0.07]",
  },
  {
    name: "DeepSeek · Hermes Agent",
    role: "AI Debate & Intelligence Engine",
    href: "https://nousresearch.com",
    Icon: Cpu,
    tone: "text-violet-300 border-violet-400/30 bg-violet-400/[0.07]",
  },
  {
    name: "Bun & Hardhat",
    role: "High-Performance Build Engine",
    href: "https://bun.sh",
    Icon: Code2,
    tone: "text-amber-300 border-amber-400/30 bg-amber-400/[0.07]",
  },
  {
    name: "Basescan",
    role: "Verified Contract Code",
    href: "https://basescan.org",
    Icon: ScanSearch,
    tone: "text-sky-300 border-sky-400/30 bg-sky-400/[0.07]",
  },
];

export function PartnersStrip() {
  const { t } = useI18n();

  return (
    <section className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="mono text-[9.5px] uppercase tracking-[0.28em] text-gold/80">ECOSYSTEM</p>
          <h2 className="mt-1 text-[15px] font-semibold tracking-tight text-ink sm:text-[17px]">{t("partners.title")}</h2>
        </div>
        <p className="text-[11px] text-muted">{t("partners.subtitle")}</p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {PARTNERS.map(({ name, role, href, Icon, tone }) => (
          <a
            key={name}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "card-edge group flex flex-col gap-2 rounded-xl border p-3 transition-all duration-200",
              "hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-18px_rgba(245,158,11,0.6)]",
              "border-white/8 bg-white/[0.02]"
            )}
          >
            <div className="flex items-center justify-between">
              <span className={cn("grid size-7 place-items-center rounded-lg border", tone)}>
                <Icon className="size-3.5" />
              </span>
              <ArrowUpRight className="size-3 text-muted/40 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-gold-bright" />
            </div>
            <div>
              <p className="truncate text-[11.5px] font-semibold text-ink">{name}</p>
              <p className="mt-0.5 line-clamp-2 text-[9.5px] leading-snug text-muted/70">{role}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
