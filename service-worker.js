'use strict';

const CACHE_NAME = 'motofinance-pro-v1-20260903-supabase-r2';
const SUPABASE_SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4';
const APP_FILES = [
    './',
    './index.html',
    './style.css',
    './core.js',
    './script.js',
    './sync-config.js',
    './sync-core.js',
    './sync-storage.js',
    './sync-ui.js',
    './sync-engine.js',
    './sync.js',
    './auth.html',
    './auth.js',
    './manifest.webmanifest',
    './icon.svg',
    './icon-192.png',
    './icon-512.png'
];

const SYNC_BOOTSTRAP = `
;(() => {
  if (window.__MOTOFINANCE_SYNC_BOOTSTRAP__) return;
  window.__MOTOFINANCE_SYNC_BOOTSTRAP__ = true;
  const base = new URL('.', document.currentScript?.src || location.href);
  const load = name => new Promise((resolve, reject) => {
    const src = new URL(name, base).href;
    if ([...document.scripts].some(item => item.src === src)) return resolve();
    const tag = document.createElement('script');
    tag.src = src; tag.async = false; tag.onload = resolve; tag.onerror = reject;
    document.head.appendChild(tag);
  });
  load('sync-config.js')
    .then(() => load('sync-core.js'))
    .then(() => load('sync-storage.js'))
    .then(() => load('sync-ui.js'))
    .then(() => load('sync-engine.js'))
    .then(() => load('sync.js'))
    .catch(error => console.error('Falha ao iniciar sincronização.', error));
})();`;

async function injectSync(response) {
    const text = await response.text();
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/javascript; charset=utf-8');
    return new Response(text + SYNC_BOOTSTRAP, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(APP_FILES);
        try { await cache.add(SUPABASE_SDK); } catch (error) { console.warn('SDK do Supabase não pôde ser pré-cacheado.', error); }
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
        await self.clients.claim();
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        await Promise.all(clients.map(client => client.navigate(client.url).catch(() => null)));
    })());
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const requestUrl = new URL(event.request.url);

    if (event.request.url === SUPABASE_SDK) {
        event.respondWith((async () => {
            const cached = await caches.match(SUPABASE_SDK);
            if (cached) return cached;
            const response = await fetch(event.request);
            if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(SUPABASE_SDK, response.clone()));
            return response;
        })());
        return;
    }

    if (requestUrl.origin !== self.location.origin) return;
    const isMainScript = requestUrl.pathname.endsWith('/script.js');

    event.respondWith((async () => {
        try {
            const response = await fetch(event.request);
            if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
            return isMainScript && response.ok ? injectSync(response) : response;
        } catch (error) {
            const cached = await caches.match(event.request);
            if (cached) return isMainScript ? injectSync(cached) : cached;
            if (event.request.mode === 'navigate') return caches.match('./index.html');
            return new Response('Recurso indisponível offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
    })());
});
