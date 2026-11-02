"use client";

import type { ReactNode } from "react";

/**
 * A small Markdown renderer, sized to the one document it has to draw.
 *
 * Supports: h1–h4, paragraphs, ordered/unordered lists (with continuation lines), tables, code
 * fences, blockquotes, horizontal rules, and inline bold / italic / code / links. Unknown syntax
 * degrades to plain text and never to injected HTML — no dangerouslySetInnerHTML anywhere, because
 * this page lives in a dApp that also signs transactions.
 */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("**")) {
      out.push(<strong key={k} className="font-semibold text-ink">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(<code key={k} className="rounded bg-white/8 px-1 py-0.5 font-mono text-[0.92em] text-gold-bright">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("[")) {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      if (link) {
        out.push(
          <a key={k} href={link[2]} className="text-cyan-bright underline decoration-cyan/40 underline-offset-2 hover:decoration-cyan"
             target={link[2].startsWith("http") ? "_blank" : undefined} rel="noreferrer">{link[1]}</a>,
        );
      } else out.push(tok);
    } else {
      // single-asterisk italic; ** was matched above, so this cannot swallow bold text
      out.push(<em key={k} className="text-muted/90">{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** GitHub-style anchor id, so README links such as `#3-arena-points-system` land on the page. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s+/;
const isTableRow = (s: string) => s.trim().startsWith("|") && s.trim().endsWith("|");
const isHeading = (s: string) => /^#{1,4}\s+/.test(s);
const isSpecial = (s: string) => isHeading(s) || LIST_ITEM.test(s) || s.startsWith("```") || s.startsWith("> ") || isTableRow(s) || s.trim() === "---";

export function MarkdownDoc({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i += 1; continue; }

    if (line.trim() === "---") { blocks.push(<hr key={k++} className="my-8 border-white/8" />); i += 1; continue; }

    if (line.startsWith("```")) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) { buf.push(lines[i]); i += 1; }
      i += 1;
      blocks.push(
        <pre key={k++} className="my-4 overflow-x-auto rounded-xl border border-white/8 bg-black/40 p-4 font-mono text-[11.5px] leading-relaxed text-muted">
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) { buf.push(lines[i].slice(2)); i += 1; }
      blocks.push(
        <blockquote key={k++} className="my-4 rounded-r-xl border-l-2 border-gold/60 bg-gold/[0.04] px-4 py-3 text-[12.5px] leading-relaxed text-muted">
          {buf.map((b, n) => <p key={n} className={n ? "mt-2" : ""}>{inline(b, `q${k}-${n}`)}</p>)}
        </blockquote>,
      );
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const head = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
        i += 1;
      }
      blocks.push(
        <div key={k++} className="my-5 overflow-x-auto rounded-xl border border-white/8">
          <table className="w-full border-collapse text-left text-[11.5px]">
            <thead className="bg-white/[0.03]">
              <tr>{head.map((h, n) => <th key={n} className="whitespace-nowrap border-b border-white/8 px-3 py-2 font-semibold text-ink">{inline(h, `th${k}-${n}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, rn) => (
                <tr key={rn} className="odd:bg-white/[0.015]">
                  {r.map((c, cn) => <td key={cn} className="border-b border-white/5 px-3 py-2 align-top text-muted">{inline(c, `td${k}-${rn}-${cn}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (isHeading(line)) {
      const m = /^(#{1,4})\s+(.*)$/.exec(line)!;
      // The page owns the <h1>; document headings start at h2 so the outline stays valid.
      const level = Math.min(4, Math.max(2, m[1].length + (m[1].length === 1 ? 1 : 0)));
      const Tag = (`h${level}` as unknown) as "h2" | "h3" | "h4";
      const cls = level === 2
        ? "mt-10 mb-3 scroll-mt-24 border-t border-white/6 pt-6 text-[19px] font-semibold tracking-tight text-ink"
        : level === 3
          ? "mt-6 mb-2 scroll-mt-24 text-[14.5px] font-semibold text-ink"
          : "mt-5 mb-1.5 text-[12.5px] font-semibold text-gold-bright";
      blocks.push(
        <Tag key={k++} id={slug(m[2])} className={cls}>
          {inline(m[2], `h${k}`)}
        </Tag>,
      );
      i += 1;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (LIST_ITEM.test(cur)) {
          items.push(cur.replace(LIST_ITEM, "").trim());
          i += 1;
          continue;
        }
        // a wrapped line belongs to the previous item, until a blank line or a new block starts
        if (cur.trim() && !isSpecial(cur)) { items[items.length - 1] += ` ${cur.trim()}`; i += 1; continue; }
        break;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={k++} className={`my-3 ${ordered ? "list-decimal" : "list-disc"} space-y-1.5 pl-5 text-[12.5px] leading-[1.7] text-muted`}>
          {items.map((it, n) => <li key={n}>{inline(it, `li${k}-${n}`)}</li>)}
        </Tag>,
      );
      continue;
    }

    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !isSpecial(lines[i])) { buf.push(lines[i]); i += 1; }
    if (buf.length === 0) { i += 1; continue; }
    blocks.push(<p key={k++} className="my-3 text-[12.5px] leading-[1.75] text-muted">{inline(buf.join(" "), `p${k}`)}</p>);
  }

  return <div className="whitepaper">{blocks}</div>;
}
