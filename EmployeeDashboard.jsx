import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import axios from 'axios';
import { useAuth } from './AuthContext';
import { format } from 'date-fns';

// Fix default leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ 
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png', 
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png', 
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png' 
});

const myIcon = L.divIcon({
  html: '<div style="width:18px;height:18px;background:#00d4aa;border:3px solid #fff;border-radius:50%;box-shadow:0 0 12px rgba(0,212,170,0.8)"></div>',
  iconSize: [18, 18], iconAnchor: [9, 9], className: ''
});

function MapCenter({ pos }) {
  const map = useMap();
  useEffect(() => { if (pos) map.setView(pos, 15); }, [pos, map]);
  return null;
}

const DEFAULT_CENTER = [37.0, 42.8];

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
  const swRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const gapStartRef = useRef(null);
  const sessionIdRef = useRef(null);
  const audioTagRef = useRef(null);
  const videoRef = useRef(null);

  const startHeartbeat = () => {
    try {
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

      if (audioTagRef.current) {
        audioTagRef.current.play().catch(() => {});
      }

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Location Tracking Active',
          artist: 'Avail Co. Field System',
          album: 'Background Engine',
          artwork: [{ src: '/icon.png', sizes: '512x512', type: 'image/png' }]
        });
        navigator.mediaSession.playbackState = 'playing';
        
        navigator.mediaSession.setActionHandler('play', () => {
          if (audioTagRef.current) audioTagRef.current.play();
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          if (audioTagRef.current) audioTagRef.current.play();
        });
      }

      setHeartbeatActive(true);

      if (videoRef.current && videoRef.current.requestPictureInPicture) {
        videoRef.current.play().then(() => {
          videoRef.current.requestPictureInPicture().catch(() => {});
        }).catch(() => {});
      }

      if (watchdogId.current) clearInterval(watchdogId.current);
      watchdogId.current = setInterval(() => {
        if (tracking) {
          if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
            try {
              navigator.mediaSession.setPositionState({
                duration: 3600,
                playbackRate: 1.0,
                position: Math.floor((Date.now() % 3600000) / 1000)
              });
            } catch { }
          }
          const timeSinceLast = Date.now() - lastUpdateRef.current;
          if (timeSinceLast > 90_000) retryGPS();
        }
      }, 30000);
    } catch (e) {
      console.error('Heartbeat failed:', e);
    }
  };

  const stopHeartbeat = () => {
    if (watchdogId.current) clearInterval(watchdogId.current);
    if (audioSourceRef.current) try { audioSourceRef.current.stop(); } catch { }
    if (audioContextRef.current) audioContextRef.current.close();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  };

  const requestWakeLock = async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock.current = await navigator.wakeLock.request('screen');
    } catch { }
  };

  const startGPS = useCallback((sessionId) => {
    if (!navigator.geolocation) return setStatus('unsupported');
    setStatus('locating');
    let lastPos = null;
    watchId.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng, accuracy, speed, heading } = pos.coords;
        lastUpdateRef.current = Date.now();
        if (lastPos && calculateDistance(lastPos.lat, lastPos.lng, lat, lng) < 5) return;
        lastPos = { lat, lng };
        setCurrentPos([lat, lng]);
        setPositions(prev => [...prev, [lat, lng]]);
        setStatus('active');
        
        const payload = JSON.stringify({ lat, lng, accuracy: accuracy || 0, speed: speed || 0, heading: heading || 0, session_id: sessionId });
        if (navigator.sendBeacon) navigator.sendBeacon('/api/location', payload);
        else axios.post('/api/location', JSON.parse(payload)).catch(() => {});

        if (Notification.permission === 'granted' && navigator.serviceWorker.controller) {
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification('Avail Co. Tracking', {
              body: `Last sync: ${format(new Date(), 'HH:mm:ss')}`,
              icon: '/icon.png',
              tag: 'tracking-status',
              silent: true
            });
          });
        }
        
        const time = format(new Date(), 'HH:mm:ss');
        setActivityLog(prev => [{ time, msg: `📍 Location recorded — ${lat.toFixed(5)}, ${lng.toFixed(5)}`, type: 'location' }, ...prev.slice(0, 49)]);
      },
      (err) => {
        if (err.code === 1) setStatus('denied');
        else if (err.code === 2) setStatus('unavailable');
        else setStatus('timeout');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  }, []);

  const retryGPS = () => {
    if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
    if (session) startGPS(session.id);
  };

  const handleStartDay = async () => {
    try {
      const res = await axios.post('/api/session/start');
      setSession(res.data.session);
      setTracking(true);
      sessionIdRef.current = res.data.session.id;
      startGPS(res.data.session.id);
      requestWakeLock();
      startHeartbeat();
      setActivityLog([{ time: format(new Date(), 'HH:mm:ss'), msg: '✅ Work day started', type: 'system' }]);
    } catch (e) {
      alert('Error starting day: ' + e.message);
    }
  };

  const handleEndDay = async () => {
    if (!confirm('End work day?')) return;
    try {
      await axios.post('/api/session/end');
      if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
      stopHeartbeat();
      setTracking(false);
      setSession(null);
      setStatus('idle');
    } catch { }
  };

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await axios.get('/api/session/status');
        if (res.data.active) {
          setSession(res.data.session);
          setTracking(true);
          sessionIdRef.current = res.data.session.id;
          startGPS(res.data.session.id);
        }
      } catch { }
    };
    checkSession();
  }, [startGPS]);

  const mapCenter = currentPos || DEFAULT_CENTER;

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logoMark}>📍</div>
          <div>
            <div style={styles.headerTitle}>Avail Co.</div>
            <div style={styles.headerSub}>Employee Portal</div>
          </div>
        </div>
        <div style={styles.headerRight}>
          <button onClick={toggleTheme} style={styles.themeToggle}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          <button className='btn btn-secondary btn-sm' onClick={() => { logout(); navigate('/login'); }}>Sign Out</button>
        </div>
      </header>

      <div style={styles.content}>
        <div style={styles.statusCard} className='card'>
          <div style={styles.statusLeft}>
            <div style={{ ...styles.statusDot, background: tracking ? '#00d4aa' : '#666' }} />
            <div>
              <div style={styles.statusLabel}>{tracking ? 'Tracking Active' : 'Not Tracking'}</div>
              <div style={styles.statusTime}>{elapsed}</div>
            </div>
          </div>
          <div style={styles.statusActions}>
            {!tracking ? (
              <button className='btn btn-primary btn-lg' onClick={handleStartDay}>Start Work Day</button>
            ) : (
              <button className='btn btn-danger' onClick={handleEndDay}>End Work Day</button>
            )}
          </div>
        </div>

        {tracking && !heartbeatActive && (
          <div style={styles.resumeBanner}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: '#fff' }}>⚠️ Background Engine Paused</div>
              <div style={{ fontSize: 12, color: '#eee' }}>Tap to enable iOS background tracking</div>
            </div>
            <button className='btn btn-primary' onClick={startHeartbeat} style={{ background: '#fff', color: '#ff4757' }}>Enable</button>
          </div>
        )}

        <div style={styles.tabs}>
          <button style={{ ...styles.tab, ...(tab === 'map' ? styles.tabActive : {}) }} onClick={() => setTab('map')}>Map</button>
          <button style={{ ...styles.tab, ...(tab === 'activity' ? styles.tabActive : {}) }} onClick={() => setTab('activity')}>Activity</button>
        </div>

        {tab === 'map' && (
          <div style={styles.mapWrapper}>
            <MapContainer center={mapCenter} zoom={14} style={{ height: '400px', width: '100%' }}>
              <TileLayer url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' />
              <MapCenter pos={currentPos} />
              {positions.length > 1 && <Polyline positions={positions} color='#00d4aa' weight={3} />}
              {currentPos && <Marker position={currentPos} icon={myIcon} />}
            </MapContainer>
          </div>
        )}

        {tab === 'activity' && (
          <div className='card' style={{ padding: '16px' }}>
            <h3 style={{ fontSize: '15px', marginBottom: '12px' }}>Activity Log</h3>
            {activityLog.map((log, i) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #eee', fontSize: '12px' }}>
                <span style={{ color: '#00d4aa', fontWeight: 'bold', marginRight: '8px' }}>{log.time}</span>
                {log.msg}
              </div>
            ))}
          </div>
        )}
      </div>

      <audio ref={audioTagRef} loop playsInline src='data:audio/wav;base64,UklGRmYAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhIAAAAP7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v4=' />
      <video ref={videoRef} loop muted playsInline style={{ position: 'fixed', bottom: 0, right: 0, width: 1, height: 1, opacity: 0.01 }} src='https://www.w3schools.com/html/mov_bbb.mp4' />
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: 'var(--bg)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 100 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  logoMark: { fontSize: '20px' },
  headerTitle: { fontSize: 14, fontWeight: 700 },
  headerSub: { fontSize: 10, color: 'var(--text2)' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 10 },
  themeToggle: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px' },
  content: { padding: '12px', maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 },
  statusCard: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', borderRadius: '12px' },
  statusLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  statusDot: { width: 12, height: 12, borderRadius: '50%' },
  statusLabel: { fontSize: 14, fontWeight: 600 },
  statusTime: { fontSize: 12, color: 'var(--text2)' },
  statusActions: { display: 'flex', alignItems: 'center', gap: 12 },
  resumeBanner: { background: 'linear-gradient(135deg, #ff4757, #ff6b81)', borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', gap: 16 },
  tabs: { display: 'flex', gap: 8 },
  tab: { padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text2)', cursor: 'pointer' },
  tabActive: { background: 'var(--accent)', color: '#000', borderColor: 'var(--accent)' },
  mapWrapper: { borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border)' }
};