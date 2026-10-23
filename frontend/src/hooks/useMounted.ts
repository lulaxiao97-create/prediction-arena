"use client";

import { useEffect, useState } from "react";

/**
 * True only after the first client render has committed.
 *
 * React hydrates by re-running the client components against the server HTML and comparing
 * the output. Anything that reads the wall clock, the local time zone or `window.location`
 * produces different text on the two sides, and React answers with error #418 and a full
 * client-side re-render of that subtree.
 *
 * The rule this hook enforces: **the server and the first client frame must render the same
 * placeholder**; the real value appears in the effect-triggered second frame. Use it for
 * countdowns, "ends at" timestamps and any value derived from `Date`, `Math.random()` or the
 * browser's own state — never for values that are already deterministic from props or the
 * build-time manifest.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
