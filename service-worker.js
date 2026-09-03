'use strict';

const CACHE_NAME = 'motofinance-pro-v1-20260903-r2';
const APP_FILES = [
    './',
    './index.html',
    './style.css',
    './core.js',
    './script.js',
    './manifest.webmanifest',
    './icon.svg',
    './icon-192.png',
    './icon-512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const requestUrl = new URL(event.request.url);
    if (requestUrl.origin !== self.location.origin) return;
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok && new URL(event.request.url).origin === self.location.origin) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(async () => {
                const cached = await caches.match(event.request);
                if (cached) return cached;
                if (event.request.mode === 'navigate') return caches.match('./index.html');
                return new Response('Recurso indisponível offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            })
    );
});
