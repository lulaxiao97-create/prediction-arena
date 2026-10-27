/**
 * Build-time snapshot of the market manifest.
 *
 * `public/pools.json` is also fetched at runtime (the ops daemon rewrites it), but the app needs a
 * *synchronous* copy for the first render — otherwise the server-rendered HTML ships with an empty
 * market grid and fills in only after a client fetch.
 *
 * Debates are not cached here any more: `lib/debate.ts` derives them from the pool, so there is
 * nothing to ship and nothing to pre-generate.
 */
import raw from "../../public/pools.json";
import type { Manifest } from "@/lib/markets";

export const SEED_MANIFEST = raw as unknown as Manifest;
