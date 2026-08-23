const express = require('express');
const dotenv = require('dotenv');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const crypto = require('crypto');
const hpp = require('hpp');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const http = require('http');
const { WebSocketServer } = require('ws');

dotenv.config();

// TLS Security Configuration (defaults to strict verification)
if (process.env.ALLOW_INSECURE_TLS === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const app = express();

app.use(compression());

// ── SECURITY: Har request uchun CSP nonce generatsiya ──
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

// ── SECURITY HEADERS (Helmet) ──
app.use(helmet({
  contentSecurityPolicy: false, // EJS shablonlardagi inline onclick va scriptlar uzluksiz ishlashi uchun
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  xssFilter: true,
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permittedCrossDomainPolicies: { permittedPolicies: 'none' }
}));

// ── SECURITY: HTTP Parameter Pollution himoyasi ──
app.use(hpp());

// ── CORS — FAQAT ruxsat etilgan domenlar (WHITELIST) ──
const ALLOWED_ORIGINS = [
  'https://desco.uz',
  'https://www.desco.uz',
  'https://desco.up.railway.app',
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()) : []),
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'] : [])
];

app.use(cors({
  origin: (origin, callback) => {
    // Server-to-server (no origin) yoki ruxsat etilgan domenlar
    if (!origin || ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed))) {
      return callback(null, true);
    }
    console.warn(`[CORS] ⛔ Ruxsatsiz domen bloklandi: ${origin}`);
    return callback(new Error('CORS: Bu domen ruxsat etilmagan'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'],
  maxAge: 86400 // 24 soat preflight cache
}));

// ── SECURITY: Request body size limiti ──
app.use(express.json({
  limit: '5mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Railway reverse proxy ortida ishlaydi — cookie va IP to'g'ri ishlashi uchun
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ── SECURITY: Session Secret validation ──
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.warn('[⚠ SECURITY] SESSION_SECRET is missing or too short. Using random fallback.');
}

let sessionConfig = {
  secret: SESSION_SECRET || crypto.randomBytes(64).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: '/'
  }
};

const isPostgres = process.env.DATABASE_URL && 
                   (process.env.DATABASE_URL.startsWith('postgres://') || process.env.DATABASE_URL.startsWith('postgresql://')) &&
                   process.env.SESSION_STORE !== 'memory';

if (isPostgres) {
  try {
    const pgSession = require('connect-pg-simple')(session);
    const { Pool } = require('pg');
    const sessionPool = new Pool({
      connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
      ssl: { rejectUnauthorized: false },
      max: 2, // Limit concurrent connections to avoid exhausting database pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    sessionPool.on('error', (err) => {
      console.error('[Session Pool] Kutilmagan xato:', err.message);
    });
    sessionConfig.store = new pgSession({
      pool: sessionPool,
      tableName: 'session',
      createTableIfMissing: true
    });
    console.log('✅ PostgreSQL session store active');
  } catch (e) {
    console.error('⚠️ PostgreSQL session store error, falling back to MemoryStore:', e.message);
  }
} else {
  console.log('ℹ️ Local SQLite active, using MemoryStore for sessions');
}

app.use(session(sessionConfig));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1d', etag: true }));

const requestIdMiddleware = require('./middleware/requestId');
const healthRouter = require('./routes/health');
const { initializeDatabase } = require('./startup/initDb');
const { startBackgroundJobs, stopBackgroundJobs } = require('./startup/backgroundJobs');

app.use(requestIdMiddleware);

// ── HEALTH & READINESS PROBES (Cloud & Container Orchestration) ──
app.use(healthRouter);

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] [Req: ${req.id?.slice(0, 8)}] ${req.method} ${req.path}`);
  next();
});

// ── SECURITY MIDDLEWARE ──
const { rateLimiter } = require('./middleware/security');

app.use('/api', rateLimiter(600, 60000));    // API uchun global rate limit: 600 req/min

const { resolveTenant } = require('./middleware/tenant');

app.use(resolveTenant);

// ── API ROUTES ──
app.use('/api/auth',            require('./routes/auth'));
app.use('/api/dashboard',       require('./routes/dashboard'));
app.use('/api/deals',           require('./routes/deals'));
app.use('/api/nasiya',          require('./routes/nasiya'));
app.use('/api/extra',           require('./routes/extra'));
app.use('/api/clients',         require('./routes/clients'));
app.use('/api/companies',       require('./routes/companies'));
app.use('/api/expenses',        require('./routes/expenses'));
app.use('/api/tasks',           require('./routes/tasks'));
app.use('/api/kanban',          require('./routes/kanban'));
app.use('/api/notifications',   require('./routes/notifications'));
app.use('/api/product-catalog', require('./routes/productCatalog'));
app.use('/api/search',          require('./routes/search'));
app.use('/api/pipeline-stages', require('./routes/pipeline'));
app.use('/api/pipelines',       require('./routes/pipelines'));
app.use('/api/settings',        require('./routes/settings'));
app.use('/api/instagram',       require('./routes/instagram'));
app.use('/api/webhook',         require('./routes/webhook'));
app.use('/api/ai',              require('./routes/ai'));
app.use('/api/telegram',        require('./routes/telegram'));
app.use('/api/telegram',        require('./routes/telegramChat'));
app.use('/api/warehouse',       require('./routes/warehouse'));
app.use('/api/marketing',       require('./routes/marketing'));
app.use('/api/delivery',        require('./routes/delivery'));
app.use('/api/export',          require('./routes/export'));
app.use('/api/activity',        require('./routes/activity'));
app.use('/api/telephony',       require('./routes/telephony'));
app.use('/api/push',            require('./routes/push'));
app.use('/api/settings/backups',require('./routes/backups'));
app.use('/api/tools',           require('./routes/tools'));
app.use('/api/billing',         require('./routes/billing'));

// ── PUBLIC LEGAL PAGES (no auth required — Meta App Review uchun) ──
app.use('/', require('./routes/legal'));

// ── PAGE ROUTES ──
async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.redirect('/login');
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { id: true, email: true, password: true, fullName: true, role: true, isActive: true }
    });

    if (!user || !user.isActive) {
      req.session.destroy(() => {});
      res.clearCookie('__desco_sid');
      return res.redirect('/login');
    }

    if (req.session.passwordHash && req.session.passwordHash !== user.password) {
      req.session.destroy(() => {});
      res.clearCookie('__desco_sid');
      return res.redirect('/login');
    }

    req.session.passwordHash = user.password;
    req.session.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role
    };
    next();
  } catch (err) {
    console.warn('[requireAuth DB Connection Warning]', err.message);
    if (req.session && req.session.user) {
      return next();
    }
    return res.redirect('/login');
  }
}

const { requireRole } = require('./middleware/auth');
const { getCompanySettings } = require('./routes/settings');

app.get('/', requireAuth, requireRole('admin', 'manager', 'operator'), (req, res) => res.render('dashboard/index', { user: req.session.user, activePage: 'dashboard' }));
app.get('/deals',    requireAuth, requireRole('admin', 'manager', 'operator'), (req, res) => res.render('deals/index',    { user: req.session.user, activePage: 'deals' }));
app.get('/clients',  requireAuth, requireRole('admin', 'manager', 'operator'), (req, res) => res.render('clients/index',  { user: req.session.user, activePage: 'clients' }));
app.get('/expenses', requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('expenses/index', { user: req.session.user, activePage: 'expenses' }));
app.get('/extra/drivers',  requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('extra/index',  { user: req.session.user, activePage: 'extra-drivers', subPage: 'drivers' }));
app.get('/extra/branches', requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('extra/index',  { user: req.session.user, activePage: 'extra-branches', subPage: 'branches' }));
app.get('/extra/tools',    requireAuth, requireRole('admin'), (req, res) => res.render('extra/tools',  { user: req.session.user, activePage: 'extra-tools' }));
app.get('/tasks',    requireAuth, requireRole('admin', 'manager', 'operator'), (req, res) => res.render('tasks/index',    { user: req.session.user, activePage: 'tasks' }));
app.get('/trello',   requireAuth, requireRole('admin', 'manager', 'operator'), (req, res) => res.render('kanban/index',   { user: req.session.user, activePage: 'trello' }));
app.get('/kanban',   requireAuth, requireRole('admin', 'manager', 'operator'), (req, res) => res.render('kanban/index',   { user: req.session.user, activePage: 'trello' }));
app.get('/instagram', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const filter = req.query.filter || 'direct';
  res.render('instagram/index', { user: req.session.user, activePage: 'instagram-' + filter });
});
app.get('/telegram',  requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('telegram/index',  { user: req.session.user, activePage: 'telegram' }));
app.get('/telephony', requireAuth, requireRole('admin', 'manager', 'operator'), (req, res) => res.render('telephony/index', { user: req.session.user, activePage: 'telephony' }));
app.get('/ai',        requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('ai/index',        { user: req.session.user, activePage: 'ai' }));
app.get('/warehouse', requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('warehouse/index', { user: req.session.user, activePage: 'warehouse' }));
app.get('/nasiya',   requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('deals/index',    { user: req.session.user, activePage: 'nasiya' }));
app.get('/nasiya/list', requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('nasiya/index', { user: req.session.user, activePage: 'nasiya-' + req.query.stage, subPage: req.query.stage }));
app.get('/nasiya/qarzdorlar', requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('nasiya/qarzdorlar', { user: req.session.user, activePage: 'nasiya-qarzdorlar' }));
app.use('/plans', requireAuth, requireRole('admin', 'manager', 'operator'), require('./routes/plans'));
app.get('/design-system', requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('design-system/index', { user: req.session.user, activePage: 'design-system' }));

app.get('/settings', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const [pipelines, company] = await Promise.all([
      prisma.pipeline.findMany({
        include: { stages: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
        orderBy: [{ order: 'asc' }, { id: 'asc' }]
      }),
      getCompanySettings()
    ]);
    let users = [];
    if (req.session.user?.role === 'admin') {
      users = await prisma.user.findMany({
        select: { id: true, fullName: true, email: true, role: true, isActive: true, createdAt: true },
        orderBy: { createdAt: 'desc' }
      });
    }
    res.render('settings/index', { user: req.session.user, activePage: 'settings', pipelines, company, users });
  } catch (err) {
    console.error(err);
    res.render('settings/index', { user: req.session.user, activePage: 'settings', pipelines: [], company: {}, users: [] });
  }
});

app.get('/login',    (req, res) => { if (req.session && req.session.userId) return res.redirect('/'); res.render('auth/login'); });
app.get('/register', (req, res) => { res.redirect('/login?msg=' + encodeURIComponent("Kirish faqat administrator tomonidan beriladi")); });

// ── ERROR HANDLING ──
app.use((req, res) => {
  if (req.accepts('html') && !req.xhr && !req.path.startsWith('/api/')) {
    return res.redirect('/');
  }
  res.status(404).json({ message: 'Route not found', path: req.originalUrl });
});

// ── Error handler — production'da xavfsiz va to'g'ri yo'naltiruvchi ──
app.use((err, req, res, next) => {
  const statusCode = err.status || 500;
  console.error(`[ERROR] [Req: ${req.id?.slice(0, 8) || 'N/A'}] ${req.method} ${req.path}:`, err.message);

  if (req.accepts('html') && !req.xhr && !req.path.startsWith('/api/')) {
    if (statusCode === 401 || statusCode === 403 || err.message?.includes('auth') || err.message?.includes('session')) {
      return res.redirect('/login');
    }
    return res.redirect('/login');
  }

  res.status(statusCode).json({
    message: statusCode >= 500 ? 'Ichki server xatosi' : err.message,
    requestId: req.id
  });
});

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const cookieHeader = req.headers.cookie || '';
  const sessionIdMatch = cookieHeader.match(/connect\.sid=([^;]+)/);
  if (!sessionIdMatch) {
    ws.close(1008, 'Unauthorized');
    return;
  }
  ws.on('error', console.error);
});

// Broadcaster to all connected clients
app.set('wss', wss);
app.set('broadcast', (data) => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1 /* WebSocket.OPEN */) {
      client.send(JSON.stringify(data));
    }
  });
});

// Start HTTP server INSTANTLY
server.listen(PORT, () => {
  console.log(`
   ╔══════════════════════════════════════╗
   ║   DESCO CRM — Running on :${PORT}     ║
   ╚══════════════════════════════════════╝`);

  // Run background bootstrap asynchronously
  (async () => {
    try {
      await initializeDatabase();
      startBackgroundJobs();
    } catch (err) {
      console.error('[Background Bootstrap Warning]', err);
    }
  })();
});

// Global rejection & exception handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection] at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception] Xatolik:', error);
});

// Graceful shutdown
async function handleShutdown(signal) {
  console.log(`\n[Shutdown] Received ${signal}. Starting graceful shutdown...`);
  stopBackgroundJobs();

  server.close(async () => {
    console.log('[Shutdown] HTTP server closed.');
    try {
      await prisma.$disconnect();
      console.log('[Shutdown] Database connection closed.');
    } catch (e) {}
    process.exit(0);
  });

  // Force exit after 10s if hung
  setTimeout(() => {
    console.error('[Shutdown] Forced exit due to timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

module.exports = { app, server };
