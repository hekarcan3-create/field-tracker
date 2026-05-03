import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { format } from 'date-fns';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png', iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png', shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png' });

const colors = ['#00d4aa', '#0088ff', '#ff6b6b', '#ffa502', '#a55eea', '#ff9ff3', '#00cec9'];

const makeIcon = (color, label) => L.divIcon({
  html: `<div style="background:${color};color:#000;font-weight:700;font-size:10px;width:28px;height:28px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.4)">${label}</div>`,
  iconSize: [28, 28], iconAnchor: [14, 14], className: ''
});

const DUHOK_CENTER = [36.9660, 42.9510];

function FlyTo({ pos }) {
  const map = useMap();
  useEffect(() => { if (pos) map.flyTo(pos, 14, { duration: 1.2 }); }, [pos]);
  return null;
}

export default function ManagerDashboard() {
  const navigate = useNavigate();
  const { user, logout, theme, toggleTheme } = useAuth();
  const [tab, setTab] = useState('live');
  const [employees, setEmployees] = useState([]);
  const [liveLocations, setLiveLocations] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [routeHistory, setRouteHistory] = useState([]);
  const [historyDate, setHistoryDate] = useState(new Date().toISOString().split('T')[0]);
  const [routeEmployeeId, setRouteEmployeeId] = useState('');
  const [summary, setSummary] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [flyTo, setFlyTo] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    loadData();

    // FIX: Use relative URL (goes through vite proxy) instead of hardcoded IP
    socketRef.current = io();
    socketRef.current.on('location_update', (data) => {
      setLiveLocations(prev => {
        const idx = prev.findIndex(l => l.id === data.userId);
        const updated = { id: data.userId, name: data.name, lat: data.lat, lng: data.lng, address: data.address, timestamp: data.timestamp };
        if (idx >= 0) { const n = [...prev]; n[idx] = updated; return n; }
        return [...prev, updated];
      });
    });
    socketRef.current.on('employee_checked_in', (data) => {
      addNotification(`${data.name} started their work day`, 'check_in');
      loadData();
    });
    socketRef.current.on('employee_checked_out', (data) => {
      addNotification(`${data.name} ended their work day`, 'check_out');
      loadData();
    });

    // Refresh live locations every 15 seconds
    const interval = setInterval(loadLive, 15000);
    return () => {
      socketRef.current?.disconnect();
      clearInterval(interval);
    };
  }, []);

  const addNotification = (msg, type) => {
    const n = { id: Date.now(), msg, type, time: format(new Date(), 'HH:mm') };
    setNotifications(prev => [n, ...prev.slice(0, 9)]);
  };

  const loadData = async () => {
    try {
      const [empRes, sumRes] = await Promise.all([
        axios.get('/api/employees'),
        axios.get(`/api/reports/summary?date=${new Date().toISOString().split('T')[0]}`)
      ]);
      setEmployees(empRes.data);
      setSummary(sumRes.data);
      console.log('[Manager] Loaded', empRes.data.length, 'employees');
    } catch (err) {
      console.error('[Manager] Failed to load data:', err);
    }
    loadLive();
  };

  const loadLive = async () => {
    try {
      const res = await axios.get('/api/location/live');
      setLiveLocations(res.data.map(l => ({
        id: l.id, name: l.name, department: l.department,
        lat: l.lat, lng: l.lng, address: l.address,
        timestamp: l.timestamp, speed: l.speed
      })));
    } catch (err) {
      console.error('Failed to load live locations:', err);
    }
  };

  const calculateRouteDistance = (points) => {
    if (points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += calculateDistance(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng);
    }
    return total / 1000;
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

  const calculateRouteDuration = (points) => {
    if (points.length < 2) return '0:00';
    const start = new Date(points[0].timestamp);
    const end = new Date(points[points.length-1].timestamp);
    const diff = end - start;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const calculateAvgSpeed = (points) => {
    const speeds = points.filter(p => p.speed > 0).map(p => p.speed * 3.6);
    return speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  };

  // FIX: unified route loading with loading state
  const loadRouteHistory = async (empId, date) => {
    if (!empId || !date) return;
    setRouteLoading(true);
    setRouteHistory([]);
    try {
      const res = await axios.get(`/api/location/history/${empId}?date=${date}`);
      setRouteHistory(res.data);
    } catch (err) {
      console.error('Failed to load route history:', err);
    } finally {
      setRouteLoading(false);
    }
  };

  const loadRoute = async (userId, date) => {
    if (!userId || !date) return;
    try {
      const res = await axios.get(`/api/location/history/${userId}?date=${date}`);
      setRouteHistory(res.data);
    } catch {}
  };

  const handleSelectEmployee = (emp) => {
    setSelectedEmployee(emp);
    loadRoute(emp.id, historyDate);
    const live = liveLocations.find(l => l.id === emp.id);
    if (live) setFlyTo([live.lat, live.lng]);
  };

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logoMark}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
              <circle cx="12" cy="9" r="2.5"/>
            </svg>
          </div>
          <div>
            <span style={styles.headerTitle}>Avail Co.</span>
            <span style={styles.headerBadge}>Manager View</span>
          </div>
        </div>
        <div style={styles.headerCenter}>
          {['live', 'employees', 'routes', 'reports', 'notifications'].map(t => (
            <button key={t} style={{ ...styles.navBtn, ...(tab === t ? styles.navBtnActive : {}) }} onClick={() => setTab(t)}>
              {t === 'live' && '🔴'} {t === 'employees' && '👥'} {t === 'routes' && '🗺️'} {t === 'reports' && '📊'} {t === 'notifications' && '🔔'}
              {' '}{t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'notifications' && notifications.length > 0 && <span style={styles.badge}>{notifications.length}</span>}
            </button>
          ))}
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
          <span style={{ fontSize: 13, color: 'var(--text2)' }}>{user?.name}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => { logout(); navigate('/login'); }}>Sign Out</button>
        </div>
      </header>

      <div style={styles.body}>

        {/* ─── LIVE MAP TAB ─── */}
        {tab === 'live' && (
          <div style={styles.liveLayout}>
            {/* Sidebar */}
            <div style={styles.sidebar}>
              <div style={styles.sidebarHeader}>
                <h3 style={{ fontSize: 14, fontWeight: 700 }}>Live Employees</h3>
                <span style={styles.liveIndicator}>
                  <span className="animate-pulse" style={{ display:'inline-block', width:7, height:7, background:'var(--success)', borderRadius:'50%' }}/>
                  LIVE
                </span>
              </div>
              <div style={styles.quickStats}>
                <div style={styles.quickStat}>
                  <div style={styles.qsNum}>{summary?.activeNow || 0}</div>
                  <div style={styles.qsLabel}>Active Now</div>
                </div>
                <div style={styles.quickStat}>
                  <div style={styles.qsNum}>{liveLocations.length}</div>
                  <div style={styles.qsLabel}>On Map</div>
                </div>
                <div style={styles.quickStat}>
                  <div style={styles.qsNum}>{summary?.totalEmployees || 0}</div>
                  <div style={styles.qsLabel}>Total Staff</div>
                </div>
              </div>
              <div style={styles.empList}>
                {employees.map((emp, i) => {
                  const live = liveLocations.find(l => l.id === emp.id);
                  const isActive = !!emp.todaySession && emp.todaySession.status === 'active';
                  const hasGps = !!live;
                  return (
                    <div key={emp.id} style={{ ...styles.empCard, ...(selectedEmployee?.id === emp.id ? styles.empCardSelected : {}) }}
                      onClick={() => handleSelectEmployee(emp)}>
                      <div style={{ ...styles.empAvatar, background: colors[i % colors.length] }}>{emp.name.charAt(0)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={styles.empName}>{emp.name}</div>
                        <div style={styles.empDept}>{emp.department}</div>
                        {live && <div style={styles.empCoords}>{Number(live.lat || 0).toFixed(4)}, {Number(live.lng || 0).toFixed(4)}</div>}
                      </div>
                      <div style={{ ...styles.empStatus, background: isActive ? (hasGps ? 'rgba(46,213,115,0.15)' : 'rgba(255,165,2,0.15)') : 'rgba(136,153,170,0.1)', color: isActive ? (hasGps ? 'var(--success)' : 'var(--warning)') : 'var(--text2)' }}>
                        {isActive ? (hasGps ? 'Active' : 'No GPS') : 'Off'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Map */}
            <div style={styles.mapContainer}>
              <MapContainer center={DUHOK_CENTER} zoom={12} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
                {flyTo && <FlyTo pos={flyTo} />}

                {liveLocations.length === 0 && (
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1000, background: 'rgba(15,23,42,0.95)', padding: '24px 32px', borderRadius: 12, border: '1px solid var(--border)', textAlign: 'center', maxWidth: 400 }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📍</div>
                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>No employees on map</div>
                    <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
                      Employees must log in and click <b>"Start Work Day"</b> to appear here.
                    </div>
                  </div>
                )}

                {liveLocations.map((loc, i) => (
                  <Marker key={loc.id} position={[loc.lat, loc.lng]} icon={makeIcon(colors[i % colors.length], loc.name.charAt(0))}>
                    <Popup>
                      <div style={{ fontFamily: 'var(--font)', minWidth: 180, padding: 4 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{loc.name}</div>
                        <div style={{ color: 'var(--text2)', fontSize: 12 }}>{loc.department}</div>
                        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '8px 0' }}/>
                        <div style={{ fontSize: 12 }}>📍 {parseFloat(loc.lat)?.toFixed(5)}, {parseFloat(loc.lng)?.toFixed(5)}</div>
                        {loc.timestamp && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>Updated: {format(new Date(loc.timestamp), 'HH:mm:ss')}</div>}
                        {loc.speed > 0 && <div style={{ fontSize: 12, marginTop: 4 }}>🚗 {(Number(loc.speed || 0) * 3.6).toFixed(1)} km/h</div>}
                      </div>
                    </Popup>
                  </Marker>
                ))}

                {selectedEmployee && routeHistory.length > 0 && (
                  <>
                    <Polyline positions={routeHistory.map(r => [r.lat, r.lng])} color="#00d4aa" weight={4} opacity={0.8} />
                    {routeHistory.map((pt, idx) => (
                      <CircleMarker key={idx} center={[pt.lat, pt.lng]} radius={4}
                        pathOptions={{ fillColor: '#0088ff', color: '#fff', weight: 1, fillOpacity: 0.8 }}>
                        <Popup>
                          <div style={{ fontSize: 12 }}>
                            <b>Point {idx + 1} of {routeHistory.length}</b><br/>
                            📍 {parseFloat(pt.lat)?.toFixed(6)}, {parseFloat(pt.lng)?.toFixed(6)}<br/>
                            🕐 {format(new Date(pt.timestamp), 'HH:mm:ss')}<br/>
                            {pt.speed > 0 && <>🚗 {(pt.speed * 3.6).toFixed(1)} km/h<br/></>}
                            {pt.accuracy && <>📐 Accuracy: {parseFloat(pt.accuracy).toFixed(1)}m</>}
                          </div>
                        </Popup>
                      </CircleMarker>
                    ))}
                    {routeHistory[0] && (
                      <Marker position={[routeHistory[0].lat, routeHistory[0].lng]} icon={L.divIcon({
                        html: '<div style="background:#00d4aa;color:#fff;font-weight:bold;width:24px;height:24px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">S</div>',
                        iconSize: [24, 24], iconAnchor: [12, 12], className: ''
                      })}>
                        <Popup><b>START</b> - {format(new Date(routeHistory[0].timestamp), 'HH:mm:ss')}</Popup>
                      </Marker>
                    )}
                    {routeHistory.length > 1 && (
                      <Marker position={[routeHistory[routeHistory.length-1].lat, routeHistory[routeHistory.length-1].lng]} icon={L.divIcon({
                        html: '<div style="background:#ff6b6b;color:#fff;font-weight:bold;width:24px;height:24px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">E</div>',
                        iconSize: [24, 24], iconAnchor: [12, 12], className: ''
                      })}>
                        <Popup><b>END</b> - {format(new Date(routeHistory[routeHistory.length-1].timestamp), 'HH:mm:ss')}</Popup>
                      </Marker>
                    )}
                  </>
                )}
              </MapContainer>
            </div>
          </div>
        )}

        {/* ─── EMPLOYEES TAB ─── */}
        {tab === 'employees' && (
          <div style={styles.tabContent}>
            <div style={styles.tableHeader}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>Employee Management</h2>
                <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>{employees.length} employees registered</p>
              </div>
              <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add Employee
              </button>
            </div>
            <div style={styles.table} className="card">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Employee', 'Department', 'Phone', "Today's Status", 'Last Location', 'Actions'].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp, i) => {
                    const isActive = emp.todaySession?.status === 'active';
                    const live = liveLocations.find(l => l.id === emp.id);
                    const hasGps = !!live;
                    return (
                      <tr key={emp.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={styles.td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ ...styles.empAvatar, background: colors[i % colors.length], width: 32, height: 32, fontSize: 12 }}>{emp.name.charAt(0)}</div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text2)' }}>{emp.email}</div>
                            </div>
                          </div>
                        </td>
                        <td style={styles.td}><span style={{ fontSize: 13 }}>{emp.department || '—'}</span></td>
                        <td style={styles.td}><span style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>{emp.phone || '—'}</span></td>
                        <td style={styles.td}>
                          <span className={`badge badge-${isActive ? 'active' : 'inactive'}`}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }}/>
                            {isActive ? (hasGps ? 'Working' : 'Working (No GPS)') : 'Offline'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          {live ? (
                            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>
                              {parseFloat(live.lat)?.toFixed(4)}, {parseFloat(live.lng)?.toFixed(4)}
                            </span>
                          ) : <span style={{ color: 'var(--text2)', fontSize: 12 }}>No data yet</span>}
                        </td>
                        <td style={styles.td}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => {
                              setSelectedEmployee(emp);
                              loadRoute(emp.id, historyDate);
                              setTab('live');
                              const l = liveLocations.find(x => x.id === emp.id);
                              if (l) setFlyTo([l.lat, l.lng]);
                            }}>Track</button>
                            {/* FIX: was calling loadEmployees() which doesn't exist — now calls loadData() */}
                            <button className="btn btn-danger btn-sm" onClick={() => {
                              if (confirm(`Delete employee ${emp.name}?`)) {
                                axios.delete(`/api/employees/${emp.id}`).then(() => loadData());
                              }
                            }}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── REPORTS TAB ─── */}
        {tab === 'reports' && (
          <div style={styles.tabContent}>
            <div style={styles.tableHeader}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>Daily Reports</h2>
                <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>Work sessions overview</p>
              </div>
              <input type="date" value={historyDate}
                onChange={e => { setHistoryDate(e.target.value); if (selectedEmployee) loadRoute(selectedEmployee.id, e.target.value); }}
                style={{ width: 180 }} />
            </div>
            <div style={styles.summaryGrid}>
              {[
                { label: 'Total Employees', value: summary?.totalEmployees || 0, color: 'var(--accent2)' },
                { label: 'Active Today', value: summary?.sessions?.filter(s => s.status === 'active').length || 0, color: 'var(--success)' },
                { label: 'Completed', value: summary?.sessions?.filter(s => s.status === 'completed').length || 0, color: 'var(--accent)' },
                { label: 'Not Checked In', value: (summary?.totalEmployees || 0) - (summary?.sessions?.length || 0), color: 'var(--text2)' },
              ].map((item, i) => (
                <div key={i} className="card" style={{ textAlign: 'center', padding: 24 }}>
                  <div style={{ fontSize: 36, fontWeight: 800, color: item.color, fontFamily: 'var(--mono)' }}>{item.value}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{item.label}</div>
                </div>
              ))}
            </div>
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Session Details — {historyDate}</h3>
              {!summary?.sessions?.length ? (
                <p style={{ color: 'var(--text2)', textAlign: 'center', padding: 32 }}>No sessions found for this date</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Employee', 'Department', 'Check In', 'Check Out', 'Duration', 'GPS Points', 'Status'].map(h => (
                        <th key={h} style={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.sessions.map(s => {
                      const start = new Date(s.start_time);
                      const end = s.end_time ? new Date(s.end_time) : new Date();
                      const dur = Math.floor((end - start) / 60000);
                      const h = Math.floor(dur / 60), m = dur % 60;
                      return (
                        <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={styles.td}><span style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</span></td>
                          <td style={styles.td}><span style={{ fontSize: 12, color: 'var(--text2)' }}>{s.department}</span></td>
                          <td style={styles.td}><span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{format(start, 'HH:mm:ss')}</span></td>
                          <td style={styles.td}><span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{s.end_time ? format(new Date(s.end_time), 'HH:mm:ss') : '—'}</span></td>
                          <td style={styles.td}><span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent)' }}>{h}h {m}m</span></td>
                          <td style={styles.td}><span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{s.location_points}</span></td>
                          <td style={styles.td}><span className={`badge badge-${s.status === 'active' ? 'active' : 'inactive'}`}>{s.status}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ─── ROUTES TAB ─── */}
        {tab === 'routes' && (
          <div style={styles.tabContent}>
            <div style={styles.tableHeader}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>Daily Route History</h2>
                <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>View exact tracking paths for any employee by date</p>
              </div>
              {/* FIX: changed var(--card) → var(--surface2) so inputs are visible */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={routeEmployeeId}
                  onChange={(e) => setRouteEmployeeId(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }}
                >
                  <option value="">Select Employee</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={historyDate}
                  onChange={(e) => setHistoryDate(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }}
                />
                <button
                  className="btn btn-primary"
                  disabled={!routeEmployeeId || routeLoading}
                  onClick={() => loadRouteHistory(routeEmployeeId, historyDate)}
                >
                  {routeLoading ? 'Loading...' : 'Load Route'}
                </button>
              </div>
            </div>

            {routeHistory.length > 0 && (
              <div style={{ marginBottom: 16 }} className="card">
                <div style={{ display: 'flex', gap: 24, padding: 16, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text2)' }}>Total Points</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#00d4aa' }}>{routeHistory.length}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text2)' }}>Distance</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#0088ff' }}>{calculateRouteDistance(routeHistory).toFixed(2)} km</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text2)' }}>Duration</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#ffa502' }}>{calculateRouteDuration(routeHistory)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text2)' }}>Avg Speed</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#a55eea' }}>{calculateAvgSpeed(routeHistory).toFixed(1)} km/h</div>
                  </div>
                </div>
              </div>
            )}

            <div style={styles.routesGrid}>
              <div className="card" style={{ maxHeight: 500, overflow: 'auto' }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, padding: 16, borderBottom: '1px solid var(--border)' }}>
                  📍 Tracking Timeline {routeHistory.length > 0 && `(${routeHistory.length} points)`}
                </h3>
                {routeLoading ? (
                  <p style={{ color: 'var(--text2)', textAlign: 'center', padding: 40 }}>Loading route data...</p>
                ) : routeHistory.length === 0 ? (
                  <p style={{ color: 'var(--text2)', textAlign: 'center', padding: 40 }}>
                    Select an employee and date, then click "Load Route".
                  </p>
                ) : (
                  <div style={{ padding: 16 }}>
                    {routeHistory.map((pt, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: idx < routeHistory.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: idx === 0 ? '#00d4aa' : idx === routeHistory.length - 1 ? '#ff6b6b' : '#0088ff',
                          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, flexShrink: 0
                        }}>{idx + 1}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {format(new Date(pt.timestamp), 'HH:mm:ss')}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                            📍 {parseFloat(pt.lat)?.toFixed(6)}, {parseFloat(pt.lng)?.toFixed(6)}
                          </div>
                          {(pt.speed > 0 || pt.accuracy > 0) && (
                            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                              {pt.speed > 0 && <>🚗 {(pt.speed * 3.6).toFixed(1)} km/h </>}
                              {pt.accuracy > 0 && <>📐 {parseFloat(pt.accuracy).toFixed(1)}m accuracy</>}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {routeHistory.length > 0 && (
                <div className="card" style={{ height: 500 }}>
                  <MapContainer
                    center={[routeHistory[0].lat, routeHistory[0].lng]}
                    zoom={14}
                    style={{ height: '100%', width: '100%', borderRadius: 12 }}
                  >
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
                    <Polyline positions={routeHistory.map(r => [r.lat, r.lng])} color="#00d4aa" weight={4} opacity={0.9} />
                    {routeHistory.map((pt, idx) => (
                      <CircleMarker key={idx} center={[pt.lat, pt.lng]} radius={3}
                        pathOptions={{ fillColor: idx === 0 ? '#00d4aa' : idx === routeHistory.length - 1 ? '#ff6b6b' : '#0088ff', color: '#fff', weight: 1, fillOpacity: 1 }} />
                    ))}
                    <Marker position={[routeHistory[0].lat, routeHistory[0].lng]} icon={L.divIcon({
                      html: '<div style="background:#00d4aa;color:#fff;font-weight:bold;width:20px;height:20px;border-radius:50%;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:10px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">S</div>',
                      iconSize: [20, 20], iconAnchor: [10, 10], className: ''
                    })}>
                      <Popup>Start: {format(new Date(routeHistory[0].timestamp), 'HH:mm:ss')}</Popup>
                    </Marker>
                    <Marker position={[routeHistory[routeHistory.length-1].lat, routeHistory[routeHistory.length-1].lng]} icon={L.divIcon({
                      html: '<div style="background:#ff6b6b;color:#fff;font-weight:bold;width:20px;height:20px;border-radius:50%;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:10px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">E</div>',
                      iconSize: [20, 20], iconAnchor: [10, 10], className: ''
                    })}>
                      <Popup>End: {format(new Date(routeHistory[routeHistory.length-1].timestamp), 'HH:mm:ss')}</Popup>
                    </Marker>
                  </MapContainer>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── NOTIFICATIONS TAB ─── */}
        {tab === 'notifications' && (
          <div style={styles.tabContent}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Notifications</h2>
            <div className="card">
              {notifications.length === 0 ? (
                <p style={{ color: 'var(--text2)', textAlign: 'center', padding: 40 }}>No notifications yet. Employee check-ins will appear here.</p>
              ) : notifications.map(n => (
                <div key={n.id} style={styles.notif} className="animate-slide-in">
                  <div style={{ ...styles.notifDot, background: n.type === 'check_in' ? 'var(--success)' : 'var(--danger)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13 }}>{n.msg}</div>
                  </div>
                  <div style={styles.notifTime}>{n.time}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showAddModal && <AddEmployeeModal onClose={() => setShowAddModal(false)} onAdded={loadData} />}
    </div>
  );
}

function AddEmployeeModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', department: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await axios.post('/api/auth/register', form);
      onAdded(); onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add employee');
    } finally { setLoading(false); }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} className="card animate-slide-in" onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Add New Employee</h3>
        {error && <div style={{ background: 'rgba(255,71,87,0.1)', border: '1px solid rgba(255,71,87,0.3)', borderRadius: 8, padding: '10px 14px', color: '#ff4757', fontSize: 13, marginBottom: 16 }}>{error}</div>}
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[['Full Name', 'name', 'text'], ['Email Address', 'email', 'email'], ['Password', 'password', 'password'], ['Department', 'department', 'text'], ['Phone Number', 'phone', 'tel']].map(([lbl, key, type]) => (
            <div key={key}>
              <label>{lbl}</label>
              <input type={type} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} required={key !== 'phone' && key !== 'department'} />
            </div>
          ))}
          <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: -6 }}>
            After adding, share the email & password with the employee so they can log in and start tracking.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button type="button" className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={loading}>
              {loading ? 'Adding...' : 'Add Employee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 100, gap: 10, flexWrap: 'wrap' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  logoMark: { width: 32, height: 32, background: 'var(--accent)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', flexShrink: 0 },
  headerTitle: { fontSize: 14, fontWeight: 700, marginRight: 6 },
  headerBadge: { fontSize: 10, background: 'rgba(0,136,255,0.15)', color: 'var(--accent2)', padding: '2px 6px', borderRadius: 20, fontWeight: 600 },
  headerCenter: { display: 'flex', gap: 3, flexWrap: 'wrap', flex: 1, justifyContent: 'center' },
  navBtn: { padding: '6px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text2)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 11, fontWeight: 500, transition: 'all 0.2s', position: 'relative', minHeight: '36px' },
  navBtnActive: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' },
  badge: { position: 'absolute', top: 2, right: 2, background: 'var(--danger)', color: '#fff', fontSize: 9, width: 14, height: 14, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  themeToggle: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text)', transition: 'all 0.2s', flexShrink: 0 },
  body: { flex: 1, overflow: 'hidden' },
  liveLayout: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 58px)' },
  sidebar: { width: '100%', height: '200px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 },
  sidebarHeader: { padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  liveIndicator: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--success)', fontFamily: 'var(--mono)', fontWeight: 700 },
  quickStats: { display: 'flex', padding: '10px 12px', gap: 6, borderBottom: '1px solid var(--border)' },
  quickStat: { flex: 1, textAlign: 'center', background: 'var(--surface2)', borderRadius: 6, padding: '6px 2px' },
  qsNum: { fontSize: 16, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--mono)' },
  qsLabel: { fontSize: 9, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 },
  empList: { flex: 1, overflowY: 'auto', padding: 8 },
  empCard: { padding: '8px 10px', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.15s', marginBottom: 4, border: '1px solid transparent' },
  empCardSelected: { background: 'var(--surface2)', borderColor: 'var(--accent)' },
  empAvatar: { width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, color: '#000', flexShrink: 0 },
  empName: { fontSize: 12, fontWeight: 600 },
  empDept: { fontSize: 10, color: 'var(--text2)' },
  empCoords: { fontSize: 9, color: 'var(--accent)', fontFamily: 'var(--mono)', marginTop: 1 },
  empStatus: { fontSize: 9, padding: '2px 6px', borderRadius: 20, fontWeight: 600, flexShrink: 0 },
  mapContainer: { flex: 1, position: 'relative', minHeight: '300px' },
  tabContent: { padding: 16, maxWidth: 1200, margin: '0 auto' },
  tableHeader: { display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 },
  table: { padding: 0, overflow: 'hidden', overflowX: 'auto' },
  th: { padding: '10px 12px', textAlign: 'left', fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td: { padding: '12px', verticalAlign: 'middle', fontSize: 12 },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 8 },
  notif: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--border)' },
  notifDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  notifTime: { fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)', flexShrink: 0 },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { width: '100%', maxWidth: 'calc(100vw - 32px)', padding: 20, maxHeight: '90vh', overflow: 'auto' },
  routesGrid: { 
    display: 'grid', 
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', 
    gap: 16 
  },
};