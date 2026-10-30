/**
 * OAuth 1.0a signing for X — the only user-context credential that can write without a browser.
 *
 * Lifted out of `auto-market.ts` so the interceptor can post without importing a script that runs
 * `main()` on import. The rules that bite are the same ones documented there: a JSON body
 * contributes no parameters, percent-encoding is RFC 3986 (not `encodeURIComponent`), and the
 * signing key is `consumerSecret & tokenSecret`.
 */

import { createHmac, randomBytes } from "node:crypto";

export type OAuthCreds = { key: string; secret: string; token: string; tokenSecret: string };

export function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function oauthHeader(method: string, url: string, creds: OAuthCreds): string {
  const params: Record<string, string> = {
    oauth_consumer_key: creds.key,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.token,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${pct(k)}=${pct(params[k])}`)
    .join("&");
  const base = `${method.toUpperCase()}&${pct(url)}&${pct(paramString)}`;
  const signature = createHmac("sha1", `${pct(creds.secret)}&${pct(creds.tokenSecret)}`).update(base).digest("base64");
  const header: Record<string, string> = { ...params, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(header)
      .sort()
      .map((k) => `${pct(k)}="${pct(header[k])}"`)
      .join(", ")
  );
}

/** The four-part key set from the environment, or null when only a bearer exists. */
export function oauthCreds(): OAuthCreds | null {
  const key = process.env.X_CONSUMER_KEY?.trim();
  const secret = process.env.X_CONSUMER_SECRET?.trim();
  const token = process.env.X_ACCESS_TOKEN?.trim();
  const tokenSecret = process.env.X_ACCESS_SECRET?.trim();
  if (!key || !secret || !token || !tokenSecret) return null;
  return { key, secret, token, tokenSecret };
}

/** One POST with retries on 429/5xx only: a 4xx will fail identically next time. */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ ok: boolean; status: number; text: string }> {
  let last = { ok: false, status: 0, text: "no attempt" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      last = { ok: res.ok, status: res.status, text };
      if (res.ok || (res.status !== 429 && res.status < 500)) return last;
    } catch (err) {
      last = { ok: false, status: 0, text: (err as Error).message };
    }
    await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
  }
  return last;
}
