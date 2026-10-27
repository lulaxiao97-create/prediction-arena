import { verifyMessage } from "viem";

/**
 * Admin gate.
 *
 * Two independent checks, both required:
 *   1. the signer is on the allowlist (`ADMIN_ADDRESSES`, falling back to the public variant so a
 *      single env var is enough in one deployment);
 *   2. the request carries an EIP-191 signature over a timestamped, address-bound message, so a
 *      pasted URL or a shared screenshot cannot act as a credential.
 *
 * The signature is a session token, not a permission system: every *money-moving* action is a
 * contract call signed by the admin's own wallet, and the contract only accepts `settle()` from
 * its owner. Nothing here can move funds.
 */

export const ADMIN_MESSAGE_PREFIX = "prediction-arena admin";
/** A signature older than this is refused, so a leaked request URL expires on its own. */
const MAX_SKEW_MS = 5 * 60 * 1000;

export function adminAllowlist(): string[] {
  const raw = process.env.ADMIN_ADDRESSES ?? process.env.NEXT_PUBLIC_ADMIN_ADDRESSES ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s));
}

export function adminMessage(address: string, ts: number | string): string {
  return `${ADMIN_MESSAGE_PREFIX}\naddress:${address.toLowerCase()}\nts:${ts}`;
}

export type AdminCheck = { ok: true; address: string } | { ok: false; status: number; error: string };

export async function checkAdmin(
  address?: string | null,
  ts?: string | null,
  sig?: string | null
): Promise<AdminCheck> {
  const list = adminAllowlist();
  if (list.length === 0) return { ok: false, status: 503, error: "admin allowlist not configured" };
  if (!address || !ts || !sig) return { ok: false, status: 401, error: "signature required" };

  const lower = address.toLowerCase();
  if (!list.includes(lower)) return { ok: false, status: 403, error: "not an admin" };

  const stamp = Number(ts);
  if (!Number.isFinite(stamp) || Math.abs(Date.now() - stamp) > MAX_SKEW_MS) {
    return { ok: false, status: 401, error: "signature expired" };
  }

  try {
    const valid = await verifyMessage({
      address: lower as `0x${string}`,
      message: adminMessage(lower, ts),
      signature: sig as `0x${string}`,
    });
    if (!valid) return { ok: false, status: 403, error: "bad signature" };
  } catch {
    return { ok: false, status: 403, error: "bad signature" };
  }

  return { ok: true, address: lower };
}
