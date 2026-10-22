/* Worker unique de M.Michel : notifications OneSignal + cache de l'enveloppe du site (PWA).
   Il porte le nom que OneSignal cherche par défaut, à la racine du site. */
try { importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js'); } catch (e) { /* hors ligne : le cache continue de fonctionner */ }
const V = 'mm-v5';
const SHELL = ['/', '/avatar.js', '/avatar.webp', '/favicon.png', '/icon-192.png', '/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // pages et scripts : réseau d'abord (toujours la dernière version), cache si hors ligne
  if (r.mode === 'navigate' || u.pathname.endsWith('.js') || u.pathname === '/') {
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(V).then(c => c.put(r.mode === 'navigate' ? '/' : r, cp)); return res; }).catch(() => caches.match(r.mode === 'navigate' ? '/' : r)));
    return;
  }
  // images : cache d'abord (économise les données)
  e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; })));
});
