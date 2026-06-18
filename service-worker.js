/* Service worker minimal : met l'appli en cache pour un usage hors-ligne. */
var CACHE = "marge-galerie-v1";
var ASSETS = ["./simulateur.html", "./manifest.webmanifest", "./icon.svg"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request); }));
});
