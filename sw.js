const CACHE_NAME = 'bingo-master-pro-v24';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(keys.map((key) => caches.delete(key)));
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/')) return;
    if (event.request.method !== 'GET') return;

    // Network-first: sempre busca a verso nova na rede quando online.
    // So cai no cache (ou index.html) caso esteja offline.
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request).then((cached) => {
                return cached || caches.match('index.html');
            });
        })
    );
});
