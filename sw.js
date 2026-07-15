const CACHE_NAME = 'bingo-master-pro-v27';

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

// ===================== NOTIFICAÇÕES PUSH (item 10) =====================
self.addEventListener('push', (event) => {
    let data = { title: 'Bingo VIP Club', body: 'Você tem uma novidade!' };
    try {
        if (event.data) data = Object.assign(data, event.data.json());
    } catch (e) {}
    const options = {
        body: data.body,
        icon: '/Nova Imagem de Bitmap.jpg',
        badge: '/Nova Imagem de Bitmap.jpg',
        tag: data.tag || 'bingo-notification',
        renotify: true,
        data: data.url ? { url: data.url } : {}
    };
    event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) return client.focus();
            }
            return self.clients.openWindow(target);
        })
    );
});
