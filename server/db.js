const { Pool } = require('pg');
require('dotenv').config();

// Support both a full DATABASE_URL (Render/Neon/Railway)
// and individual vars (Supabase style)
const pool = process.env.DATABASE_URL
  ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // required for Supabase / Neon / Render
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  })
  : new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false }, // required for Supabase
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err.message);
});

// Simple query helper
const query = (text, params) => pool.query(text, params);

// Initialize all tables + indexes
const initDB = async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'employee',
        department VARCHAR(255) DEFAULT '',
        phone VARCHAR(50) DEFAULT '',
        avatar VARCHAR(255) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP,
        status VARCHAR(50) DEFAULT 'active'
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS locations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        lat DECIMAL(10, 8) NOT NULL,
        lng DECIMAL(11, 8) NOT NULL,
        accuracy DECIMAL(10, 2) DEFAULT 0,
        speed DECIMAL(10, 2) DEFAULT 0,
        heading DECIMAL(10, 2) DEFAULT 0,
        address TEXT DEFAULT '',
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        lat DECIMAL(10, 8),
        lng DECIMAL(11, 8),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Indexes for performance
    await query(`CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, date)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_locations_user_id ON locations(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_locations_session_id ON locations(session_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_locations_timestamp ON locations(timestamp)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);

    console.log('✅ PostgreSQL tables ready');
  } catch (err) {
    console.error('❌ Failed to initialize database:', err.message);
    throw err;
  }
};

module.exports = { pool, query, initDB };