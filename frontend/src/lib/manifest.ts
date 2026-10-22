/**
 * Build-time snapshot of the market manifest and the pre-generated debate cache.
 *
 * `public/pools.json` and `public/debates.json` are also fetched at runtime (both are rewritten by
 * the ops daemon), but the app needs a *synchronous* copy for the first render — otherwise the
 * server-rendered HTML ships with an empty market grid and a debate that only appears after a
 * client fetch.
 *
 * Importing the debate cache here is also what makes the debate free: it arrives with the page
 * instead of costing an LLM call when a user opens a market.
 */
import raw from "../../public/pools.json";
import debates from "../../public/debates.json";
import type { Manifest } from "@/lib/markets";
import type { DebateCache } from "@/lib/debate-cache";

export const SEED_MANIFEST = raw as unknown as Manifest;
export const SEED_DEBATES = debates as unknown as DebateCache;
