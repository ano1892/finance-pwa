// Nama cache untuk menyimpan data offline sederhana
const CACHE_NAME = 'finance-pwa-v1';
const assets = ['/'];

// Proses instalasi service worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assets);
    })
  );
});

// Strategi: Coba ambil dari jaringan dulu, jika gagal gunakan cache
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});