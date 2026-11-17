require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { requireAuth } = require('./access');
const setupSocket = require('./socket');

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

if (process.env.DEV_LOGIN === 'true') {
  console.warn('⚠  DEV_LOGIN=true – anyone can sign in as any test user. Never enable this on a public server.');
}

const app = express();
const server = http.createServer(app);
const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const io = new Server(server, { cors: { origin } });
setupSocket(io);
app.set('io', io);

app.use(cors({ origin }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/config', (req, res) => res.json({
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  calendarScopes: require('./google').CALENDAR_SCOPES.join(' '),
  calendarEnabled: !!process.env.GOOGLE_CLIENT_SECRET || process.env.CALENDAR_MODE === 'fake',
  // Sign in with Google Workspace + calendar access in one step (needs the client secret)
  loginWithCalendar: !!process.env.GOOGLE_CLIENT_SECRET && process.env.CALENDAR_MODE !== 'fake',
  allowedDomain: (process.env.ALLOWED_DOMAIN || '').trim().toLowerCase(),
  devLogin: process.env.DEV_LOGIN === 'true',
  calendarSimulated: process.env.CALENDAR_MODE === 'fake',
  // Office hours used to suggest meeting times (24h, local time of the person scheduling)
  workHours: { start: process.env.WORK_START || '10:00', end: process.env.WORK_END || '19:30', days: (process.env.WORK_DAYS || '1,2,3,4,5,6').split(',').map(Number) },
}));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/spaces', requireAuth, require('./routes/spaces'));
app.use('/api', requireAuth, require('./routes/lists'));
app.use('/api', requireAuth, require('./routes/tickets'));
app.use('/api', requireAuth, require('./routes/chats'));
app.use('/api', requireAuth, require('./routes/calendar'));

// Serve the built React app in production (client/dist)
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|socket\.io).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong', ...(err.status && err.details ? err.details : {}) });
});

const port = Number(process.env.PORT || 5000);
server.listen(port, () => console.log(`API running on http://localhost:${port}`));
