"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";

/**
 * Fire-and-forget page-view beacon.
 *
 * Three rules, so this never becomes the thing that breaks the site:
 *   · it sends nothing but the path, the referrer-derived ref param and (once a wallet is connected by
 *     the app) the address — no cookies, no fingerprint, no session id;
 *   · it swallows every error, because telemetry must never surface to a user;
 *   · it skips the admin routes entirely, so the operator's own visits do not pollute the numbers.
 */
export function TelemetryBeacon() {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();

  // Wallet connections get their own event: "how many distinct wallets ever showed up" is the only
  // activation number that matters for a venue with no deposits yet.
  useEffect(() => {
    if (!isConnected || !address) return;
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "wallet", path: pathname ?? "/", wallet: address }),
      keepalive: true,
    }).catch(() => {});
  }, [address, isConnected, pathname]);

  useEffect(() => {
    if (!pathname) return;
    if (pathname.startsWith("/admin") || pathname.startsWith("/api")) return;

    const ref = new URLSearchParams(window.location.search).get("ref");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "view", path: pathname, ref }),
      keepalive: true,
      signal: controller.signal,
    })
      .catch(() => {})
      .finally(() => clearTimeout(timer));

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [pathname]);

  return null;
}
