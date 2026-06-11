const CACHE = 'friganso-v44';
const BASE = '/friganso-erp';
const ASSETS = [
    BASE + '/',
    BASE + '/index.html',
    BASE + '/icon.svg',
    BASE + '/manifest.json'
];

// Instala e faz cache dos arquivos do app imediatamente
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(ASSETS))
    );
    self.skipWaiting();
});

// Remove caches antigos
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Firebase, Firestore, CDN externo — sempre vai para a rede
    if (url.hostname !== self.location.hostname) return;

    // Requisições não-GET passam direto
    if (e.request.method !== 'GET') return;

    // Navegação / HTML — NETWORK-FIRST: sempre pega a versão mais nova quando online,
    // e cai pro cache só quando offline. Evita ficar preso em versão antiga.
    const isHTML = e.request.mode === 'navigate' ||
        (e.request.headers.get('accept') || '').includes('text/html');

    if (isHTML) {
        e.respondWith(
            fetch(e.request)
                .then(res => {
                    if (res && res.ok) {
                        const clone = res.clone();
                        caches.open(CACHE).then(c => c.put(e.request, clone));
                    }
                    return res;
                })
                .catch(() => caches.match(e.request).then(c => c || caches.match(BASE + '/index.html')))
        );
        return;
    }

    // Demais assets — CACHE-FIRST com atualização em background (stale-while-revalidate)
    e.respondWith(
        caches.match(e.request).then(cached => {
            const networkFetch = fetch(e.request)
                .then(res => {
                    if (res && res.ok && res.status === 200) {
                        const clone = res.clone();
                        caches.open(CACHE).then(c => c.put(e.request, clone));
                    }
                    return res;
                })
                .catch(() => null);

            return cached || networkFetch;
        })
    );
});
