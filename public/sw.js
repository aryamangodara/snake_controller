// ==========================================
// SERVICE WORKER — offline shell cache
// ==========================================
// Network-first for same-origin requests so the app always runs fresh code when online; the
// cache is an OFFLINE FALLBACK only. All cross-origin traffic (Firebase, gstatic, unpkg, Font
// Awesome) is left untouched so realtime sync keeps working. Bump CACHE when shell assets change.

const CACHE = 'snake-shell-v11';

const SHELL_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './css/variables.css',
    './css/base.css',
    './css/desktop.css',
    './css/mobile.css',
    './css/leaderboard.css',
    './css/multiplayer.css',
    './js/utils.js',
    './js/logic.js',
    './js/config.js',
    './js/state.js',
    './js/players.js',
    './js/leaderboard.js',
    './js/leaderboard-ui.js',
    './js/sound.js',
    './js/effects.js',
    './js/mp-engine.js',
    './js/network.js',
    './js/mp-net.js',
    './js/game.js',
    './js/share.js',
    './js/mp-ui.js',
    './js/controller.js',
    './js/mp-client.js',
    './js/main.js',
    './snake-logo.png',
    './snake-logo-192.png',
    './snake-logo-512.png',
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

    // Network-first for ALL same-origin requests (HTML, JS, CSS, images): always run fresh code
    // when online; fall back to cache only when offline. The previous strategy served the HTML
    // network-first but assets stale-while-revalidate, so after a deploy fresh markup loaded
    // against a STALE cached controller.js — the new UI appeared but its handlers were never
    // wired (e.g. mobile "Play Again" did nothing) until a second reload. `cache: 'no-cache'`
    // forces revalidation so a stale HTTP-cached copy is never used.
    event.respondWith(
        fetch(event.request, { cache: 'no-cache' })
            .then((response) => {
                // Only cache good responses — a cached 404 would shadow a later fix.
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
                }
                return response;
            })
            // Offline: serve the cached asset. The index.html fallback applies ONLY to
            // navigations — handing HTML to a failed JS/CSS request just breaks the page.
            .catch(() => caches.match(event.request).then((cached) => {
                if (cached) return cached;
                if (event.request.mode === 'navigate') return caches.match('./index.html');
                return Response.error();
            }))
    );
});
