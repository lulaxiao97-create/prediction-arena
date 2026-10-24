"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, ShieldCheck, X } from "lucide-react";
import { ARENA_ADDRESS } from "@/lib/docs";
import { explorerAddress } from "@/lib/format";
import { GITHUB_REPO } from "@/components/GitHubLink";
import { useMounted } from "@/hooks/useMounted";
import { SITE_HOST, isPreviewHostname } from "@/lib/site";

const DISMISS_KEY = "arena:trust-note:dismissed";

/**
 * Domain trust note.
 *
 * Wallet scanners (MetaMask's Blockaid, WalletGuard, Pocket Universe) score a dApp by domain
 * reputation, and free shared-hosting names — `*.onrender.com` included — sit at the bottom of
 * that scale because attackers use them. Nothing in this codebase can outvote a reputation
 * score, so the honest move is to state the situation and put the verifiable facts in the same
 * breath: the contract address, the source repository, and where the official deployment is.
 *
 * Shown only on a shared preview host (never on the canonical `SITE_HOST`), after mount, and
 * dismissible — a returning visitor sees it once.
 */
export function DomainTrustNote() {
  const mounted = useMounted();
  const [host, setHost] = useState("");
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setHost(window.location.hostname);
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setHost("");
    }
  }, []);

  // The canonical domain (NEXT_PUBLIC_SITE_URL → SITE_HOST) needs no explanation: it is the
  // domain the contract, the repo and the docs all point at. Only the shared preview names —
  // where a wallet scanner's low-reputation warning is legitimate — get the note.
  const isSharedHost = isPreviewHostname(host);
  if (!mounted || dismissed || !isSharedHost) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* storage blocked — the note simply returns next visit */
    }
  };

  return (
    <div className="border-b border-gold/20 bg-gradient-to-r from-gold/[0.09] via-gold/[0.04] to-transparent">
      <div className="mx-auto flex max-w-[1400px] items-start gap-2.5 px-4 py-2 sm:items-center sm:px-6">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-gold-bright sm:mt-0" />
        <p className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-muted sm:text-[11px]">
          <span className="font-medium text-ink">
            You are on the official preview domain — {SITE_HOST} is the canonical one.
          </span>{" "}
          Wallet security scanners treat shared hosting domains as low-trust, so your wallet may
          show a warning. Verify before signing:{" "}
          <a
            href={explorerAddress(ARENA_ADDRESS)}
            target="_blank"
            rel="noopener noreferrer"
            className="mono text-gold-bright hover:underline"
          >
            contract {ARENA_ADDRESS.slice(0, 6)}…{ARENA_ADDRESS.slice(-4)}
          </a>{" "}
          ·{" "}
          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-gold-bright hover:underline"
          >
            source <ExternalLink className="size-2.5" />
          </a>{" "}
          ·{" "}
          <Link href="/docs/security" className="inline-flex items-center gap-0.5 text-gold-bright hover:underline">
            <CheckCircle2 className="size-2.5" /> security notes
          </Link>
        </p>
        <button
          onClick={dismiss}
          aria-label="Dismiss domain notice"
          className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border border-white/10 text-muted transition-colors hover:border-white/25 hover:text-ink sm:mt-0"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}
