# Avail Co. — Employee Field Tracking System
### Built for Zakho & Duhok Operations, Iraq 🇮🇶

---

## 📋 Project Overview

A full-stack real-time employee tracking system with:
- **Live GPS tracking** on OpenStreetMap (Leaflet)
- **Manager dashboard** with live map of all employees
- **Employee portal** with one-click work day tracking
- **Route history** — see exactly where each employee went
- **Real-time updates** via WebSockets (Socket.IO)
- **SQLite database** — no external database needed
- **JWT authentication** — secure login for each user
- **Duhok & Zakho** pre-centered on the map

---

## 🗂️ Project Structure

```
field-tracker/
├── server/                    ← Node.js + Express backend
│   ├── index.js               ← Main server (API + WebSocket)
│   ├── tracker.db             ← SQLite database (auto-created)
│   ├── .env                   ← Server config
│   └── package.json
│
├── src/                       ← React frontend
│   ├── context/
│   │   └── AuthContext.jsx    ← Auth state management
│   ├── pages/
│   │   ├── Login.jsx          ← Login page
│   │   ├── ManagerDashboard.jsx   ← Manager view (live map, reports)
│   │   └── EmployeeDashboard.jsx  ← Employee view (GPS tracking)
│   ├── App.jsx                ← Routing
│   ├── main.jsx               ← Entry point
│   └── index.css              ← Global styles
│
├── index.html
├── vite.config.js
└── package.json
```

---

## ⚡ Setup Instructions

### Step 1 — Install Dependencies

Open **two terminals** in VS Code:

**Terminal 1 — Frontend:**
```bash
cd field-tracker
npm install
```

**Terminal 2 — Backend:**
```bash
cd field-tracker/server
npm install
```

### Step 2 — Start the Backend Server

```bash
cd field-tracker/server
node index.js
```

You should see:
```
🚀 Field Tracker Server running on http://localhost:3001
📍 Covering Zakho & Duhok, Iraq

👤 Default Accounts:
   Manager: admin@fieldtracker.iq / admin123
   Employee: ali@fieldtracker.iq / emp123
```

### Step 3 — Start the Frontend

```bash
cd field-tracker
npm run dev
```

Open http://localhost:5173 in your browser.

---

## 🔐 Default Accounts

| Role     | Email                     | Password  |
|----------|---------------------------|-----------|
| Manager  | admin@fieldtracker.iq     | admin123  |
| Employee | ali@fieldtracker.iq       | emp123    |
| Employee | sara@fieldtracker.iq      | emp123    |
| Employee | omar@fieldtracker.iq      | emp123    |

---

## 🗺️ How It Works

### Employee Flow
1. Employee logs in with their account
2. They see a map and a **"Start Work Day"** button
3. When they click it → GPS tracking begins automatically
4. Their location is sent to the server every ~10 seconds
5. The route is drawn on their personal map
6. At end of day, they click **"End Work Day"** → tracking stops

### Manager Flow
1. Manager logs in
2. **Live Map tab** → see all employees as colored dots on the map
3. Click any employee in sidebar → see their route history
4. **Employees tab** → manage employee accounts, add/remove staff
5. **Reports tab** → see who checked in, how long they worked, GPS point count
6. **Notifications tab** → real-time alerts when employees check in/out

---

## 🌐 Making It Accessible Online (Production)

### Option A — Railway.app (Free, Easy)
1. Push code to GitHub
2. Go to https://railway.app
3. Create new project → Deploy from GitHub
4. Add environment variables from server/.env
5. Done! You get a public URL

### Option B — VPS (Iraqi Hosting)
1. Get a VPS from any provider (DigitalOcean, Contabo, etc.)
2. Install Node.js 18+
3. Clone your project
4. Run: `npm install` in both folders
5. Use PM2 to keep it running: `npm install -g pm2 && pm2 start server/index.js`
6. Use Nginx to serve the frontend build

### Option C — Local Network (Office Only)
1. Run the server on the office computer
2. Find your local IP: `ipconfig` (Windows) or `ifconfig` (Linux)
3. Employees connect using: `http://192.168.x.x:5173`

---

## 📡 API Endpoints

| Method | Endpoint                     | Description                  |
|--------|------------------------------|------------------------------|
| POST   | /api/auth/login              | Login                        |
| POST   | /api/auth/register           | Add new employee (manager)   |
| GET    | /api/session/status          | Check active session         |
| POST   | /api/session/start           | Start work day               |
| POST   | /api/session/end             | End work day                 |
| POST   | /api/location                | Submit GPS location          |
| GET    | /api/location/live           | All live locations (manager) |
| GET    | /api/location/history/:id    | Route history for a user     |
| GET    | /api/employees               | All employees (manager)      |
| GET    | /api/reports/summary         | Daily summary (manager)      |

---

## 🔧 Customization

### Change the default map center (Zakho/Duhok)
In `EmployeeDashboard.jsx`:
```js
const ZAKHO_CENTER = [37.1447, 42.6849];
```
In `ManagerDashboard.jsx`:
```js
const DUHOK_CENTER = [36.9660, 42.9510];
```

### Change GPS update frequency
In `EmployeeDashboard.jsx`, `watchPosition` options:
```js
{ enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
```
- `maximumAge: 10000` → update every 10 seconds (change to 5000 for 5 seconds)

### Change work hours
Add work start/end time validation in `server/index.js` → `POST /api/session/start`

---

## 🔒 Security Notes

- Change `JWT_SECRET` in `server/.env` before going live
- Use HTTPS in production (required for GPS on mobile browsers)
- Consider adding rate limiting for production use

---

## 📱 Mobile Support

The app works on mobile browsers. For best GPS accuracy:
- Use Chrome or Firefox on Android
- Use Safari on iPhone
- The site must be on HTTPS for GPS to work on mobile in production

---

Built with ❤️ for Iraq field operations
