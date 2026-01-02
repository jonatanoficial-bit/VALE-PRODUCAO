const CACHE_VERSION = "v2.0.0";
const CACHE_NAME = `vale-portal-${CACHE_VERSION}`;

// Cache apenas do "app" (shell). NÃO colocar data/app-data.json aqui.
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/logo.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    ).then(() => self.clients.claim())
  );
});

// Estratégia:
// - Para app shell: cache-first
// - Para data/app-data.json: network-first (sempre tenta pegar atualizado)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Sempre buscar dados do servidor
  if (url.pathname.endsWith("/data/app-data.json")) {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => res)
        .catch(() => caches.match(req))
    );
    return;
  }

  // App shell
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          if (url.origin === location.origin) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          const accept = req.headers.get("accept") || "";
          if (accept.includes("text/html")) return caches.match("./index.html");
          return new Response("Offline", { status: 503, statusText: "Offline" });
        });
    })
  );
});