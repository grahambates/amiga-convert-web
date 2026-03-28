const CACHE_NAME = 'amiga-convert-v9';
const ASSETS = [
  '/',
  '/index.html',
  '/palette-adjuster.html',
  '/styles.css',
  '/app.js',
  '/worker.js',
  '/palette-adjuster.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js'
];

self.addEventListener('install', (event) => {
  // Take over immediately without waiting for old SW to stop
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  // Take control of all clients immediately
  event.waitUntil(
    Promise.all([
      clients.claim(),
      // Delete old caches
      caches.keys().then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        );
      })
    ])
  );
});

self.addEventListener('fetch', (event) => {
  // Stale-while-revalidate strategy
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          // Update cache with fresh response
          if (networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          // Network failed, return cached version if available
          return cachedResponse;
        });

        // Return cached response immediately, or wait for network
        return cachedResponse || fetchPromise;
      });
    })
  );
});
