const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const { pool, query, initDB } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fieldtracker_secret_2024_iraq';

// Seed default admin and employees
const seedUsers = async () => {
  try {
    const result = await query('SELECT COUNT(*) as count FROM users');
    if (parseInt(result.rows[0].count) === 0) {
      const adminPass = bcrypt.hashSync('waleedjs123', 10);
      const empPass = bcrypt.hashSync('emp123', 10);

      await query(
        'INSERT INTO users (name, email, password, role, department, phone) VALUES ($1, $2, $3, $4, $5, $6)',
        ['Waleed J Salih', 'waleed@avail.com', adminPass, 'manager', 'Management', '+964 750 000 0001']
      );
      await query(
        'INSERT INTO users (name, email, password, role, department, phone) VALUES ($1, $2, $3, $4, $5, $6)',
        ['Ali Hassan', 'ali@fieldtracker.iq', empPass, 'employee', 'Field Operations', '+964 750 000 0002']
      );
      await query(
        'INSERT INTO users (name, email, password, role, department, phone) VALUES ($1, $2, $3, $4, $5, $6)',
        ['Sara Khalil', 'sara@fieldtracker.iq', empPass, 'employee', 'Sales', '+964 750 000 0003']
      );
      await query(
        'INSERT INTO users (name, email, password, role, department, phone) VALUES ($1, $2, $3, $4, $5, $6)',
        ['Omar Rashid', 'omar@fieldtracker.iq', empPass, 'employee', 'Delivery', '+964 750 000 0004']
      );
      console.log('✅ Default users seeded');
    }
  } catch (err) {
    console.error('❌ Failed to seed users:', err);
    throw err;
  }
};

// ─── Fix manager name (migration) ────────────────────────────────
const migrateDB = async () => {
  try {
    const newPass = bcrypt.hashSync('waleedjs123', 10);
    await query(
      "UPDATE users SET name = 'Waleed J Salih', email = 'waleed@avail.com', password = $1 WHERE role = 'manager'",
      [newPass]
    );
    console.log('✅ Manager updated: Waleed J Salih (waleed@avail.com)');
  } catch (err) {
    // Ignore errors - manager might not exist yet
  }
};

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

// Returns fresh user data from DB — used by AuthContext on startup to fix stale localStorage
app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const result = await query('SELECT id, name, email, role, department, phone FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '12h' });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department, phone: user.phone }
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/auth/register', auth, async (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Manager only' });
  const { name, email, password, department, phone } = req.body;
  const hashed = bcrypt.hashSync(password, 10);
  try {
    const result = await query(
      'INSERT INTO users (name, email, password, role, department, phone) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [name, email, hashed, 'employee', department || '', phone || '']
    );
    res.json({ id: result.rows[0].id, name, email, department, phone, role: 'employee' });
  } catch (err) {
    res.status(400).json({ error: 'Email already exists' });
  }
});

// ─── Tracking Session Routes ───────────────────────────────────────
app.post('/api/session/start', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  try {
    const existingResult = await query(
      "SELECT * FROM sessions WHERE user_id = $1 AND date = $2 AND status = 'active'",
      [req.user.id, today]
    );
    if (existingResult.rows[0]) return res.json({ session: existingResult.rows[0], resumed: true });

    const insertResult = await query(
      "INSERT INTO sessions (user_id, date, start_time, status) VALUES ($1, $2, $3, 'active') RETURNING *",
      [req.user.id, today, new Date().toISOString()]
    );
    const session = insertResult.rows[0];

    await query(
      "INSERT INTO activity_logs (user_id, session_id, type, description) VALUES ($1, $2, 'check_in', 'Started work day tracking')",
      [req.user.id, session.id]
    );

    io.emit('employee_checked_in', { userId: req.user.id, name: req.user.name, sessionId: session.id });
    res.json({ session, resumed: false });
  } catch (err) {
    console.error('Session start error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/session/end', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  try {
    const sessionResult = await query(
      "SELECT * FROM sessions WHERE user_id = $1 AND date = $2 AND status = 'active'",
      [req.user.id, today]
    );
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: 'No active session' });

    await query(
      "UPDATE sessions SET status = 'completed', end_time = $1 WHERE id = $2",
      [new Date().toISOString(), session.id]
    );

    await query(
      "INSERT INTO activity_logs (user_id, session_id, type, description) VALUES ($1, $2, 'check_out', 'Ended work day tracking')",
      [req.user.id, session.id]
    );

    io.emit('employee_checked_out', { userId: req.user.id, name: req.user.name });
    res.json({ success: true });
  } catch (err) {
    console.error('Session end error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/session/status', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  try {
    const result = await query(
      "SELECT * FROM sessions WHERE user_id = $1 AND date = $2 AND status = 'active'",
      [req.user.id, today]
    );
    res.json({ active: !!result.rows[0], session: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── Location Routes ───────────────────────────────────────────────
app.post('/api/location', auth, async (req, res) => {
  const { lat, lng, accuracy, speed, heading, address, session_id } = req.body;
  if (!lat || !lng || !session_id) return res.status(400).json({ error: 'lat, lng, and session_id are required' });

  try {
    const result = await query(
      'INSERT INTO locations (user_id, session_id, lat, lng, accuracy, speed, heading, address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
      [req.user.id, session_id, lat, lng, accuracy || 0, speed || 0, heading || 0, address || '']
    );

    const location = { userId: req.user.id, name: req.user.name, lat, lng, accuracy, speed, address, timestamp: new Date().toISOString() };
    io.emit('location_update', location);
    res.json({ id: result.rows[0].id });
  } catch (err) {
    console.error('Location insert error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/location/live', auth, async (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Manager only' });
  try {
    const result = await query(`
      SELECT u.id, u.name, u.department, l.lat, l.lng, l.address, l.timestamp, l.speed
      FROM users u
      JOIN locations l ON l.user_id = u.id
      WHERE l.id = (
        SELECT MAX(l2.id) FROM locations l2 WHERE l2.user_id = u.id
      )
      AND u.role = 'employee'
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Live locations error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/location/history/:userId', auth, async (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];
  const userId = req.params.userId === 'me' ? req.user.id : parseInt(req.params.userId);

  if (req.user.role !== 'manager' && req.user.id !== userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    // First try to get locations linked to sessions for the date
    const result = await query(`
      SELECT l.* FROM locations l
      JOIN sessions s ON s.id = l.session_id
      WHERE l.user_id = $1 AND s.date = $2
      ORDER BY l.timestamp ASC
    `, [userId, targetDate]);
    
    // If no session-linked locations found, try to get any locations for this user on this date
    if (result.rows.length === 0) {
      const fallbackResult = await query(`
        SELECT * FROM locations 
        WHERE user_id = $1 
        AND DATE(timestamp) = $2
        ORDER BY timestamp ASC
      `, [userId, targetDate]);
      res.json(fallbackResult.rows);
    } else {
      res.json(result.rows);
    }
  } catch (err) {
    console.error('History query error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── Dashboard & Reports ───────────────────────────────────────────
app.get('/api/employees', auth, async (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Manager only' });
  try {
    const employeesResult = await query(
      "SELECT id, name, email, department, phone, role, created_at FROM users WHERE role = 'employee'"
    );
    const employees = employeesResult.rows;

    const today = new Date().toISOString().split('T')[0];
    const enriched = await Promise.all(employees.map(async (emp) => {
      const sessionResult = await query(
        "SELECT * FROM sessions WHERE user_id = $1 AND date = $2",
        [emp.id, today]
      );
      const lastLocResult = await query(
        "SELECT * FROM locations WHERE user_id = $1 ORDER BY id DESC LIMIT 1",
        [emp.id]
      );
      return { ...emp, todaySession: sessionResult.rows[0] || null, lastLocation: lastLocResult.rows[0] || null };
    }));
    res.json(enriched);
  } catch (err) {
    console.error('Employees query error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Update user info (manager can update any user, employees can update themselves)
app.put('/api/users/:id', auth, async (req, res) => {
  const userId = parseInt(req.params.id);
  const { name, email, department, phone } = req.body;
  
  // Only manager can update other users
  if (req.user.role !== 'manager' && req.user.id !== userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  const updates = [];
  const params = [];
  let paramIndex = 1;
  
  if (name) { updates.push(`name = $${paramIndex++}`); params.push(name); }
  if (email) { updates.push(`email = $${paramIndex++}`); params.push(email); }
  if (department !== undefined) { updates.push(`department = $${paramIndex++}`); params.push(department); }
  if (phone !== undefined) { updates.push(`phone = $${paramIndex++}`); params.push(phone); }
  
  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  
  params.push(userId);
  
  try {
    const result = await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, message: 'User updated' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/activity/:userId', auth, async (req, res) => {
  const userId = req.params.userId === 'me' ? req.user.id : parseInt(req.params.userId);
  const { date, limit = 50 } = req.query;

  // Only allow employees to read their own logs; managers can read any
  if (req.user.role !== 'manager' && req.user.id !== userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    let sql = 'SELECT * FROM activity_logs WHERE user_id = $1';
    const params = [userId];
    let paramIndex = 2;
    
    if (date) {
      sql += ` AND DATE(timestamp) = $${paramIndex++}`;
      params.push(date);
    }
    sql += ` ORDER BY timestamp DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/reports/summary', auth, async (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Manager only' });
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  try {
    const sessionsResult = await query(`
      SELECT s.*, u.name, u.department,
        (SELECT COUNT(*) FROM locations l WHERE l.session_id = s.id) as location_points
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.date = $1 AND u.role = 'employee'
    `, [targetDate]);

    const totalResult = await query("SELECT COUNT(*) as count FROM users WHERE role = 'employee'");
    const activeResult = await query(
      `SELECT COUNT(*) as count FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.date = $1 AND s.status = 'active' AND u.role = 'employee'`,
      [targetDate]
    );

    res.json({
      sessions: sessionsResult.rows,
      totalEmployees: parseInt(totalResult.rows[0].count),
      activeNow: parseInt(activeResult.rows[0].count),
      date: targetDate
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/employees/:id', auth, async (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Manager only' });
  
  try {
    // End any active sessions for this employee before deleting
    await query(
      "UPDATE sessions SET status = 'completed', end_time = $1 WHERE user_id = $2 AND status = 'active'",
      [new Date().toISOString(), req.params.id]
    );
    
    const result = await query('DELETE FROM users WHERE id = $1 AND role = $2', [req.params.id, 'employee']);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete employee error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── Socket.IO ─────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ─── Start ─────────────────────────────────────────────────────────
async function startServer() {
  try {
    await initDB();
    await seedUsers();
    await migrateDB(); // ← ensures manager name is always "Waleed J Salih"
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 Field Tracker Server running on http://0.0.0.0:${PORT}`);
      console.log(`📱 Mobile access: http://192.168.1.79:${PORT}`);
      console.log(`📍 Covering Zakho & Duhok, Iraq`);
      console.log(`\n👤 Default Accounts:`);
      console.log(`   Manager: waleed@avail.com / waleedjs123`);
      console.log(`   Employee: ali@fieldtracker.iq / emp123`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();