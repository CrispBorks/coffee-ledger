/* The app shell, kept on the device so the ledger opens like an app: instantly,
 * and with no connection at all.
 *
 * What's cached is the app itself — the page, its scripts and styles, the
 * icons. Never /api: your coffees come from the server, or from the copy the
 * app keeps itself (see src/lib/ledger.ts), and a cached API answer would be a
 * second, stale copy with no way to tell it was stale.
 */

const CACHE = "coffee-ledger-shell-v1";

/** How long to wait for the network before opening from the cache instead. A
 * new version still arrives on any decent connection; a bad one doesn't leave
 * you staring at a blank screen at the machine. */
const NETWORK_WAIT_MS = 2500;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fonts and the like: the network's business
  if (url.pathname.startsWith("/api/")) return; // never cache data

  if (request.mode === "navigate") {
    event.respondWith(openPage(request));
  } else if (url.pathname.startsWith("/assets/")) {
    // Built files have the content hash in their names, so a cached one is
    // always right.
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(cachedThenRefresh(request));
  }
});

/** Every route is the same single page, so it's cached once, under "/". */
async function openPage(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put("/", response.clone());
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_WAIT_MS, null));
  try {
    const fresh = await Promise.race([network, timeout]);
    if (fresh) return fresh;
  } catch {
    /* offline: fall through to the cached page */
  }
  const cached = await cache.match("/");
  return cached ?? network;
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function cachedThenRefresh(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached ?? network;
}
