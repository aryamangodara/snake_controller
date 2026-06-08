// ==========================================
// SERVICE WORKER — offline shell cache
// ==========================================
// Caches the static, same-origin app shell so the game loads offline. All
// cross-origin traffic (Firebase, gstatic, unpkg, Font Awesome) is intentionally
// left untouched so realtime sync keeps working. Bump CACHE when shell assets change.

const CACHE = 'snake-shell-v2';

const SHELL_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './css/variables.css',
    './css/base.css',
    './css/desktop.css',
    './css/mobile.css',
    './js/utils.js',
    './js/logic.js',
    './js/config.js',
    './js/state.js',
    './js/leaderboard.js',
    './js/sound.js',
    './js/effects.js',
    './js/network.js',
    './js/game.js',
    './js/controller.js',
    './js/main.js',
    './snake-logo.png',
    './snake-favicon.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Only handle same-origin GETs; let Firebase/CDN requests go straight to network.
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

    // Network-first for the HTML document so new deploys show up immediately.
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() => caches.match('./index.html'))
        );
        return;
    }

    // Stale-while-revalidate for static assets: fast from cache, refreshed in the background.
    event.respondWith(
        caches.open(CACHE).then((cache) =>
            cache.match(event.request).then((cached) => {
                const network = fetch(event.request)
                    .then((response) => {
                        cache.put(event.request, response.clone());
                        return response;
                    })
                    .catch(() => cached);
                return cached || network;
            })
        )
    );
});
