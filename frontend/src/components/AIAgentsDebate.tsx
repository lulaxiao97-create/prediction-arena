"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, ExternalLink, Fingerprint, RefreshCw, Sparkles } from "lucide-react";
import { AGENTS, agentLinesFor } from "@/lib/mock-data";
import { cn, ipfsGatewayUrl } from "@/lib/format";
import type { AgentLine } from "@/lib/types";

const TYPE_SPEED = 18;
const LINE_PAUSE = 1100;

export function AIAgentsDebate({ category }: { category: string }) {
  const lines = useMemo(() => agentLinesFor(category), [category]);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const reset = useCallback(() => {
    setIndex(0);
    setTyped("");
  }, []);

  useEffect(() => {
    reset();
  }, [category, reset]);

  useEffect(() => {
    if (index >= lines.length) return;
    const line = lines[index];

    if (typed.length < line.text.length) {
      const timer = setTimeout(
        () => setTyped(line.text.slice(0, typed.length + 1)),
        TYPE_SPEED
      );
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setIndex((value) => value + 1);
      setTyped("");
    }, LINE_PAUSE);
    return () => clearTimeout(timer);
  }, [index, typed, lines]);

  const finished = index >= lines.length;
  const activeAgent = !finished ? lines[index]?.agent : undefined;

  async function copyHash(hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(hash);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section className="glass relative overflow-hidden rounded-2xl p-4 sm:p-5">
      <div className="pointer-events-none absolute -left-20 -top-24 size-56 rounded-full bg-gold/8 blur-3xl" />

      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg border border-gold/30 bg-gold/10">
            <Sparkles className="size-4 text-gold-bright" />
          </span>
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-ink">AI Agents · Live Debate</h2>
            <p className="text-[11px] text-muted">
              Three independent personas argue macro, on-chain and sentiment. Every claim ships with an IPFS snapshot.
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="chip">
            <span className="size-1.5 animate-pulse rounded-full bg-gold" />
            {finished ? "Debate complete" : `Round ${Math.min(index + 1, lines.length)} / ${lines.length}`}
          </span>
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:border-gold/40 hover:text-gold-bright"
          >
            <RefreshCw className="size-3" />
            Replay
          </button>
        </div>
      </header>

      {/* agent roster */}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {AGENTS.map((agent) => {
          const speaking = activeAgent === agent.id;
          return (
            <div
              key={agent.id}
              className={cn(
                "relative flex items-start gap-2.5 rounded-xl border bg-white/[0.02] px-3 py-2.5 transition-all duration-500",
                speaking ? `${agent.ring} bg-white/[0.05]` : "border-white/6",
                speaking && "shadow-[0_0_36px_-18px_rgba(251,191,36,0.6)]"
              )}
            >
              <span className="text-lg leading-none">{agent.emoji}</span>
              <div className="min-w-0">
                <p className={cn("text-[12.5px] font-semibold", speaking ? agent.accent : "text-ink/90")}>
                  {agent.name}
                </p>
                <p className="mono text-[9.5px] uppercase tracking-[0.14em] text-muted/70">
                  {agent.role}
                </p>
                <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-muted/80">
                  {agent.bio}
                </p>
              </div>
              {speaking && (
                <span className="absolute right-2 top-2 flex gap-0.5">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="block size-1 rounded-full bg-gold"
                      animate={{ opacity: [0.2, 1, 0.2] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                    />
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="gold-rule my-4" />

      {/* stream */}
      <div className="space-y-2.5">
          {lines.map((line, i) => {
            if (i > index) return null;
            const agent = AGENTS.find((a) => a.id === line.agent)!;
            const isCurrent = i === index && !finished;
            const text = isCurrent ? typed : line.text;
            return (
              <div
                key={`${category}-${i}`}
                className={cn(
                  "rise-in flex flex-col gap-1.5 rounded-xl border px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3",
                  isCurrent ? "border-gold/25 bg-gold/[0.05]" : "border-white/6 bg-white/[0.015]"
                )}
              >
                <div className="flex shrink-0 items-center gap-2 sm:w-32">
                  <span className={cn("text-base", agent.accent)}>{agent.emoji}</span>
                  <div>
                    <p className="text-[11.5px] font-medium text-ink/90">{agent.name}</p>
                    <p className="mono text-[9px] uppercase tracking-[0.12em] text-muted/60">
                      {agent.role}
                    </p>
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-[12.5px] leading-relaxed text-ink/85",
                      isCurrent && text.length < line.text.length && "caret"
                    )}
                  >
                    {text}
                  </p>

                  {line.evidenceCid && text.length === line.text.length && (
                    <EvidenceChip
                      cid={line.evidenceCid}
                      copied={copied === line.evidenceCid}
                      onCopy={() => copyHash(line.evidenceCid!)}
                    />
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {finished && (
        <div className="rise-in mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-gold/25 bg-gradient-to-r from-gold/10 to-transparent px-3 py-2.5">
          <span className="chip chip-gold">Consensus</span>
          <p className="text-[11.5px] text-ink/85">
            All three agents posted their verdicts. Every claim is snapshotted, and the bundle hash is written on-chain at settlement.
          </p>
        </div>
      )}
    </section>
  );
}

function EvidenceChip({
  cid,
  copied,
  onCopy,
}: {
  cid: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="mono inline-flex items-center gap-1 rounded-md border border-gold/20 bg-gold/[0.07] px-1.5 py-0.5 text-[9.5px] text-gold-bright/90">
        <Fingerprint className="size-2.5" />
        ipfs://{cid.slice(0, 10)}…{cid.slice(-4)}
      </span>
      <button
        onClick={onCopy}
        className="inline-flex items-center gap-1 rounded-md border border-white/8 px-1.5 py-0.5 text-[9.5px] text-muted transition-colors hover:border-white/20 hover:text-ink"
      >
        {copied ? <Check className="size-2.5 text-profit" /> : <Copy className="size-2.5" />}
        {copied ? "Copied" : "Copy hash"}
      </button>
      <a
        href={ipfsGatewayUrl(cid)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-white/8 px-1.5 py-0.5 text-[9.5px] text-muted transition-colors hover:border-gold/40 hover:text-gold-bright"
      >
        <ExternalLink className="size-2.5" />
        Verify IPFS snapshot
      </a>
    </div>
  );
}

export type { AgentLine };
