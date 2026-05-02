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

export default function EmployeeDashboard() {
  const navigate = useNavigate();
  const { user, logout, theme, toggleTheme } = useAuth();
  const [session, setSession] = useState(null);
  const [tracking, setTracking] = useState(false);
  const [positions, setPositions] = useState([]);
  const [currentPos, setCurrentPos] = useState(null);
  const [elapsed, setElapsed] = useState('00:00:00');
  const [status, setStatus] = useState('idle');
  const [activityLog, setActivityLog] = useState([]);
  const [tab, setTab] = useState('map');
  const watchId = useRef(null);
  const timerRef = useRef(null);
  const wakeLock = useRef(null);

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

  // Re-acquire wake lock when page becomes visible again
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (tracking && document.visibilityState === 'visible') {
        await requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [tracking]);

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
          // Permission granted - now start watching
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
          requestWakeLock();
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
    } catch {}
  };

  const loadHistory = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await axios.get(`/api/location/history/me?date=${today}`);
      const pts = res.data.map(l => [l.lat, l.lng]);
      setPositions(pts);
      if (pts.length) setCurrentPos(pts[pts.length - 1]);
    } catch {}
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
      setElapsed(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    }, 1000);
  };

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
        if (err.code === 1) {
          // PERMISSION_DENIED
          setStatus('denied');
        } else if (err.code === 2) {
          setStatus('unavailable');
        } else {
          setStatus('timeout');
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
  }, []);

  const retryGPS = async () => {
    if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
    // First check permission with one-time request
    const hasPermission = await checkAndRequestPermission();
    if (hasPermission && session) {
      startGPS(session.id);
    }
  };

  const calculateDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lng2-lng1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
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
      
      // Only start GPS watch if permission was granted
      if (hasPermission) {
        startGPS(res.data.session.id);
        requestWakeLock();
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
      releaseWakeLock();
      setTracking(false);
      setSession(null);
      setStatus('idle');
      setElapsed('00:00:00');
      setActivityLog(prev => [
        { time: format(new Date(), 'HH:mm:ss'), msg: '🏁 Work day ended', type: 'system' },
        ...prev
      ]);
    } catch {}
  };

  const mapCenter = currentPos || DEFAULT_CENTER;

  return (
    <div style={styles.page}>
      {/* Top Bar */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logoMark}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
              <circle cx="12" cy="9" r="2.5"/>
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
                <circle cx="12" cy="12" r="5"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
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
            {!tracking ? (
              <button className="btn btn-primary btn-lg" onClick={handleStartDay}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 8 16 12 12 16"/><line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
                Start Work Day
              </button>
            ) : (
              <button className="btn btn-danger" onClick={handleEndDay}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                </svg>
                End Work Day
              </button>
            )}
          </div>
        </div>

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
                  <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
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
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              Keep Tracking in Background
            </div>
            <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>
              To ensure the system tracks you even when the screen is off:
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                <li>Keep this tab open in your browser.</li>
                <li>Do not force-close the browser app.</li>
                <li>On Android: Set battery usage to <b>"Unrestricted"</b> for your browser.</li>
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
                      <strong style={{ color: 'var(--accent)' }}>{user?.name}</strong><br/>
                      <small style={{ color: 'var(--text2)' }}>Current Position</small><br/>
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
};