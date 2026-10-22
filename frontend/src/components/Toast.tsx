"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Loader2, X } from "lucide-react";
import { cn, explorerTx } from "@/lib/format";

export type ToastKind = "loading" | "success" | "error" | "info";

export type ToastInput = {
  kind: ToastKind;
  title: string;
  description?: string;
  hash?: string;
  /** ms before auto-dismiss; loading toasts never auto-dismiss */
  duration?: number;
};

type ToastItem = ToastInput & { id: string };

type ToastApi = {
  push: (input: ToastInput) => string;
  update: (id: string, patch: Partial<ToastInput>) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((input: ToastInput) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems((prev) => [...prev.slice(-3), { ...input, id }]);
    return id;
  }, []);

  const update = useCallback((id: string, patch: Partial<ToastInput>) => {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const api = useMemo(() => ({ push, update, dismiss }), [push, update, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onClose={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  useEffect(() => {
    if (item.kind === "loading") return;
    const ms = item.duration ?? 5200;
    const timer = setTimeout(onClose, ms);
    return () => clearTimeout(timer);
  }, [item.kind, item.duration, onClose, item.title]);

  const tone =
    item.kind === "success"
      ? { border: "border-profit/35", bg: "bg-profit/[0.08]", text: "text-profit", Icon: CheckCircle2 }
      : item.kind === "error"
        ? { border: "border-loss/35", bg: "bg-loss/[0.08]", text: "text-loss", Icon: AlertTriangle }
        : item.kind === "loading"
          ? { border: "border-gold/35", bg: "bg-gold/[0.08]", text: "text-gold-bright", Icon: Loader2 }
          : { border: "border-white/12", bg: "bg-white/[0.05]", text: "text-ink", Icon: Info };

  const { Icon } = tone;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-auto glass rise-in flex items-start gap-2.5 rounded-xl border px-3 py-2.5 shadow-2xl",
        tone.border,
        tone.bg
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone.text, item.kind === "loading" && "animate-spin")} />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold leading-snug text-ink">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{item.description}</p>
        )}
        {item.hash && (
          <a
            href={explorerTx(item.hash)}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-gold-bright hover:underline"
          >
            {item.hash.slice(0, 10)}…{item.hash.slice(-6)} <ExternalLink className="size-2.5" />
          </a>
        )}
      </div>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="grid size-5 shrink-0 place-items-center rounded-md text-muted/70 transition-colors hover:bg-white/8 hover:text-ink"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Never crash a component just because it sits outside the provider.
    return { push: () => "", update: () => {}, dismiss: () => {} };
  }
  return ctx;
}
