-- Run this in Supabase SQL Editor

-- Users table
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
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  status VARCHAR(50) DEFAULT 'active'
);

-- Locations table
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
);

-- Activity logs table
CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_date ON sessions(date);
CREATE INDEX idx_locations_user_id ON locations(user_id);
CREATE INDEX idx_locations_session_id ON locations(session_id);
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- Seed default manager
INSERT INTO users (name, email, password, role, department, phone)
VALUES (
  'Waleed J Salih',
  'waleed@avail.com',
  '$2a$10$YourHashedPasswordHere',
  'manager',
  'Management',
  '+964 750 000 0001'
) ON CONFLICT (email) DO NOTHING;

-- Seed default employees
INSERT INTO users (name, email, password, role, department, phone)
VALUES
  ('Ali Hassan', 'ali@fieldtracker.iq', '$2a$10$YourHashedPasswordHere', 'employee', 'Field Operations', '+964 750 000 0002'),
  ('Sara Khalil', 'sara@fieldtracker.iq', '$2a$10$YourHashedPasswordHere', 'employee', 'Sales', '+964 750 000 0003'),
  ('Omar Rashid', 'omar@fieldtracker.iq', '$2a$10$YourHashedPasswordHere', 'employee', 'Delivery', '+964 750 000 0004')
ON CONFLICT (email) DO NOTHING;
