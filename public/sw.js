/*
 * SyncBiz minimal service worker.
 *
 * Purpose: satisfy PWA installability (so the app can be added to the home
 * screen and registered as a Web Share Target) — nothing more.
 *
 * Deliberately does NOT cache anything: no app shell, no audio/video, no API
 * responses, no tokens. Every request goes straight to the network so there is
 * zero risk of serving stale builds or leaking sensitive data from a cache. If
 * offline app-shell caching is wanted later, add it here carefully (static
 * assets only).
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// A fetch handler is required for installability. Pure network passthrough.
self.addEventListener("fetch", () => {
  // Intentionally do not call event.respondWith — the browser handles the
  // request normally (network), with no caching.
});
