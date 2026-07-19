// Major Match Tracker — service worker
// Purpose: make the app installable + able to show notifications from the background.
const CACHE = 'mmt-v4';   // v4: clean icon refresh
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon.svg',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  // fetch with cache:'reload' so a new cache version never inherits stale copies from the HTTP cache
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((u) => fetch(u, { cache: 'reload' }).then((r) => c.put(u, r)).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page itself: network-first so app updates show up as soon as you're online
// (falls back to cache when offline). Other same-origin assets: cache-first.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // let ESPN calls hit the network
  const isDoc = e.request.mode === 'navigate' || e.request.destination === 'document';
  if (isDoc) {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});

// Let the page trigger a notification through the SW (shows even when backgrounded).
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'notify') {
    self.registration.showNotification(d.title || 'Match update', {
      body: d.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'mmt-score',
      renotify: true,
      vibrate: [80, 40, 80]
    });
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
