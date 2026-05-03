// ── Field Tracker Service Worker ──────────────────────────────────
// This SW stays alive even when the browser tab is backgrounded.
// It wakes the page periodically to request a fresh GPS position.

const SW_VERSION = 'v2';
const CACHE_NAME = `field-tracker-${SW_VERSION}`;

// ── Install & Activate ─────────────────────────────────────────────
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Periodic Background Sync ───────────────────────────────────────
// Fires roughly every 1 minute even when the page is backgrounded.
// Note: Chrome Android honours this; iOS Safari has limited support.
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'gps-heartbeat') {
    e.waitUntil(wakePageForGPS());
  }
});

// ── Message from page ──────────────────────────────────────────────
self.addEventListener('message', (e) => {
  if (e.data?.type === 'PING') {
    // Page is asking SW if it's alive
    e.source.postMessage({ type: 'PONG', version: SW_VERSION });
  }
  if (e.data?.type === 'START_HEARTBEAT') {
    // Page started tracking — begin periodic wake-ups
    startPeriodicWakeUp();
  }
  if (e.data?.type === 'STOP_HEARTBEAT') {
    stopPeriodicWakeUp();
  }
});

// ── SW-side fallback wake-up loop ─────────────────────────────────
// When PeriodicSync is not available we keep a SW-internal alarm.
// Service Workers can be killed by the OS but Chrome Android
// typically keeps them alive for an active PWA.
let wakeInterval = null;

function startPeriodicWakeUp() {
  if (wakeInterval) return;
  wakeInterval = setInterval(() => {
    wakePageForGPS();
  }, 45_000); // every 45 seconds
}

function stopPeriodicWakeUp() {
  if (wakeInterval) {
    clearInterval(wakeInterval);
    wakeInterval = null;
  }
}

async function wakePageForGPS() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.length === 0) return; // No open pages — nothing to wake
  for (const client of clients) {
    client.postMessage({ type: 'SW_GET_LOCATION' });
  }
}

// ── Fetch passthrough (no caching needed for API calls) ────────────
self.addEventListener('fetch', (e) => {
  // Let all requests pass through normally
  // We don't cache API/location calls — they must always reach server
  return;
});