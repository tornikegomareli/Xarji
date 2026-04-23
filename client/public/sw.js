// Minimal service worker — exists primarily to satisfy Chromium's
// installability gate (Chrome / Arc / Edge / Brave require a registered
// SW with a fetch handler before they'll show "Install Xarji…").
//
// We deliberately do not cache anything: the dashboard depends on a
// running local xarji-core for both /api and the React bundle, so a
// stale cache would actively confuse the user (showing yesterday's
// transactions while today's service is down). Pass-through only.

self.addEventListener("install", () => {
  // Activate immediately on first install so we don't sit in "waiting".
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of any tabs already open at install time.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Network-only pass-through. The browser handles errors normally,
  // which means the unreachable-service splash in Layout.tsx still
  // gets a chance to render when /api/health fails.
  event.respondWith(fetch(event.request));
});
