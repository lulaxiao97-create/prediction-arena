/**
 * Build-time snapshot of the market manifest.
 *
 * `public/pools.json` is also fetched at runtime (it is rewritten by scripts/sync-pool-list.ts
 * whenever a market opens), but the app needs a *synchronous* copy for the first render —
 * otherwise the server-rendered HTML ships with an empty market grid and the page looks blank
 * until the client fetch resolves.
 */
import raw from "../../public/pools.json";
import type { Manifest } from "@/lib/markets";

export const SEED_MANIFEST = raw as unknown as Manifest;
