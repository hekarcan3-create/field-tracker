// ── Field Tracker Service Worker ──────────────────────────────────
// This SW stays alive even when the browser tab is backgrounded.
// It wakes the page periodically to request a fresh GPS position.

const SW_VERSION = 'v3';
const CACHE_NAME = `field-tracker-${SW_VERSION}`;
const TRACKING_KEY = 'is-tracking-active';

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
  
  // Re-start heartbeat if it was active before SW restart
  e.waitUntil(checkAndResumeTracking());
});

// ── Persistence Logic ─────────────────────────────────────────────
async function setTrackingState(active) {
  const cache = await caches.open('tracking-meta');
  if (active) {
    await cache.put('/status', new Response('active'));
  } else {
    await cache.delete('/status');
  }
}

async function checkAndResumeTracking() {
  const cache = await caches.open('tracking-meta');
  const res = await cache.match('/status');
  if (res) {
    console.log('[SW] Resuming heartbeat after restart');
    startPeriodicWakeUp();
  }
}

// ── Periodic Background Sync ───────────────────────────────────────
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'gps-heartbeat') {
    e.waitUntil(wakePageForGPS());
  }
});

// ── Background Sync (Fallback) ────────────────────────────────────
self.addEventListener('sync', (e) => {
  if (e.tag === 'gps-sync' || e.tag === 'gps-heartbeat') {
    e.waitUntil(wakePageForGPS());
  }
});

// ── Message from page ──────────────────────────────────────────────
self.addEventListener('message', (e) => {
  if (e.data?.type === 'PING') {
    e.source.postMessage({ type: 'PONG', version: SW_VERSION });
  }
  if (e.data?.type === 'START_HEARTBEAT') {
    setTrackingState(true);
    startPeriodicWakeUp();
  }
  if (e.data?.type === 'STOP_HEARTBEAT') {
    setTrackingState(false);
    stopPeriodicWakeUp();
  }
});

// ── SW-side fallback wake-up loop ─────────────────────────────────
let wakeInterval = null;

function startPeriodicWakeUp() {
  if (wakeInterval) return;
  console.log('[SW] Starting heartbeat interval');
  // Use a slightly varied interval to avoid OS patterns
  wakeInterval = setInterval(() => {
    wakePageForGPS();
  }, 35_000); // every 35 seconds
}

function stopPeriodicWakeUp() {
  if (wakeInterval) {
    clearInterval(wakeInterval);
    wakeInterval = null;
    console.log('[SW] Stopped heartbeat interval');
  }
}

async function wakePageForGPS() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  
  if (clients.length === 0) {
    // If no window is open, we might want to show a notification to the user
    // to remind them to keep the app open in background (on Android)
    return;
  }

  for (const client of clients) {
    // Try to focus/wake if possible (though limited)
    client.postMessage({ type: 'SW_GET_LOCATION', timestamp: Date.now() });
  }
}

// ── Fetch passthrough ──────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  // We can use fetch events to kick the heartbeat if it's dead
  if (wakeInterval === null) {
    e.waitUntil(checkAndResumeTracking());
  }
  return;
});