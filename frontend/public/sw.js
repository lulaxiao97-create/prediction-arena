/* Prediction Arena service worker — app shell + cover art cache, nothing else.
 *
 * Deliberately conservative:
 *   · only same-origin GET requests are touched (chain RPC and any future API stay live-only)
 *   · immutable build assets and cover art: cache-first (they are content-hashed / never change)
 *   · pools.json: stale-while-revalidate (the daemon rewrites it; serve instantly, refresh in the
 *     background)
 *   · navigations: network-first with an offline fallback to the cached shell
 *
 * Bump VERSION to invalidate everything.
 */
const VERSION = "pa-shell-v2";
const SHELL = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png", "/covers/crypto.jpg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isAsset = (path) =>
  path.startsWith("/_next/static/") ||
  path.startsWith("/covers/") ||
  /\.(?:png|svg|jpg|jpeg|webp|ico|woff2?)$/.test(path);

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(VERSION);
    cache.put(request, res.clone()).catch(() => undefined);
  }
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone()).catch(() => undefined);
      return res;
    })
    .catch(() => hit);
  return hit || network;
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(VERSION);
      cache.put(request, res.clone()).catch(() => undefined);
    }
    return res;
  } catch {
    const hit = (await caches.match(request)) || (await caches.match("/"));
    if (hit) return hit;
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // chain RPC / explorer stay untouched

  if (url.pathname === "/pools.json") {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (isAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
  }
});
