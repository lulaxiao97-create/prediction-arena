"use client";

import { useEffect } from "react";
import { resolveRef } from "@/lib/referral";

/**
 * Runs once per page load and persists `?ref=` before anything else reads it.
 *
 * Without this, the only reader was the bet flow's `useReferrer()` — so a visitor who landed on a
 * Frame link and left the tab open for ten minutes placed their bet with an empty referrer, and the
 * channel that produced the visit got nothing. Mounted in the root layout so every route captures.
 */
export function ReferralCapture() {
  useEffect(() => {
    resolveRef();
  }, []);
  return null;
}
