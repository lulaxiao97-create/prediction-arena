"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ArrowBigUp, Loader2, MessageSquare, Send, ThumbsUp, Wallet } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { useToast } from "@/components/Toast";
import { cn, shortAddr } from "@/lib/format";
import { relativeTime, seedPostsFor, type CommunityPost, type Stance } from "@/lib/community";

const storeKey = (id: string) => `pa:community:${id}`;

type Stored = {
  posts: { id: string; address: string; stance: Stance; body: string; createdAt: number }[];
  upvoted: string[];
};

function load(id: string): Stored {
  if (typeof window === "undefined") return { posts: [], upvoted: [] };
  try {
    const raw = window.localStorage.getItem(storeKey(id));
    if (!raw) return { posts: [], upvoted: [] };
    const parsed = JSON.parse(raw) as Stored;
    return { posts: Array.isArray(parsed.posts) ? parsed.posts : [], upvoted: Array.isArray(parsed.upvoted) ? parsed.upvoted : [] };
  } catch {
    return { posts: [], upvoted: [] };
  }
}

function save(id: string, value: Stored) {
  try {
    window.localStorage.setItem(storeKey(id), JSON.stringify(value));
  } catch {
    /* quota / private mode — the thread simply does not persist */
  }
}

/** Deterministic avatar tint from the address so the same wallet keeps the same colour. */
function tint(address: string): string {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) % 360;
  return `hsl(${h} 62% 48%)`;
}

export function CommunityDiscussion({
  poolId,
  category,
  yesPct,
}: {
  poolId: string;
  category: string;
  yesPct: number;
}) {
  const { t } = useI18n();
  const { address } = useAccount();
  const toast = useToast();

  const seeds = useMemo(() => seedPostsFor(poolId, category, yesPct), [poolId, category, yesPct]);
  const [stored, setStored] = useState<Stored>({ posts: [], upvoted: [] });
  const [mounted, setMounted] = useState(false);
  const [stance, setStance] = useState<Stance>("bull");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setStored(load(poolId));
    setMounted(true);
  }, [poolId]);

  const posts: CommunityPost[] = useMemo(() => {
    const mine: CommunityPost[] = stored.posts.map((p) => ({
      id: p.id,
      address: `${p.address.slice(0, 6)}…${p.address.slice(-4)}`,
      stance: p.stance,
      body: p.body,
      minutesAgo: Math.max(0, Math.round((Date.now() - p.createdAt) / 60000)),
      upvotes: 0,
      mine: true,
    }));
    return [...mine, ...seeds].sort((a, b) => a.minutesAgo - b.minutesAgo);
  }, [stored.posts, seeds]);

  const sentiment = useMemo(() => {
    let bull = 0;
    let bear = 0;
    for (const p of posts) {
      const weight = 1 + Math.min(p.upvotes, 50) / 25; // upvotes nudge, never dominate
      if (p.stance === "bull") bull += weight;
      else bear += weight;
    }
    const total = bull + bear || 1;
    return { bullPct: Math.round((bull / total) * 100), bearPct: Math.round((bear / total) * 100), count: posts.length };
  }, [posts]);

  function upvote(post: CommunityPost) {
    const already = stored.upvoted.includes(post.id);
    const next: Stored = {
      ...stored,
      upvoted: already ? stored.upvoted.filter((id) => id !== post.id) : [...stored.upvoted, post.id],
    };
    setStored(next);
    save(poolId, next);
  }

  function submit() {
    const body = draft.trim();
    if (!address) {
      toast.push({ kind: "error", title: t("community.connectToPost"), description: t("trade.connectFirst") });
      return;
    }
    if (body.length < 8) {
      toast.push({ kind: "error", title: t("community.tooShort") });
      return;
    }
    setSending(true);
    const post = {
      id: `${poolId}-mine-${Date.now()}`,
      address,
      stance,
      body: body.slice(0, 280),
      createdAt: Date.now(),
    };
    const next: Stored = { ...stored, posts: [post, ...stored.posts] };
    setStored(next);
    save(poolId, next);
    setDraft("");
    setSending(false);
    toast.push({ kind: "success", title: t("community.posted"), description: t("community.localNote") });
  }

  return (
    <section className="glass overflow-hidden rounded-2xl">
      {/* header + sentiment */}
      <div className="border-b border-white/[0.07] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg border border-cyan/30 bg-cyan/10">
            <MessageSquare className="size-3.5 text-cyan-bright" />
          </span>
          <h2 className="text-[13px] font-semibold tracking-tight text-ink">{t("community.title")}</h2>
          <span className="chip !px-2 !py-0.5">
            {sentiment.count} {t("community.posts")}
          </span>
          <span className="mono ml-auto text-[10px] text-muted/70">{t("community.sentiment")}</span>
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <span className="mono w-10 shrink-0 text-[10.5px] font-semibold text-profit">{sentiment.bullPct}%</span>
          <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
            <div
              className="h-full rounded-l-full bg-gradient-to-r from-profit/80 to-profit transition-[width] duration-500"
              style={{ width: `${sentiment.bullPct}%` }}
            />
            <div
              className="h-full flex-1 rounded-r-full bg-gradient-to-r from-loss to-loss/80 transition-[width] duration-500"
            />
          </div>
          <span className="mono w-10 shrink-0 text-right text-[10.5px] font-semibold text-loss">{sentiment.bearPct}%</span>
        </div>
      </div>

      {/* composer */}
      <div className="border-b border-white/[0.07] px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted/60">{t("community.yourPosition")}</span>
          {(["bull", "bear"] as Stance[]).map((side) => (
            <button
              key={side}
              onClick={() => setStance(side)}
              aria-pressed={stance === side}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-all active:scale-[0.97]",
                stance === side
                  ? side === "bull"
                    ? "border-profit/50 bg-profit/15 text-profit"
                    : "border-loss/50 bg-loss/15 text-loss"
                  : "border-white/10 text-muted hover:border-white/25 hover:text-ink"
              )}
            >
              <span className={cn("size-1.5 rounded-full", side === "bull" ? "bg-profit" : "bg-loss")} />
              {side === "bull" ? t("community.bullish") : t("community.bearish")}
            </button>
          ))}
        </div>

        <div className="mt-2 rounded-xl border border-white/8 bg-white/[0.02] transition-colors focus-within:border-cyan/35">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 280))}
            rows={2}
            placeholder={address ? t("community.placeholder") : t("community.connectPrompt")}
            className="w-full resize-none bg-transparent px-3 py-2 text-[12px] leading-relaxed text-ink outline-none placeholder:text-muted/50"
          />
          <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-2.5 py-1.5">
            <span className="mono text-[9.5px] text-muted/50">{280 - draft.length}</span>
            <button
              onClick={submit}
              disabled={sending || draft.trim().length === 0}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all active:scale-[0.97]",
                "disabled:cursor-not-allowed disabled:opacity-45",
                stance === "bull"
                  ? "border-profit/50 bg-profit/15 text-profit hover:bg-profit/25"
                  : "border-loss/50 bg-loss/15 text-loss hover:bg-loss/25"
              )}
            >
              {sending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
              {t("community.post")}
            </button>
          </div>
        </div>
        {!address && (
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-muted/60">
            <Wallet className="size-2.5" /> {t("community.connectToPost")}
          </p>
        )}
      </div>

      {/* thread */}
      <ul className="divide-y divide-white/[0.05]">
        {posts.map((post) => {
          const upvoted = stored.upvoted.includes(post.id);
          const votes = post.upvotes + (upvoted ? 1 : 0);
          return (
            <li key={post.id} className="px-4 py-3 transition-colors hover:bg-white/[0.015]">
              <div className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white/90"
                  style={{ backgroundColor: tint(post.address) }}
                  aria-hidden
                >
                  {post.address.slice(2, 4).toUpperCase()}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mono text-[11px] text-ink/90">{post.address}</span>
                    <span
                      className={cn(
                        "mono rounded border px-1 text-[8.5px] font-semibold uppercase tracking-[0.08em]",
                        post.stance === "bull"
                          ? "border-profit/30 bg-profit/10 text-profit"
                          : "border-loss/30 bg-loss/10 text-loss"
                      )}
                    >
                      {post.stance === "bull" ? "bull" : "bear"}
                    </span>
                    {post.mine && (
                      <span className="rounded border border-cyan/30 bg-cyan/10 px-1 text-[8.5px] uppercase tracking-[0.08em] text-cyan-bright">
                        {t("community.you")}
                      </span>
                    )}
                    <span className="text-[9.5px] text-muted/50">
                      {mounted ? relativeTime(post.minutesAgo) : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink/80">{post.body}</p>
                </div>

                <button
                  onClick={() => upvote(post)}
                  aria-pressed={upvoted}
                  aria-label={t("community.upvote")}
                  className={cn(
                    "flex shrink-0 flex-col items-center gap-0.5 rounded-lg border px-1.5 py-1 transition-all active:scale-95",
                    upvoted
                      ? "border-cyan/40 bg-cyan/12 text-cyan-bright"
                      : "border-white/8 text-muted hover:border-cyan/30 hover:text-cyan-bright"
                  )}
                >
                  {upvoted ? <ThumbsUp className="size-3" /> : <ArrowBigUp className="size-3" />}
                  <span className="mono text-[9.5px]">{votes}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="border-t border-white/[0.06] px-4 py-2 text-[9.5px] leading-relaxed text-muted/45">
        {t("community.disclaimer")}
      </p>
    </section>
  );
}
