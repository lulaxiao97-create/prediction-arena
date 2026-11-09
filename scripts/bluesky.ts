#!/usr/bin/env bun
/**
 * Bluesky publishing — AT Protocol, no browser.
 *
 * Why this exists instead of reusing the X daemon:
 *
 *   · X needed a signed-in desktop session, so every post depended on the machine being unlocked and
 *     on a browser that could reach api.x.com. That is what broke for four days.
 *   · Bluesky has a public write API. One POST to com.atproto.repo.createRecord publishes a post;
 *     no desktop, no proxy window, no GUI. If this box can reach bsky.social, it can post.
 *
 * Usage:
 *   bun scripts/bluesky.ts --login                      # store a session in ~/.hermes/.bsky_session.json
 *   bun scripts/bluesky.ts --text "..."                 # post one status
 *   bun scripts/bluesky.ts --text "..." --image a.png   # with an image embed
 *   bun scripts/bluesky.ts --thread file.txt            # one post per line, chained as a reply thread
 *   bun scripts/bluesky.ts --whoami
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SESSION = join(homedir(), ".hermes", ".bsky_session.json");
const PDS = process.env.BSKY_PDS ?? "https://bsky.social";
const IDENT = process.env.BSKY_IDENT ?? "predictionarena.bsky.social";
const PW_FILE = join(homedir(), ".hermes", ".bsky_pw");

type Session = { accessJwt: string; refreshJwt: string; handle: string; did: string };

function readSession(): Session | null {
  if (!existsSync(SESSION)) return null;
  try {
    return JSON.parse(readFileSync(SESSION, "utf8")) as Session;
  } catch {
    return null;
  }
}

async function login(): Promise<Session> {
  const password = process.env.BSKY_PASSWORD ?? (existsSync(PW_FILE) ? readFileSync(PW_FILE, "utf8").trim() : "");
  if (!password) throw new Error("no password: set BSKY_PASSWORD or write ~/.hermes/.bsky_pw");
  const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: IDENT, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const s = (await res.json()) as Session;
  writeFileSync(SESSION, JSON.stringify(s, null, 2), { mode: 0o600 });
  return s;
}

async function api(path: string, init: RequestInit, s: Session): Promise<any> {
  const res = await fetch(`${PDS}/xrpc/${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${s.accessJwt}`,
      "content-type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Byte-aware truncation. Bluesky counts graphemes with a 300 limit; UTF-8 bytes are the safe proxy. */
function clamp(text: string, limit = 290): string {
  if (Buffer.byteLength(text, "utf8") <= limit) return text;
  let out = "";
  for (const ch of text) {
    if (Buffer.byteLength(out + ch, "utf8") > limit - 1) break;
    out += ch;
  }
  return `${out}…`;
}

async function uploadImage(path: string, s: Session): Promise<any | null> {
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  const mime = path.endsWith(".png") ? "image/png" : "image/jpeg";
  const res = await fetch(`${PDS}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: { authorization: `Bearer ${s.accessJwt}`, "content-type": mime },
    body: bytes,
  });
  if (!res.ok) {
    console.error(`image upload failed ${res.status}`);
    return null;
  }
  const j = (await res.json()) as { blob: unknown };
  return j.blob;
}

async function post(text: string, s: Session, opts: { reply?: any; image?: string } = {}): Promise<any> {
  const record: Record<string, unknown> = {
    $type: "app.bsky.feed.post",
    text: clamp(text),
    createdAt: new Date().toISOString(),
    langs: ["en"],
  };
  if (opts.reply) record.reply = opts.reply;

  const embeds: any[] = [];
  if (opts.image) {
    const blob = await uploadImage(opts.image, s);
    if (blob) embeds.push({ $type: "app.bsky.embed.images", images: [{ image: blob, alt: "Prediction Arena market card" }] });
  }
  if (opts.card) {
    const card = await linkCard(opts.card, s);
    if (card) embeds.push(card);
  }
  if (embeds.length) record.embed = embeds[0];

  const out = await api(
    "com.atproto.repo.createRecord",
    {
      method: "POST",
      body: JSON.stringify({ repo: s.did, collection: "app.bsky.feed.post", record }),
    },
    s,
  );
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const has = (f: string) => args.includes(f);
  const val = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : undefined;
  };

  let s = readSession();
  if (has("--login") || !s) {
    s = await login();
    console.log(`logged in as ${s.handle} (${s.did})`);
    if (has("--login") && !has("--text") && !has("--thread")) return;
  }
  if (has("--whoami")) {
    console.log(`${s.handle} ${s.did}`);
    return;
  }

  const threadFile = val("--thread");
  if (threadFile) {
    const lines = readFileSync(threadFile, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    let parent: any = null;
    let root: any = null;
    for (const line of lines) {
      const reply = parent
        ? { root: { uri: root.uri, cid: root.cid }, parent: { uri: parent.uri, cid: parent.cid } }
        : undefined;
      const out = await post(line, s, { reply });
      root ??= out;
      parent = out;
      console.log(`posted ${out.uri}`);
      await new Promise((r) => setTimeout(r, 800));
    }
    return;
  }

  const text = val("--text");
  if (!text) {
    console.error("nothing to post (use --text or --thread)");
    process.exit(2);
  }
  const out = await post(text, s, { image: val("--image") });
  console.log(`posted ${out.uri}`);
}

main().catch((e) => {
  console.error(`bluesky: ${(e as Error).message}`);
  process.exit(1);
});
