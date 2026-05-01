const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fieldtracker_secret_2024_iraq';

// ─── Database Setup ────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'tracker.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'employee',
    department TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    status TEXT DEFAULT 'active',
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accuracy REAL,
    speed REAL,
    heading REAL,
    address TEXT DEFAULT '',
    timestamp TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_id INTEGER,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    lat REAL,
    lng REAL,
    timestamp TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Seed default admin and employees if empty
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
if (userCount.count === 0) {
  const adminPass = bcrypt.hashSync('admin123', 10);
  const empPass = bcrypt.hashSync('emp123', 10);

  db.prepare(`INSERT INTO users (name, email, password, role, department, phone) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'Waleed J Salih', 'admin@fieldtracker.iq', adminPass, 'manager', 'Management', '+964 750 000 0001'
  );
  db.prepare(`INSERT INTO users (name, email, password, role, department, phone) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'Ali Hassan', 'ali@fieldtracker.iq', empPass, 'employee', 'Field Operations', '+964 750 000 0002'
  );
  db.prepare(`INSERT INTO users (name, email, password, role, department, phone) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'Sara Khalil', 'sara@fieldtracker.iq', empPass, 'employee', 'Sales', '+964 750 000 0003'
  );
  db.prepare(`INSERT INTO users (name, email, password, role, department, phone) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'Omar Rashid', 'omar@fieldtracker.iq', empPass, 'employee', 'Delivery', '+964 750 000 0004'
  );
  console.log('✅ Default users seeded');
}

// ─── Middleware ────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ─── Auth Routes ───────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '12h' });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department, phone: user.phone }
  });
});

app.post('/api/auth/register', auth, (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Manager only' });
  const { name, email, password, department, phone } = req.body;
  const hashed = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare('INSERT INTO users (name, email, password, department, phone) VALUES (?, ?, ?, ?, ?)').run(name, email, hashed, department || '', phone || '');
    res.json({ id: result.lastInsertRowid, name, email, department, phone, role: 'employee' });
  } catch {
    res.status(400).json({ error: 'Email already exists' });
  }
});

// ─── Tracking Session Routes ───────────────────────────────────────
app.post('/api/session/start', auth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const existing = db.prepare("SELECT * FROM sessions WHERE user_id = ? AND date = ? AND status = 'active'").get(req.user.id, today);
  if (existing) return res.json({ session: existing, resumed: true });

  const result = db.prepare("INSERT INTO sessions (user_id, date, start_time, status) VALUES (?, ?, ?, 'active')").run(
    req.user.id, today, new Date().toISOString()
  );
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid);

  // Log activity
  db.prepare("INSERT INTO activity_logs (user_id, session_id, type, description) VALUES (?, ?, 'check_in', 'Started work day tracking')").run(req.user.id, session.id);

  io.emit('employee_checked_in', { userId: req.user.id, name: req.user.name, sessionId: session.id });
  res.json({ session, resumed: false });
});

app.post('/api/session/end', auth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const session = db.prepare("SELECT * FROM sessions WHERE user_id = ? AND date = ? AND status = 'active'").get(req.user.id, today);
  if (!session) return res.status(404).json({ error: 'No active session' });

  db.prepare("UPDATE sessions SET status = 'completed', end_time = ? WHERE id = ?").run(new Date().toISOString(), session.id);
  db.prepare("INSERT INTO activity_logs (user_id, session_id, type, description) VALUES (?, ?, 'check_out', 'Ended work day tracking')").run(req.user.id, session.id);

  io.emit('employee_checked_out', { userId: req.user.id, name: req.user.name });
  res.json({ success: true });
});

app.get('/api/session/status', auth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const session = db.prepare("SELECT * FROM sessions WHERE user_id = ? AND date = ? AND status = 'active'").get(req.user.id, today);
  res.json({ active: !!session, session: session || null });
});

// ─── Location Routes ───────────────────────────────────────────────
app.post('/api/location', auth, (req, res) => {
  const { lat, lng, accuracy, speed, heading, address, session_id } = req.body;
  const result = db.prepare('INSERT INTO locations (user_id, session_id, lat, lng, accuracy, speed, heading, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    req.user.id, session_id, lat, lng, accuracy || 0, speed || 0, heading || 0, address || ''
  );

  const location = { userId: req.user.id, name: req.user.name, lat, lng, accuracy, speed, address, timestamp: new Date().toISOString() };
  io.emit('location_update', location);
  res.json({ id: result.lastInsertRowid });
});

app.get('/api/location/live', auth, (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Manager only' });
  // Return last known location for each active employee
  const rows = db.prepare(`
    SELECT u.id, u.name, u.department, l.lat, l.lng, l.address, l.timestamp, l.speed
    FROM users u
    JOIN locations l ON l.user_id = u.id
    WHERE l.id = (
      SELECT MAX(l2.id) FROM locations l2 WHERE l2.user_id = u.id
    )
    AND u.role = 'employee'
  `).all();
  res.json(rows);
});

app.get('/api/location/history/:userId', auth, (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];
  const userId = req.params.userId === 'me' ? req.user.id : parseInt(req.params.userId);

  if (req.user.role !== 'manager' && req.user.id !== userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const locations = db.prepare(`
    SELECT l.* FROM locations l
    JOIN sessions s ON s.id = l.session_id
    WHERE l.user_id = ? AND s.date = ?
    ORDER BY l.timestamp ASC
  `).all(userId, targetDate);

  res.json(locations);
});

// ─── Dashboard & Reports ───────────────────────────────────────────
app.get('/api/employees', auth, (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Manager only' });
  const employees = db.prepare("SELECT id, name, email, department, phone, role, created_at FROM users WHERE role = 'employee'").all();

  // Add today's session info
  const today = new Date().toISOString().split('T')[0];
  const enriched = employees.map(emp => {
    const session = db.prepare("SELECT * FROM sessions WHERE user_id = ? AND date = ?").get(emp.id, today);
    const lastLoc = db.prepare("SELECT * FROM locations WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(emp.id);
    return { ...emp, todaySession: session || null, lastLocation: lastLoc || null };
  });
  res.json(enriched);
});

app.get('/api/activity/:userId', auth, (req, res) => {
  const userId = req.params.userId === 'me' ? req.user.id : parseInt(req.params.userId);
  const { date, limit = 50 } = req.query;

  let query = 'SELECT * FROM activity_logs WHERE user_id = ?';
  const params = [userId];
  if (date) {
    query += ' AND date(timestamp) = ?';
    params.push(date);
  }
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(parseInt(limit));

  const logs = db.prepare(query).all(...params);
  res.json(logs);
});

app.get('/api/reports/summary', auth, (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Manager only' });
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  const sessions = db.prepare(`
    SELECT s.*, u.name, u.department,
      (SELECT COUNT(*) FROM locations l WHERE l.session_id = s.id) as location_points
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.date = ?
  `).all(targetDate);

  const totalEmployees = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'employee'").get().count;
  const activeNow = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE date = ? AND status = 'active'").get(targetDate).count;

  res.json({ sessions, totalEmployees, activeNow, date: targetDate });
});

app.delete('/api/employees/:id', auth, (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Manager only' });
  db.prepare('DELETE FROM users WHERE id = ? AND role = "employee"').run(req.params.id);
  res.json({ success: true });
});

// ─── Socket.IO ─────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ─── Start ─────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 Field Tracker Server running on http://localhost:${PORT}`);
  console.log(`📍 Covering Zakho & Duhok, Iraq`);
  console.log(`\n👤 Default Accounts:`);
  console.log(`   Manager: admin@fieldtracker.iq / admin123`);
  console.log(`   Employee: ali@fieldtracker.iq / emp123`);
});
