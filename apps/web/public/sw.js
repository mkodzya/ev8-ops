// Minimal service worker: makes the app installable to a home screen.
// Network-only on purpose — stage 1 has no offline cache; forms keep their
// drafts locally (spec §8) and that is done in the app, not here.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
