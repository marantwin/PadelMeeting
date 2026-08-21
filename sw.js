const CACHE = 'padelmeeting-v86';
const PRECACHE = [
  '/',
  '/index.html',
  '/supabase.js',
  '/overview.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ─── WEB PUSH ───
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; }
  catch (_) { data = { title: 'PadelMeeting', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'PadelMeeting';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
    vibrate: [80, 40, 80],
    tag: data.tag || 'pm-notif',
    renotify: true,
  };
  // Mostra il pallino sull'icona dell'app (anche ad app chiusa).
  // Il numero esatto verrà sincronizzato dall'app alla prossima apertura.
  if (self.navigator && self.navigator.setAppBadge) {
    try { self.navigator.setAppBadge(); } catch (_) {}
  }
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) { if (c.navigate) { try { c.navigate(target); } catch (_) {} } return c.focus(); }
      }
      return clients.openWindow(target);
    })
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Supabase API (auth + dati dinamici): SEMPRE rete, mai cache.
  // Senza questo, inviti/notifiche/partite verrebbero serviti vecchi dalla cache.
  if (url.hostname.includes('supabase')) return;

  // Google Fonts: network-first, fallback alla cache
  if (url.hostname.includes('fonts.g')) {
    e.respondWith(
      fetch(e.request)
        .then(r => { const c = r.clone(); caches.open(CACHE).then(cache => cache.put(e.request, c)); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // index.html / navigazione: network-first così il codice è sempre aggiornato online,
  // con fallback alla cache quando offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => { const c = r.clone(); caches.open(CACHE).then(cache => cache.put(e.request, c)); return r; })
        .catch(() => caches.match(e.request).then(c => c || caches.match('/index.html')))
    );
    return;
  }

  // Asset statici dell'app (icone, supabase.js, manifest): cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(r => {
        if (!r || r.status !== 200 || r.type === 'opaque') return r;
        const c = r.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, c));
        return r;
      });
    })
  );
});
