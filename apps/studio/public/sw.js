// Lyric Studio service worker: keeps the app shell (pages, scripts, styles, fonts, icons) so the
// installed app opens without internet. Everything runs on this PC; pages and data are always
// fetched fresh from the local server first, the cache is only a fallback.
const CACHE = "lyric-studio-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const isStatic = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (isStatic) {
        const hit = await cache.match(event.request);
        if (hit) return hit;
      }
      try {
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      } catch (error) {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        throw error;
      }
    })(),
  );
});
