"use client";

import { useEffect } from "react";

/**
 * Keeps the origin warm while someone has the app open.
 *
 * Why this exists: the production host is a free single-instance plan that sleeps after
 * ~15 minutes of inactivity, and a sleeping instance answers the *next* request with a
 * ~50s cold start. Nothing client-side can make the first request of a session cheaper —
 * that is what the scheduled keep-alive workflow is for — but two things are worth doing:
 *
 *  1. on mount, prime `/api/ping` so the route handler and any lazily-compiled server code
 *     are already hot when the visitor opens their second page;
 *  2. while the tab is open, re-ping every few minutes (and on regaining focus) so a
 *     reader who leaves the tab idle for twenty minutes does not come back to a cold
 *     instance on their next click.
 *
 * Requests are `keepalive` + `no-store`, never touch the chain, and are skipped when the
 * document is hidden, so they cost a few hundred bytes of server time and nothing else.
 */
const INTERVAL_MS = 4 * 60 * 1000;

export function WARMUP_ENDPOINT() {
  return "/api/ping";
}

export function Warmup() {
  useEffect(() => {
    let cancelled = false;

    const ping = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      fetch(WARMUP_ENDPOINT(), { cache: "no-store", keepalive: true }).catch(() => {
        /* warm-up is best-effort by definition */
      });
    };

    // Let the page settle before spending any request budget on a nicety.
    const first = window.setTimeout(ping, 2500);
    const timer = window.setInterval(ping, INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
