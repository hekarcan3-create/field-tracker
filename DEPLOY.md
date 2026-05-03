# Field Tracker Deployment Guide

## Option 1: Railway (Recommended - Free)

### 1. Deploy Backend + PostgreSQL

1. Go to https://railway.app and sign up with GitHub
2. Click "New Project" → "Provision PostgreSQL"
3. Click "New" → "Empty Service" for backend
4. In the service settings:
   - Root Directory: `server`
   - Start Command: `npm start`
   - Port: `3001`
5. Add Environment Variables:
   ```
   DB_HOST=${{Postgres.PGHOST}}
   DB_PORT=${{Postgres.PGPORT}}
   DB_NAME=${{Postgres.PGDATABASE}}
   DB_USER=${{Postgres.PGUSER}}
   DB_PASSWORD=${{Postgres.PGPASSWORD}}
   JWT_SECRET=your_random_secret_key_here
   PORT=3001
   ```
6. Deploy!

### 2. Deploy Frontend to Vercel

1. Go to https://vercel.com and sign up with GitHub
2. Click "Add New Project"
3. Import your repository
4. Framework Preset: `Vite`
5. Root Directory: `./` (leave as is)
6. Build Command: `npm run build`
7. Output Directory: `dist`
8. Add Environment Variable:
   ```
   VITE_API_URL=https://your-railway-backend-url.up.railway.app
   ```
9. Deploy!

### 3. Update CORS

In `server/index.js`, update the CORS origin to your Vercel URL:
```javascript
app.use(cors({
  origin: 'https://your-vercel-app.vercel.app',
  credentials: true
}));
```

## Option 2: Render (Free Alternative)

### Backend + PostgreSQL on Render

1. Go to https://render.com
2. Create PostgreSQL database
3. Create Web Service:
   - Root Directory: `server`
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add environment variables from Render PostgreSQL

### Frontend on Vercel (same as above)

## Option 3: VPS/Dedicated Server

If you have your own server:

```bash
# 1. Install Node.js and PostgreSQL
# 2. Clone your repository
git clone <your-repo-url>
cd field-tracker

# 3. Setup database
# Create PostgreSQL database and user

# 4. Configure environment
cp server/.env.example server/.env
# Edit server/.env with your database credentials

# 5. Install and build
npm install
cd server && npm install
cd ..
npm run build

# 6. Start with PM2
npm install -g pm2
pm2 start server/index.js --name field-tracker-api
pm2 startup
pm2 save

# 7. Setup Nginx as reverse proxy
# Configure Nginx to serve frontend from /dist
# and proxy /api to localhost:3001
```

## Post-Deployment

### Create Manager Account

After first deployment, the default accounts are:
- Manager: `waleed@avail.com` / `waleedjs123`
- Employees: `ali@fieldtracker.iq` / `emp123`

### SSL/HTTPS

Both Railway and Vercel provide free SSL certificates automatically.

### Custom Domain

1. Add your domain in Vercel/Railway dashboard
2. Update DNS records (CNAME or A record)
3. Update CORS in server/index.js with your custom domain

## 📱 Mobile Optimization (CRITICAL)

To ensure consistent GPS tracking in the background (especially when the screen is off), employees MUST follow these steps on their phones:

### For Android:
1.  **Battery Optimization**: Long press the browser icon (Chrome) -> App Info -> Battery -> **Set to "Unrestricted"**.
2.  **Location Permission**: Go to App Info -> Permissions -> Location -> **Set to "Allow all the time"** (if available) or ensure "Use precise location" is ON.
3.  **PWA Installation**: Open the site in Chrome -> click 3 dots -> **"Install App"**. The installed version has better background priority than a browser tab.

### For iPhone (iOS):
1.  **Always On**: Employees should keep the browser tab open.
2.  **Add to Home Screen**: Open the site in Safari -> click Share button -> **"Add to Home Screen"**. Use the Home Screen version for work.
3.  **Background App Refresh**: Ensure this is ON in iOS Settings for the browser.

---

## Need Help?
...
