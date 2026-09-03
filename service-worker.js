'use strict';
const CACHE_PREFIX = 'motofinance-pro-';
const CACHE_NAME = 'motofinance-pro-v1-20260903-hardening-r3';
const SUPABASE_SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4';
const APP_FILES = [
  './','./index.html','./style.css','./preflight.js','./core.js','./script.js','./sync-config.js','./app-enhancements.js',
  './sync-core.js','./sync-storage.js','./sync-ui.js','./sync-engine.js','./sync.js','./auth.html','./auth.js',
  './manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'
];
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
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (event.request.url === SUPABASE_SDK) {
    event.respondWith((async () => {
      const cached = await caches.match(SUPABASE_SDK); if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(SUPABASE_SDK, response.clone()));
      return response;
    })());
    return;
  }
  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
      return response;
    } catch (error) {
      const cached = await caches.match(event.request); if (cached) return cached;
      if (event.request.mode === 'navigate') return caches.match('./index.html');
      return new Response('Recurso indisponível offline.', { status:503, headers:{'Content-Type':'text/plain; charset=utf-8'} });
    }
  })());
});
