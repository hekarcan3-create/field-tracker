const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'fieldtracker',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  max: 20, // maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Test connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL error:', err);
});

// Helper function to run queries
const query = (text, params) => pool.query(text, params);

// Initialize database tables
const initDB = async () => {
  try {
    // Users table
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

    // Sessions table
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

    // Locations table
    await query(`
      CREATE TABLE IF NOT EXISTS locations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        lat DECIMAL(10, 8) NOT NULL,
        lng DECIMAL(11, 8) NOT NULL,
        accuracy DECIMAL(10, 2),
        speed DECIMAL(10, 2),
        heading DECIMAL(10, 2),
        address TEXT DEFAULT '',
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Activity logs table
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

    // Create indexes for better performance
    await query(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_locations_user_id ON locations(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_locations_session_id ON locations(session_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);

    console.log('✅ PostgreSQL tables initialized');
  } catch (err) {
    console.error('❌ Failed to initialize database:', err);
    throw err;
  }
};

// Get database instance for compatibility with old code
const getDB = () => {
  return {
    query,
    // For backward compatibility with SQLite-style callbacks
    run: async (sql, params = [], callback) => {
      try {
        const result = await query(sql, params);
        if (callback) callback(null, result);
        return result;
      } catch (err) {
        if (callback) callback(err);
        throw err;
      }
    },
    get: async (sql, params = [], callback) => {
      try {
        const result = await query(sql, params);
        const row = result.rows[0] || null;
        if (callback) callback(null, row);
        return row;
      } catch (err) {
        if (callback) callback(err);
        throw err;
      }
    },
    all: async (sql, params = [], callback) => {
      try {
        const result = await query(sql, params);
        const rows = result.rows;
        if (callback) callback(null, rows);
        return rows;
      } catch (err) {
        if (callback) callback(err);
        throw err;
      }
    }
  };
};

module.exports = { pool, query, initDB, getDB };
