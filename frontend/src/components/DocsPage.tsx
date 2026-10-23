"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Info,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { SiteFooter } from "@/components/SiteFooter";
import { useI18n } from "@/components/LocaleProvider";
import { useToast } from "@/components/Toast";
import {
  ARENA_ADDRESS,
  DOCS,
  DOC_SECTIONS,
  docsBySection,
  findDoc,
  neighbours,
  type DocBlock,
  type DocLang,
} from "@/lib/docs";
import { cn, explorerAddress } from "@/lib/format";
import { GITHUB_REPO, GitHubDocsLink, GitHubIcon } from "@/components/GitHubLink";

export function DocsPage({ slug }: { slug?: string[] }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const doc = findDoc(slug);
  const lang: DocLang = locale === "zh-TW" ? "zh-TW" : "en";
  const [copied, setCopied] = useState<string | null>(null);

  const { prev, next } = useMemo(() => (doc ? neighbours(doc.slug) : {}), [doc]);
  const headings = useMemo(() => (doc ? doc.body[lang].filter((b) => b.kind === "h2") : []), [doc, lang]);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied(null), 1800);
      toast.push({ kind: "success", title: t("docs.copied"), description: value });
    } catch {
      toast.push({ kind: "error", title: t("toast.failed"), description: "Clipboard not available" });
    }
  }

  if (!doc) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-4 py-24 text-center sm:px-6">
          <p className="text-lg font-semibold text-ink">{t("detail.notFound")}</p>
          <p className="text-[12.5px] text-muted">{t("detail.notFoundBody")}</p>
          <Link href="/docs" className="btn-gold mt-2 text-[13px]">
            <ArrowLeft className="size-4" /> {t("docs.backToApp")}
          </Link>
        </div>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />

      <div className="mx-auto max-w-[1400px] px-4 pb-12 pt-5 sm:px-6">
        {/* breadcrumb */}
        <nav className="flex flex-wrap items-center gap-1 text-[11px] text-muted" aria-label="Breadcrumb">
          <Link href="/docs" className="inline-flex items-center gap-1 transition-colors hover:text-ink">
            <BookOpen className="size-3" /> {t("docs.sidebarTitle")}
          </Link>
          <ChevronRight className="size-3 text-muted/40" />
          <span className="text-muted/70">{t(DOC_SECTIONS.find((s) => s.id === doc.section)?.labelKey ?? "")}</span>
          <ChevronRight className="size-3 text-muted/40" />
          <span className="text-ink/90">{doc.title[lang]}</span>
        </nav>

        <div className="mt-4 grid gap-5 lg:grid-cols-[250px_1fr] xl:grid-cols-[250px_1fr_200px]">
          {/* sidebar */}
          <aside className="lg:sticky lg:top-[86px] lg:h-fit">
            <div className="glass rounded-2xl border-white/10 p-3">
              <p className="px-1 text-[9.5px] uppercase tracking-[0.18em] text-muted/70">{t("docs.sidebarTitle")}</p>
              <div className="mt-2 space-y-3">
                {DOC_SECTIONS.map((section) => (
                  <div key={section.id}>
                    <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-gold/80">
                      <span className="mr-1">{section.emoji}</span>
                      {t(section.labelKey)}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {docsBySection(section.id).map((item) => {
                        const isActive = item.slug === doc.slug;
                        return (
                          <li key={item.slug}>
                            <Link
                              href={`/docs/${item.slug}`}
                              aria-current={isActive ? "page" : undefined}
                              className={cn(
                                "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] transition-colors",
                                isActive
                                  ? "bg-gold/12 font-medium text-gold-bright"
                                  : "text-muted hover:bg-white/[0.04] hover:text-ink"
                              )}
                            >
                              <span
                                className={cn(
                                  "size-1 shrink-0 rounded-full",
                                  isActive ? "bg-gold-bright" : "bg-white/20"
                                )}
                              />
                              {t(`docs.${item.key}`)}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-2.5">
              <GitHubDocsLink />
            </div>
          </aside>

          {/* article */}
          <article className="min-w-0">
            <div className="glass rounded-2xl border-white/10 p-5 sm:p-7">
              <p className="mono text-[9.5px] uppercase tracking-[0.2em] text-gold/80">
                {t(DOC_SECTIONS.find((s) => s.id === doc.section)?.labelKey ?? "")}
              </p>
              <h1 className="mt-1.5 text-[24px] font-bold leading-tight text-ink sm:text-[30px]">{doc.title[lang]}</h1>
              <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-muted">{doc.summary[lang]}</p>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] text-muted/60">
                <span className="chip !px-2 !py-0.5">
                  <Sparkles className="size-2.5" /> v1.0
                </span>
                <span className="mono">{t("docs.lastUpdated")}: 2026-10-22</span>
                <span>·</span>
                <span>
                  {Math.max(2, Math.round((doc.body[lang].reduce((n, b) => n + (b.kind === "p" ? b.text.length : 80), 0)) / 900))}
                  &nbsp;{t("docs.readTime")}
                </span>
                <a
                  href={GITHUB_REPO}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-muted/70 transition-colors hover:text-gold-bright"
                >
                  <GitHubIcon className="size-3" />
                  <span>Source</span>
                </a>
              </div>

              {locale !== "en" && locale !== "zh-TW" && (
                <p className="mt-4 flex items-start gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[10.5px] leading-relaxed text-muted">
                  <Info className="mt-0.5 size-3 shrink-0" />
                  {t("docs.englishOnly")}
                </p>
              )}

              <div className="mt-5 space-y-3.5">
                {doc.body[lang].map((block, i) => (
                  <Block key={i} block={block} onCopy={copy} copied={copied} />
                ))}
              </div>

              {/* prev / next */}
              <div className="mt-8 grid gap-2 border-t border-white/[0.07] pt-4 sm:grid-cols-2">
                {prev ? (
                  <Link
                    href={`/docs/${prev.slug}`}
                    className="group flex flex-col gap-0.5 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-gold/30 hover:bg-white/[0.04]"
                  >
                    <span className="flex items-center gap-1 text-[9.5px] uppercase tracking-[0.12em] text-muted/60">
                      <ArrowLeft className="size-2.5" /> {t("docs.prev")}
                    </span>
                    <span className="text-[12px] font-medium text-ink transition-colors group-hover:text-gold-bright">
                      {prev.title[lang]}
                    </span>
                  </Link>
                ) : (
                  <span />
                )}
                {next && (
                  <Link
                    href={`/docs/${next.slug}`}
                    className="group flex flex-col items-end gap-0.5 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-right transition-colors hover:border-gold/30 hover:bg-white/[0.04]"
                  >
                    <span className="flex items-center gap-1 text-[9.5px] uppercase tracking-[0.12em] text-muted/60">
                      {t("docs.next")} <ArrowRight className="size-2.5" />
                    </span>
                    <span className="text-[12px] font-medium text-ink transition-colors group-hover:text-gold-bright">
                      {next.title[lang]}
                    </span>
                  </Link>
                )}
              </div>
            </div>
          </article>

          {/* on this page (xl only) */}
          <aside className="hidden xl:block">
            <div className="sticky top-[86px]">
              <p className="text-[9.5px] uppercase tracking-[0.16em] text-muted/60">{t("docs.onThisPage")}</p>
              <ul className="mt-2 space-y-1 border-l border-white/8 pl-2.5">
                {headings.map((h, i) => (
                  <li key={i}>
                    <a
                      href={`#sec-${i}`}
                      className="block text-[11px] leading-snug text-muted transition-colors hover:text-gold-bright"
                    >
                      {h.kind === "h2" ? h.text : ""}
                    </a>
                  </li>
                ))}
              </ul>
              <a
                href={explorerAddress(ARENA_ADDRESS)}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1 rounded-lg border border-white/8 px-2 py-1.5 text-[10.5px] text-muted transition-colors hover:border-gold/40 hover:text-gold-bright"
              >
                Basescan <ExternalLink className="size-2.5" />
              </a>
            </div>
          </aside>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}

function Block({
  block,
  onCopy,
  copied,
}: {
  block: DocBlock;
  onCopy: (value: string) => void;
  copied: string | null;
}) {
  switch (block.kind) {
    case "p":
      return <p className="text-[12.5px] leading-[1.75] text-ink/80">{block.text}</p>;

    case "h2":
      return (
        <h2 className="mt-6 border-b border-white/[0.07] pb-1.5 text-[15px] font-semibold text-ink first:mt-0">
          {block.text}
        </h2>
      );

    case "list":
      return (
        <ul className="space-y-1.5 pl-1">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-ink/75">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-gold/60" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );

    case "code":
      return (
        <div className="group relative overflow-hidden rounded-xl border border-white/8 bg-[#08080b]">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
            <span className="mono text-[9.5px] uppercase tracking-[0.12em] text-muted/50">{block.lang}</span>
            <button
              onClick={() => onCopy(block.code)}
              className="inline-flex items-center gap-1 rounded-md border border-white/8 px-1.5 py-0.5 text-[9.5px] text-muted transition-colors hover:border-gold/40 hover:text-gold-bright"
            >
              {copied === block.code ? <Check className="size-2.5 text-profit" /> : <Copy className="size-2.5" />}
            </button>
          </div>
          <pre className="mono overflow-x-auto p-3 text-[11px] leading-relaxed text-ink/85">
            <code>{block.code}</code>
          </pre>
        </div>
      );

    case "callout": {
      const tone =
        block.tone === "ok"
          ? "border-profit/25 bg-profit/[0.06] text-profit"
          : block.tone === "warn"
            ? "border-gold/30 bg-gold/[0.07] text-gold-bright"
            : "border-sky-400/25 bg-sky-400/[0.05] text-sky-200";
      const Icon = block.tone === "warn" ? ShieldAlert : Info;
      return (
        <div className={cn("rounded-xl border px-3 py-2.5", tone)}>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold">
            <Icon className="size-3.5 shrink-0" /> {block.title}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{block.text}</p>
        </div>
      );
    }

    case "address":
      return (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.1em] text-muted/60">{block.label}</p>
            <p className="mono mt-0.5 truncate text-[11.5px] text-ink">{block.value}</p>
            {block.note && <p className="mt-0.5 text-[10px] text-muted/60">{block.note}</p>}
          </div>
          <button
            onClick={() => onCopy(block.value)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[10.5px] text-muted transition-colors hover:border-gold/40 hover:text-gold-bright"
          >
            {copied === block.value ? <Check className="size-3 text-profit" /> : <Copy className="size-3" />}
          </button>
          <a
            href={explorerAddress(block.value)}
            target="_blank"
            rel="noreferrer"
            className="grid size-6 shrink-0 place-items-center rounded-lg border border-white/10 text-muted transition-colors hover:border-gold/40 hover:text-gold-bright"
          >
            <ExternalLink className="size-3" />
          </a>
        </div>
      );

    case "kv":
      return (
        <div className="overflow-hidden rounded-xl border border-white/8">
          <table className="w-full text-[11.5px]">
            <tbody className="divide-y divide-white/[0.06]">
              {block.rows.map(([k, v], i) => (
                <tr key={i} className="transition-colors hover:bg-white/[0.02]">
                  <td className="w-[38%] px-3 py-2 align-top text-muted">{k}</td>
                  <td className="mono px-3 py-2 align-top text-ink/85">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    default:
      return null;
  }
}
