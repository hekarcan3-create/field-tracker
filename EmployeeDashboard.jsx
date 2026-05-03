import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import axios from 'axios';
import { useAuth } from './AuthContext';
import { format } from 'date-fns';

// Fix default leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png', iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png', shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png' });

const myIcon = L.divIcon({
  html: `<div style="width:18px;height:18px;background:#00d4aa;border:3px solid #fff;border-radius:50%;box-shadow:0 0 12px rgba(0,212,170,0.8)"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 9], className: ''
});

function MapCenter({ pos }) {
  const map = useMap();
  useEffect(() => { if (pos) map.setView(pos, 15); }, [pos, map]);
  return null;
}

// Duhok/Zakho center coordinates
const DEFAULT_CENTER = [37.0, 42.8];

// Utility: Haversine formula to calculate distance between two points in metres
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function EmployeeDashboard() {
  const navigate = useNavigate();
  const { user, logout, theme, toggleTheme } = useAuth();
  const [session, setSession] = useState(null);
  const [tracking, setTracking] = useState(false);
  const [positions, setPositions] = useState([]);
  const [currentPos, setCurrentPos] = useState(null);
  const [elapsed, setElapsed] = useState('00:00:00');
  const [status, setStatus] = useState('idle');
  const [heartbeatActive, setHeartbeatActive] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [tab, setTab] = useState('map');
  const watchId = useRef(null);
  const timerRef = useRef(null);
  const watchdogId = useRef(null);
  const lastUpdateRef = useRef(Date.now());
  const wakeLock = useRef(null);
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const swRef = useRef(null);           // ServiceWorker registration
  const pollIntervalRef = useRef(null); // Secondary GPS poll (fallback when watchPosition dies in bg)
  const gapStartRef = useRef(null);     // Timestamp when GPS went silent (for gap reporting)
  const sessionIdRef = useRef(null);    // Keep session id accessible inside SW message callbacks
  const audioTagRef = useRef(null);     // Physical <audio> tag for better iOS persistence
  const videoRef = useRef(null);        // Hidden video for PiP persistence

  // Silent Heartbeat for iOS/Android background persistence
  const startHeartbeat = () => {
    try {
      // 1. AudioContext Heartbeat (Redundancy)
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        if (!audioContextRef.current) audioContextRef.current = new AudioContextClass();
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') ctx.resume();
        const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(ctx.destination);
        source.start();
        audioSourceRef.current = source;
      }

      // 2. Physical Audio Tag (Crucial for iOS)
      if (audioTagRef.current) {
        audioTagRef.current.play().catch(err => console.warn('Audio tag play failed:', err));
      }

      // 3. MediaSession API - Critical for keeping process alive on iOS/Android
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Location Tracking Active',
          artist: 'Avail Co. Field System',
          album: 'Background Engine',
          artwork: [{ src: '/icon.png', sizes: '512x512', type: 'image/png' }]
        });

        navigator.mediaSession.playbackState = 'playing';

        // Dummy handlers to satisfy OS requirements
        const resumeAudio = () => {
          if (audioContextRef.current?.state === 'suspended') audioContextRef.current.resume();
          if (audioTagRef.current) audioTagRef.current.play().catch(() => { });
        };

        navigator.mediaSession.setActionHandler('play', resumeAudio);
        navigator.mediaSession.setActionHandler('pause', () => {
          console.log('iOS tried to pause - restarting heartbeat');
          resumeAudio();
        });

        // Resilience: Handle physical audio tag events
        if (audioTagRef.current) {
          audioTagRef.current.onpause = () => {
            if (tracking) {
              console.log('Audio paused by OS - resuming...');
              audioTagRef.current.play().catch(() => {});
            }
          };
          // Piggyback GPS requests onto the audio heartbeat
          // This ensures that even if setInterval is throttled, 
          // the audio thread keeps triggering our location logic.
          audioTagRef.current.onplay = () => {
            if (tracking) {
              const sid = sessionIdRef.current;
              if (sid) {
                const stale = Date.now() - lastUpdateRef.current > 40_000;
                if (stale) {
                  console.log('Heartbeat trigger: Refreshing GPS');
                  navigator.geolocation.getCurrentPosition(() => {}, () => {}, { enableHighAccuracy: true });
                }
              }
            }
          };
          // Set volume to very low but NOT zero
          audioTagRef.current.volume = 0.02;
        }
      }

      console.log('Heartbeat engine active');
      setHeartbeatActive(true);

      // Trigger Picture-in-Picture if supported (The "Golden Rule" for iOS persistence)
      if (videoRef.current && videoRef.current.requestPictureInPicture) {
        videoRef.current.play().then(() => {
          videoRef.current.requestPictureInPicture().catch(err => {
            console.warn('PiP request failed:', err);
          });
        }).catch(() => {});
      }

      if (audioTagRef.current) {
        audioTagRef.current.onended = () => {
          if (tracking) audioTagRef.current.play().catch(() => {});
        };
      }

      // Advanced iOS Nudge: Simulate a live broadcast position to keep process high-priority
      if (watchdogId.current) clearInterval(watchdogId.current);
      watchdogId.current = setInterval(() => {
        if (tracking) {
          // 1. Update MediaSession position to simulate activity
          if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
            try {
              navigator.mediaSession.setPositionState({
                duration: 3600,
                playbackRate: 1.0,
                position: Math.floor((Date.now() % 3600000) / 1000)
              });
            } catch { }
          }

          // 2. GPS "Hammer" - If silent for > 90s, completely kill and restart GPS
          const timeSinceLast = Date.now() - lastUpdateRef.current;
          if (timeSinceLast > 90_000) {
            console.log('GPS Hammer: Resetting hardware watch...');
            retryGPS();
          }
        }
      }, 30000);
    } catch (e) {
      console.error('Heartbeat failed:', e);
    }
  };

  const stopHeartbeat = () => {
    if (watchdogId.current) {
      clearInterval(watchdogId.current);
      watchdogId.current = null;
    }
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch { }
      audioSourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.onstatechange = null;
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
    }
  };

  // Wake Lock API logic
  const requestWakeLock = async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      if (wakeLock.current) return;
      wakeLock.current = await navigator.wakeLock.request('screen');
      console.log('☀️ Wake Lock is active');
      wakeLock.current.addEventListener('release', () => {
        console.log('🌑 Wake Lock was released');
        wakeLock.current = null;
      });
    } catch (err) {
      console.error(`Wake Lock Error: ${err.name}, ${err.message}`);
    }
  };

  const releaseWakeLock = useCallback(() => {
    if (wakeLock.current) {
      wakeLock.current.release();
      wakeLock.current = null;
    }
  }, []);

  // Resilience: Re-acquire everything when app returns to foreground
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (tracking && document.visibilityState === 'visible') {
        console.log('🔄 App returned to foreground — refreshing tracking...');
        await requestWakeLock();
        startHeartbeat();

        // Nudge the Service Worker to stay alive
        if (swRef.current?.active) {
          swRef.current.active.postMessage({ type: 'START_HEARTBEAT' });
        }

        // Immediately get a fresh fix — don't wait for watchPosition to wake up
        const sid = sessionIdRef.current;
        if (sid) {
          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              const { latitude: lat, longitude: lng, accuracy, speed, heading } = pos.coords;
              lastUpdateRef.current = Date.now();

              if (gapStartRef.current) {
                const gapSec = Math.round((Date.now() - gapStartRef.current) / 1000);
                gapStartRef.current = null;
                try { await axios.post('/api/location/gap', { session_id: sid, gap_type: 'resumed', duration_seconds: gapSec }); } catch { }
              }

              setCurrentPos([lat, lng]);
              setPositions(prev => [...prev, [lat, lng]]);
              setStatus('active');
              try {
                await axios.post('/api/location', { lat, lng, accuracy: accuracy || 0, speed: speed || 0, heading: heading || 0, session_id: sid });
              } catch { }
            },
            () => { },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
          );
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [tracking]);

  // ── Sync session id into ref so SW message handler can access it ──
  useEffect(() => {
    sessionIdRef.current = session?.id || null;
    if (session?.id && swRef.current?.active) {
      swRef.current.active.postMessage({ type: 'START_HEARTBEAT' });
    }
  }, [session]);

  // ── Register Service Worker & listen for background wake-up msgs ──
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(async (reg) => {
        swRef.current = reg;
        console.log('✅ SW registered');
        // Register periodic background sync if the browser supports it (Chrome Android)
        if ('periodicSync' in reg) {
          try {
            const perm = await navigator.permissions.query({ name: 'periodic-background-sync' });
            if (perm.state === 'granted') {
              await reg.periodicSync.register('gps-heartbeat', { minInterval: 60_000 });
              console.log('✅ Periodic Background Sync registered');
            }
          } catch { /* not supported, SW internal timer handles it */ }
        }
      })
      .catch(err => console.warn('SW registration failed:', err));

    // The SW sends SW_GET_LOCATION when it wakes up in the background.
    // We respond by getting a fresh GPS fix and POSTing it to the server.
    const handleSWMessage = async (event) => {
      if (event.data?.type !== 'SW_GET_LOCATION') return;
      
      // If we are in the background, this message is a lifeline.
      // We must be quick before the OS suspends us again.
      const sid = sessionIdRef.current;
      if (!sid) return;

      console.log('🛰️ SW heartbeat received, getting location...');

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude: lat, longitude: lng, accuracy, speed, heading } = pos.coords;
          lastUpdateRef.current = Date.now();

          setCurrentPos([lat, lng]);
          setPositions(prev => [...prev, [lat, lng]]);
          setStatus('active');
          try {
            await axios.post('/api/location', { lat, lng, accuracy: accuracy || 0, speed: speed || 0, heading: heading || 0, session_id: sid });
          } catch { }
        },
        (err) => console.warn('SW-triggered GPS fail:', err.message),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    };

    navigator.serviceWorker.addEventListener('message', handleSWMessage);
    
    // Periodically ping the SW to keep it alive
    const swPingId = setInterval(() => {
      if (tracking && swRef.current?.active) {
        swRef.current.active.postMessage({ type: 'START_HEARTBEAT' });
      }
    }, 60000);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      clearInterval(swPingId);
    };
  }, [tracking]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check permission state and request if needed
  const checkAndRequestPermission = async () => {
    if (!navigator.geolocation) {
      setStatus('unsupported');
      return false;
    }

    // Try to trigger permission prompt by requesting one-time position
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => {
          // Permission granted - also check notifications
          if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
          }
          resolve(true);
        },
        (err) => {
          if (err.code === 1) {
            setStatus('denied');
          } else if (err.code === 2) {
            setStatus('unavailable');
          } else {
            setStatus('timeout');
          }
          resolve(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  };

  useEffect(() => {
    checkExistingSession();
    return () => {
      if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (watchdogId.current) clearInterval(watchdogId.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const checkExistingSession = async () => {
    try {
      const res = await axios.get('/api/session/status');
      console.log('[Employee] Session status:', res.data);
      if (res.data.active) {
        setSession(res.data.session);
        setTracking(true);
        const startTime = res.data.session.start_time;
        console.log('[Employee] Session start_time:', startTime, 'Parsed:', new Date(startTime));
        startTimer(new Date(startTime));
        await loadHistory();
        await loadActivityFromServer();

        // Check GPS permission when resuming session
        const hasPermission = await checkAndRequestPermission();
        if (hasPermission) {
          startGPS(res.data.session.id);
          startWatchdog(res.data.session.id);
          startSecondaryPoll(res.data.session.id);
          requestWakeLock();
          // NOTE: We do NOT call startHeartbeat() here because iOS blocks it without a user click.
          // The user will see a "Enable Background Tracking" button to start it manually.
        }
      }
    } catch (err) {
      console.error('[Employee] Failed to check session:', err);
    }
  };

  // FIX: load today's activity log from the server when resuming
  const loadActivityFromServer = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await axios.get(`/api/activity/me?date=${today}&limit=50`);
      if (res.data && res.data.length > 0) {
        const logs = res.data.map(item => ({
          time: format(new Date(item.timestamp), 'HH:mm:ss'),
          msg: item.type === 'check_in'
            ? '✅ Work day started — tracking enabled'
            : item.type === 'check_out'
              ? '🏁 Work day ended'
              : `📍 Location recorded`,
          type: item.type === 'check_in' || item.type === 'check_out' ? 'system' : 'location'
        }));
        setActivityLog(logs);
      }
    } catch { }
  };

  const loadHistory = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await axios.get(`/api/location/history/me?date=${today}`);
      const pts = res.data.map(l => [l.lat, l.lng]);
      setPositions(pts);
      if (pts.length) setCurrentPos(pts[pts.length - 1]);
    } catch { }
  };

  const startTimer = (startTime) => {
    if (timerRef.current) clearInterval(timerRef.current);
    // Ensure startTime is a Date object - append Z to treat as UTC if not already
    let start;
    if (startTime instanceof Date) {
      start = startTime;
    } else {
      // PostgreSQL returns timestamp without timezone, treat as UTC by appending Z
      const timeStr = typeof startTime === 'string' && !startTime.endsWith('Z')
        ? startTime + 'Z'
        : startTime;
      start = new Date(timeStr);
    }
    console.log('[Timer] Starting timer with start:', start, 'Now:', new Date());
    timerRef.current = setInterval(() => {
      const now = new Date();
      const diff = now.getTime() - start.getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setElapsed(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    }, 1000);
  };

  // ── Secondary GPS polling loop ─────────────────────────────────────
  // watchPosition gets killed by mobile OSes when the app is backgrounded.
  // This secondary loop calls getCurrentPosition every 30 seconds as a
  // fallback. It only fires when watchPosition hasn't reported in 25s,
  // so it doesn't double-send when watchPosition is working normally.
  const startSecondaryPoll = useCallback((sessionId) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(() => {
      const stale = Date.now() - lastUpdateRef.current > 25_000;
      if (!stale) return; // watchPosition is alive, skip

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude: lat, longitude: lng, accuracy, speed, heading } = pos.coords;
          lastUpdateRef.current = Date.now();

          if (gapStartRef.current) {
            const gapSec = Math.round((Date.now() - gapStartRef.current) / 1000);
            gapStartRef.current = null;
            try { await axios.post('/api/location/gap', { session_id: sessionId, gap_type: 'resumed', duration_seconds: gapSec }); } catch { }
          }

          setCurrentPos([lat, lng]);
          setPositions(prev => [...prev, [lat, lng]]);
          setStatus('active');
          try {
            await axios.post('/api/location', {
              lat, lng, accuracy: accuracy || 0, speed: speed || 0, heading: heading || 0, session_id: sessionId
            });
            const time = format(new Date(), 'HH:mm:ss');
            setActivityLog(prev => [
              { time, msg: `📍 Location recorded — ${parseFloat(lat).toFixed(5)}, ${parseFloat(lng).toFixed(5)}`, type: 'location' },
              ...prev.slice(0, 49)
            ]);
          } catch { }
        },
        (err) => console.warn('Secondary poll failed:', err.message),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 20000 }
      );
    }, 30_000); // every 30 seconds
  }, []);

  const startGPS = useCallback((sessionId) => {
    if (!navigator.geolocation) {
      setStatus('unsupported');
      return;
    }
    setStatus('locating');
    let lastPos = null;
    const MIN_DISTANCE = 5; // metres

    watchId.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng, accuracy, speed, heading } = pos.coords;
        lastUpdateRef.current = Date.now();

        // Only record if moved at least MIN_DISTANCE metres
        if (lastPos) {
          const dist = calculateDistance(lastPos.lat, lastPos.lng, lat, lng);
          if (dist < MIN_DISTANCE) return;
        }
        lastPos = { lat, lng };

        setCurrentPos([lat, lng]);
        setPositions(prev => [...prev, [lat, lng]]);
        setStatus('active');

        try {
          await axios.post('/api/location', {
            lat, lng,
            accuracy: accuracy || 0,
            speed: speed || 0,
            heading: heading || 0,
            session_id: sessionId
          });
          const time = format(new Date(), 'HH:mm:ss');
          setActivityLog(prev => [
            { time, msg: `📍 Location recorded — ${parseFloat(lat).toFixed(5)}, ${parseFloat(lng).toFixed(5)}`, type: 'location' },
            ...prev.slice(0, 49)
          ]);
        } catch (err) {
          console.error('Location update failed:', err);
          setActivityLog(prev => [
            { time: format(new Date(), 'HH:mm:ss'), msg: '⚠️ Failed to send location — retrying...', type: 'error' },
            ...prev.slice(0, 49)
          ]);
        }
      },
      (err) => {
        console.warn(`GPS Watch Error (${err.code}): ${err.message}`);
        if (err.code === 1) {
          setStatus('denied');
        } else if (err.code === 2) {
          setStatus('unavailable');
        } else {
          setStatus('timeout');
        }

        // Resilience: If timeout occurs, the watch might have been dropped by OS
        // We'll try to restart it once if we are still in a tracking session
        if (err.code === 3 && tracking) {
          console.log('🛰️ GPS Timeout - Attempting to restart watch...');
          retryGPS();
        }

        setActivityLog(prev => [
          { time: format(new Date(), 'HH:mm:ss'), msg: `⚠️ GPS error: ${err.message}`, type: 'error' },
          ...prev.slice(0, 49)
        ]);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 30000
      }
    );
  }, [tracking]);

  const startWatchdog = (sessionId) => {
    if (watchdogId.current) clearInterval(watchdogId.current);

    watchdogId.current = setInterval(async () => {
      const timeSinceLast = Date.now() - lastUpdateRef.current;

      if (timeSinceLast > 180_000) {
        console.log(`🐕 GPS gap: no update for ${Math.round(timeSinceLast / 60000)} min`);

        // Log gap to server once (not on every watchdog tick)
        if (!gapStartRef.current) {
          gapStartRef.current = lastUpdateRef.current;
          try {
            await axios.post('/api/location/gap', { session_id: sessionId, gap_type: 'lost' });
          } catch { }
        }

        // Try to wake the GPS sensor directly
        navigator.geolocation.getCurrentPosition(
          () => { console.log('🐕 Watchdog: sensor woke'); },
          (err) => { console.warn('🐕 Watchdog wake fail:', err.message); },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );

        // Nudge the Service Worker to also try from its process
        if (swRef.current?.active) {
          swRef.current.active.postMessage({ type: 'START_HEARTBEAT' });
        }
      }
    }, 120_000); // check every 2 minutes
  };

  const retryGPS = async () => {
    if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
    // First check permission with one-time request
    const hasPermission = await checkAndRequestPermission();
    if (hasPermission && session) {
      startGPS(session.id);
    }
  };


  const handleStartDay = async () => {
    // First check/request GPS permission before starting session
    setStatus('locating');
    const hasPermission = await checkAndRequestPermission();

    if (!hasPermission) {
      console.log('[Employee] GPS permission not granted, but allowing session start');
    } else {
      console.log('[Employee] GPS permission granted');
    }

    try {
      const res = await axios.post('/api/session/start');
      console.log('[Employee] Session started:', res.data);
      setSession(res.data.session);
      setTracking(true);
      const startTime = res.data.session.start_time;
      console.log('[Employee] New session start_time:', startTime, 'Now:', new Date(), 'Parsed:', new Date(startTime));
      startTimer(new Date(startTime));

      if (hasPermission) {
        startGPS(res.data.session.id);
        startWatchdog(res.data.session.id);
        startSecondaryPoll(res.data.session.id);
        requestWakeLock();
        startHeartbeat();
      }

      const entry = { time: format(new Date(), 'HH:mm:ss'), msg: '✅ Work day started — tracking enabled', type: 'system' };
      setActivityLog([entry]);
    } catch (e) {
      console.error('[Employee] Failed to start session:', e);
      alert('Could not start session: ' + (e.response?.data?.error || e.message));
    }
  };

  const handleEndDay = async () => {
    if (!confirm('End your work day and stop tracking?')) return;
    try {
      await axios.post('/api/session/end');
      if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (watchdogId.current) clearInterval(watchdogId.current);
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
      gapStartRef.current = null;
      if (audioTagRef.current) {
        audioTagRef.current.onpause = null;
        audioTagRef.current.pause();
        audioTagRef.current.currentTime = 0;
      }
      if (swRef.current?.active) swRef.current.active.postMessage({ type: 'STOP_HEARTBEAT' });
      setHeartbeatActive(false);
      setTracking(false);
      setSession(null);
      setStatus('idle');
      setElapsed('00:00:00');
      setActivityLog(prev => [
        { time: format(new Date(), 'HH:mm:ss'), msg: '🏁 Work day ended', type: 'system' },
        ...prev
      ]);
    } catch { }
  };

  const mapCenter = currentPos || DEFAULT_CENTER;

  return (
    <div style={styles.page}>
      {/* Top Bar */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logoMark}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
          </div>
          <div>
            <div style={styles.headerTitle}>Avail Co.</div>
            <div style={styles.headerSub}>Employee Portal</div>
          </div>
        </div>
        <div style={styles.headerRight}>
          <button
            onClick={toggleTheme}
            style={styles.themeToggle}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <div style={styles.userInfo}>
            <div style={styles.avatar}>{user?.name?.charAt(0)}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>{user?.department}</div>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => { logout(); navigate('/login'); }}>Sign Out</button>
        </div>
      </header>

      <div style={styles.content}>
        {/* Status Card */}
        <div style={styles.statusCard} className="card">
          <div style={styles.statusLeft}>
            <div style={{ ...styles.statusDot, background: tracking ? 'var(--success)' : 'var(--text2)' }} className={tracking ? 'animate-pulse' : ''} />
            <div>
              <div style={styles.statusLabel}>{tracking ? 'Tracking Active' : 'Not Tracking'}</div>
              <div style={styles.statusTime}>
                {tracking ? `Time Elapsed: ` : 'Press the button to start your work day'}
                {tracking && <span style={styles.timer}>{elapsed}</span>}
              </div>
            </div>
          </div>
          <div style={styles.statusActions}>
            {tracking && (
              <div style={styles.gpsStatus}>
                <div style={{
                  ...styles.gpsDot,
                  background: status === 'active' ? 'var(--success)'
                    : status === 'locating' ? 'var(--warning)'
                      : 'var(--danger)'
                }} className={status === 'locating' ? 'animate-pulse' : ''} />
                <span style={{ fontSize: 11 }}>
                  {status === 'active' ? 'GPS Active'
                    : status === 'locating' ? 'Acquiring GPS…'
                      : status === 'denied' ? 'Location blocked'
                        : status === 'unavailable' ? 'GPS unavailable'
                          : status === 'timeout' ? 'GPS timeout'
                            : status === 'unsupported' ? 'GPS not supported'
                              : 'GPS error'}
                </span>
              </div>
            )}
            {tracking && heartbeatActive && (
              <div style={styles.heartbeatBadge}>
                <div className="animate-ping" style={styles.heartbeatPing} />
                <span>Engine Active</span>
              </div>
            )}
            {!tracking ? (
              <button className="btn btn-primary btn-lg" onClick={handleStartDay}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" /><polyline points="12 8 16 12 12 16" /><line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                Start Work Day
              </button>
            ) : (
              <button className="btn btn-danger" onClick={handleEndDay}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                </svg>
                End Work Day
              </button>
            )}
          </div>
        </div>

        {/* iOS Resume Engine Call-to-Action */}
        {tracking && !heartbeatActive && (
          <div style={styles.resumeBanner}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 4 }}>
                ⚠️ Background Tracking Paused
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>
                iOS requires a manual tap to enable background tracking.
              </div>
            </div>
            <button className="btn btn-primary" onClick={startHeartbeat} style={{ background: '#fff', color: '#ff4757', fontWeight: 700 }}>
              Enable Now
            </button>
          </div>
        )}

        {/* GPS denied / error banner */}
        {tracking && (status === 'denied' || status === 'unavailable' || status === 'timeout' || status === 'unsupported') && (
          <div style={styles.gpsBanner}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{ fontSize: 28, flexShrink: 0 }}>
                {status === 'denied' ? '🔒' : status === 'unsupported' ? '📵' : '📡'}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
                  {status === 'denied' && '⚠️ Location Access Blocked'}
                  {status === 'unavailable' && 'GPS Signal Unavailable'}
                  {status === 'timeout' && 'GPS Timed Out'}
                  {status === 'unsupported' && 'GPS Not Supported'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
                  {status === 'denied' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ background: 'var(--surface2)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--warning)' }}>
                          📍 To enable location tracking:
                        </div>
                        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 2 }}>
                          <li>Look for the <b>🔒 lock icon</b> at the top of your browser</li>
                          <li>Click it and select <b>"Site settings"</b> or <b>"Permissions"</b></li>
                          <li>Find <b>Location</b> and change it to <b>"Allow"</b></li>
                          <li>Come back to this page and click <b>"Retry GPS"</b> below</li>
                        </ol>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text2)', fontStyle: 'italic' }}>
                        💡 Tip: On mobile, go to Settings → Privacy → Location Services → enable for your browser
                      </div>
                    </div>
                  )}
                  {status === 'unavailable' && 'GPS signal could not be obtained. Make sure you are outdoors or have location services enabled on your device.'}
                  {status === 'timeout' && 'GPS took too long to respond. You may be indoors or have a weak signal.'}
                  {status === 'unsupported' && 'Your browser does not support GPS. Try Chrome, Safari, or Firefox on a mobile device.'}
                </div>
              </div>
            </div>
            {status !== 'unsupported' && (
              <button className="btn btn-primary" style={{ marginTop: 16, alignSelf: 'flex-start', padding: '10px 20px' }} onClick={retryGPS}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                  <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                Retry GPS
              </button>
            )}
          </div>
        )}

        {/* Background Tracking Guide */}
        {tracking && (
          <div style={styles.guideBox}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              Keep Tracking in Background
            </div>
            <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>
              To ensure the system tracks you even when the screen is off:
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                <li>Keep this tab open in your browser.</li>
                <li>Do not force-close the browser app.</li>
                <li><b>Android:</b> Long-press browser icon → (i) App Info → Battery → Set to <b>"Unrestricted"</b>.</li>
                <li><b>iOS:</b> Disable <b>"Low Power Mode"</b> and keep browser in foreground if possible.</li>
                <li><b>PWA:</b> Open the app from the home screen shortcut for better reliability.</li>
              </ul>
            </div>
          </div>
        )}

        {/* Point count banner */}
        {tracking && positions.length > 0 && (
          <div style={styles.pointsBanner}>
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{positions.length}</span>
            <span style={{ color: 'var(--text2)', fontSize: 12 }}> location points recorded today</span>
          </div>
        )}

        {/* Tabs */}
        <div style={styles.tabs}>
          {['map', 'activity'].map(t => (
            <button key={t} style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }} onClick={() => setTab(t)}>
              {t === 'map' ? '🗺️ My Route Map' : `📋 Activity Log${activityLog.length > 0 ? ` (${activityLog.length})` : ''}`}
            </button>
          ))}
        </div>

        {tab === 'map' && (
          <div style={styles.mapWrapper}>
            <MapContainer center={mapCenter} zoom={14} style={styles.map}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
              <MapCenter pos={currentPos} />
              {positions.length > 1 && <Polyline positions={positions} color="#00d4aa" weight={3} opacity={0.8} />}
              {currentPos && (
                <Marker position={currentPos} icon={myIcon}>
                  <Popup>
                    <div style={{ fontFamily: 'var(--font)', padding: 4 }}>
                      <strong style={{ color: 'var(--accent)' }}>{user?.name}</strong><br />
                      <small style={{ color: 'var(--text2)' }}>Current Position</small><br />
                      <small>{parseFloat(currentPos[0]).toFixed(5)}, {parseFloat(currentPos[1]).toFixed(5)}</small>
                    </div>
                  </Popup>
                </Marker>
              )}
            </MapContainer>
            {positions.length > 0 && (
              <div style={styles.mapStats}>
                <div style={styles.mapStat}>
                  <span style={styles.mapStatNum}>{positions.length}</span>
                  <span style={styles.mapStatLabel}>Points</span>
                </div>
                <div style={styles.mapStat}>
                  <span style={styles.mapStatNum}>{currentPos ? parseFloat(currentPos[0]).toFixed(4) : '—'}</span>
                  <span style={styles.mapStatLabel}>Latitude</span>
                </div>
                <div style={styles.mapStat}>
                  <span style={styles.mapStatNum}>{currentPos ? parseFloat(currentPos[1]).toFixed(4) : '—'}</span>
                  <span style={styles.mapStatLabel}>Longitude</span>
                </div>
              </div>
            )}
            {!tracking && positions.length === 0 && (
              <div style={styles.mapEmptyOverlay}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📍</div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>No route data yet</div>
                <div style={{ fontSize: 12, color: 'var(--text2)' }}>Start your work day to begin tracking your route</div>
              </div>
            )}
          </div>
        )}

        {tab === 'activity' && (
          <div style={styles.activityList} className="card">
            <h3 style={{ marginBottom: 16, fontSize: 15 }}>Today's Activity</h3>
            {activityLog.length === 0 ? (
              <div style={styles.empty}>No activity yet. Start your work day to begin tracking.</div>
            ) : activityLog.map((item, i) => (
              <div key={i} style={{
                ...styles.activityItem,
                borderLeftColor: item.type === 'system' ? 'var(--accent)' : item.type === 'error' ? 'var(--danger)' : 'var(--border)'
              }}>
                <span style={styles.activityTime}>{item.time}</span>
                <span style={styles.activityMsg}>{item.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <audio
        ref={audioTagRef}
        loop
        playsInline
        muted={false}
        style={{ display: 'none' }}
        src="data:audio/wav;base64,UklGRmYAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhIAAAAP7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v4="
      />
      <video
        ref={videoRef}
        loop
        muted
        playsInline
        style={{ position: 'fixed', bottom: 0, right: 0, width: 1, height: 1, opacity: 0.01, pointerEvents: 'none' }}
        src="https://www.w3schools.com/html/mov_bbb.mp4"
      />
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: 'var(--bg)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 100, flexWrap: 'wrap', gap: '10px' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  logoMark: { width: 32, height: 32, background: 'var(--accent)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', flexShrink: 0 },
  headerTitle: { fontSize: 14, fontWeight: 700 },
  headerSub: { fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  themeToggle: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text)', transition: 'all 0.2s', flexShrink: 0 },
  userInfo: { display: 'flex', alignItems: 'center', gap: 8 },
  avatar: { width: 30, height: 30, background: 'var(--accent2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 },
  content: { padding: '12px', maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 },
  statusCard: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', flexWrap: 'wrap', gap: '12px' },
  statusLeft: { display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: '200px' },
  statusDot: { width: 12, height: 12, borderRadius: '50%', flexShrink: 0 },
  statusLabel: { fontSize: 14, fontWeight: 600 },
  statusTime: { fontSize: 12, color: 'var(--text2)', marginTop: 2 },
  timer: { fontFamily: 'var(--mono)', color: 'var(--accent)', fontSize: 14, fontWeight: 700, marginLeft: 4 },
  statusActions: { display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 },
  gpsBanner: { background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.35)', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column' },
  gpsStatus: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text2)' },
  gpsDot: { width: 8, height: 8, borderRadius: '50%' },
  pointsBanner: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 },
  tabs: { display: 'flex', gap: 6, background: 'var(--surface)', padding: 5, borderRadius: 8, border: '1px solid var(--border)', width: '100%', maxWidth: 'fit-content' },
  tab: { padding: '8px 14px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text2)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 12, fontWeight: 500, transition: 'all 0.2s', flex: 1, minWidth: '80px' },
  tabActive: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' },
  mapWrapper: { borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', position: 'relative' },
  map: { height: 'clamp(300px, 50vh, 460px)', width: '100%', minHeight: '250px' },
  mapStats: { background: 'var(--surface)', padding: '10px 14px', display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'space-around' },
  mapStat: { display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' },
  mapStatNum: { fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--accent)' },
  mapStatLabel: { fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  mapEmptyOverlay: { background: 'var(--surface)', padding: '40px 20px', textAlign: 'center', fontSize: 14 },
  activityList: { padding: 16 },
  activityItem: { display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--border)', paddingLeft: 10, alignItems: 'flex-start' },
  activityTime: { fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', flexShrink: 0, marginTop: 1, minWidth: '50px' },
  activityMsg: { fontSize: 12, color: 'var(--text2)', wordBreak: 'break-word' },
  empty: { color: 'var(--text2)', fontSize: 12, textAlign: 'center', padding: '30px 0' },
  guideBox: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' },
  resumeBanner: { background: 'linear-gradient(135deg, #ff4757, #ff6b81)', borderRadius: 12, padding: '16px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, boxShadow: '0 4px 15px rgba(255,71,87,0.3)' },
  heartbeatBadge: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', background: 'rgba(0,212,170,0.1)', borderRadius: 20, color: 'var(--success)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', border: '1px solid rgba(0,212,170,0.2)' },
  heartbeatPing: { width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' },
};