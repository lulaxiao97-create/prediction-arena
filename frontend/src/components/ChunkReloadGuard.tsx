"use client";

import { useEffect } from "react";

/**
 * Stale-bundle guard.
 *
 * After a redeploy, a tab that is still running the previous build keeps requesting chunk
 * filenames that no longer exist. The browser fires `ChunkLoadError`, React never hydrates,
 * and every button on the page silently stops working — the exact "nothing is clickable"
 * symptom. This reloads once (rate-limited) so the tab picks up the current build instead of
 * staying dead.
 */
const PATTERN = /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed/i;
const KEY = "prediction-arena:chunk-reload-at";

function reloadOnce() {
  try {
    const last = Number(window.sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 10_000) return; // already reloaded very recently — do not loop
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* sessionStorage blocked — still reload, worst case one extra refresh */
  }
  window.location.reload();
}

export function ChunkReloadGuard() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const message = `${event?.message ?? ""} ${(event?.error as Error | undefined)?.message ?? ""}`;
      if (PATTERN.test(message)) reloadOnce();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event?.reason as { name?: string; message?: string } | undefined;
      if (PATTERN.test(`${reason?.name ?? ""} ${reason?.message ?? ""} ${String(event?.reason ?? "")}`)) {
        reloadOnce();
      }
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
