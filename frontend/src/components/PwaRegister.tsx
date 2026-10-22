"use client";

import { useEffect } from "react";

/**
 * Registers the service worker after load so it never competes with the first paint.
 *
 * Registration is skipped in development (a stale SW cache while iterating on the UI is worse than
 * no offline support) and guarded against double-registration on hot reload.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* offline support is a bonus — never surface a failure to the user */
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
