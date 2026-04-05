const CACHE_VERSION = 'fastmp3fast-v3-2026-04-05-branding-v9';
const APP_PREFIXES = ['/fastmp3fast', '/mp3fastmp3'];
const APP_SHELL = [
  '/fastmp3fast/',
  '/fastmp3fast/index.html',
  '/fastmp3fast/manifest.webmanifest',
  '/fastmp3fast/favicon.svg',
  '/fastmp3fast/branding/pwa-192.png',
  '/fastmp3fast/branding/pwa-512.png',
  '/fastmp3fast/branding/pwa-512-maskable.png',
  '/fastmp3fast/branding/logo-wordmark.png',
  '/mp3fastmp3/',
  '/mp3fastmp3/index.html',
  '/mp3fastmp3/manifest.webmanifest',
  '/mp3fastmp3/favicon.svg',
  '/mp3fastmp3/branding/pwa-192.png',
  '/mp3fastmp3/branding/pwa-512.png',
  '/mp3fastmp3/branding/pwa-512-maskable.png',
  '/mp3fastmp3/branding/logo-wordmark.png',
];

function isApiRequest(request) {
  const url = new URL(request.url);
  return APP_PREFIXES.some((prefix) => url.pathname.startsWith(`${prefix}/api/`));
}

function isAppNavigation(request) {
  if (request.mode !== 'navigate') {
    return false;
  }

  const url = new URL(request.url);
  return APP_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
}

function appIndexPath(request) {
  const url = new URL(request.url);
  const prefix = APP_PREFIXES.find((candidate) => url.pathname === candidate || url.pathname.startsWith(`${candidate}/`));
  return `${prefix ?? '/fastmp3fast'}/index.html`;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(APP_SHELL).catch(() => {
        // Some optional aliases may not exist in every deployment.
      })
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  if (isApiRequest(request)) {
    // Never cache API responses to avoid stale library/search/list data.
    event.respondWith(fetch(request));
    return;
  }

  if (isAppNavigation(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const cloned = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, cloned));
          return response;
        })
        .catch(async () => {
          const cachedRequest = await caches.match(request);
          if (cachedRequest) {
            return cachedRequest;
          }
          const fallback = await caches.match(appIndexPath(request));
          return fallback || Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          const cloned = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, cloned));
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
