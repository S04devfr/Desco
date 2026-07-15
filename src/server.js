const express = require('express');
const dotenv = require('dotenv');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const http = require('http');
const { WebSocketServer } = require('ws');

dotenv.config();

const app = express();

// ── SECURITY HEADERS (Helmet) ──
app.use(helmet({
  contentSecurityPolicy: false,  // EJS templates uchun
  hsts: { maxAge: 31536000, includeSubDomains: true },
  frameguard: { action: 'deny' },
  xssFilter: true,
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// ── CORS — faqat ruxsat etilgan domenlar ──
app.use(cors({
  origin: [
    'https://desco-production.up.railway.app',
    'http://localhost:3000'
  ],
  credentials: true
}));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// Railway reverse proxy ortida ishlaydi — cookie va IP to'g'ri ishlashi uchun
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.static(path.join(__dirname, '../public')));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── SECURITY MIDDLEWARE ──
const { rateLimiter, sanitizeResponse } = require('./middleware/security');
app.use('/api', sanitizeResponse);          // Barcha API javoblardan sensitive ma'lumotlarni tozalash
app.use('/api', rateLimiter(200, 60000));    // API uchun global rate limit: 200 req/min

// ── API ROUTES ──
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ── ONE-TIME: Seed data ──


app.use('/api/auth',            require('./routes/auth'));
app.use('/api/dashboard',       require('./routes/dashboard'));
app.use('/api/deals',           require('./routes/deals'));
app.use('/api/nasiya',          require('./routes/nasiya'));
app.use('/api/extra',           require('./routes/extra'));
app.use('/api/clients',         require('./routes/clients'));
app.use('/api/expenses',        require('./routes/expenses'));
app.use('/api/tasks',           require('./routes/tasks'));
app.use('/api/notifications',   require('./routes/notifications'));
app.use('/api/product-catalog', require('./routes/productCatalog'));
app.use('/api/search',          require('./routes/search'));
app.use('/api/pipeline-stages', require('./routes/pipeline'));
app.use('/api/pipelines',       require('./routes/pipelines'));
app.use('/api/settings',        require('./routes/settings'));
app.use('/api/instagram',       require('./routes/instagram'));
app.use('/api/webhook',         require('./routes/webhook'));
app.use('/api/ai',              require('./routes/ai'));
app.use('/api/warehouse',       require('./routes/warehouse'));
app.use('/api/marketing',       require('./routes/marketing'));
app.use('/api/delivery',        require('./routes/delivery'));
app.use('/api/export',          require('./routes/export'));
app.use('/api/activity',        require('./routes/activity'));

// ── PUBLIC LEGAL PAGES (no auth required — Meta App Review uchun) ──
app.use('/', require('./routes/legal'));

// ── PAGE ROUTES ──
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

const { requireRole } = require('./middleware/auth');
const { getStages } = require('./routes/pipeline');
const { getCompanySettings } = require('./routes/settings');

app.get('/', requireAuth, requireRole('admin', 'manager', 'operator'), (req, res) => res.render('dashboard/index', { user: req.session.user, activePage: 'dashboard' }));
app.get('/deals',    requireAuth, requireRole('admin', 'manager', 'operator'), (req, res) => res.render('deals/index',    { user: req.session.user, activePage: 'deals' }));
app.get('/clients',  requireAuth, requireRole('admin', 'manager', 'operator'), (req, res) => res.render('clients/index',  { user: req.session.user, activePage: 'clients' }));
app.get('/expenses', requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('expenses/index', { user: req.session.user, activePage: 'expenses' }));
app.get('/extra/drivers',  requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('extra/index',  { user: req.session.user, activePage: 'extra-drivers', subPage: 'drivers' }));
app.get('/extra/branches', requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('extra/index',  { user: req.session.user, activePage: 'extra-branches', subPage: 'branches' }));
app.get('/tasks',    requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('tasks/index',    { user: req.session.user, activePage: 'tasks' }));
app.get('/instagram', requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('instagram/index', { user: req.session.user, activePage: 'instagram' }));
app.get('/ai',        requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('ai/index',        { user: req.session.user, activePage: 'ai' }));
app.get('/warehouse', requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('warehouse/index', { user: req.session.user, activePage: 'warehouse' }));
app.get('/nasiya',   requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('deals/index',    { user: req.session.user, activePage: 'nasiya' }));
app.get('/nasiya/list', requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('nasiya/index', { user: req.session.user, activePage: 'nasiya-' + req.query.stage, subPage: req.query.stage }));
app.get('/design-system', requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('design-system/index', { user: req.session.user, activePage: 'design-system' }));

app.get('/settings', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const prisma = require('./config/database');
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

app.get('/login',    (req, res) => { if (req.session.userId) return res.redirect('/'); res.render('auth/login'); });
app.get('/register', (req, res) => { res.redirect('/login?msg=' + encodeURIComponent("Kirish faqat administrator tomonidan beriladi")); });

// ── ERROR HANDLING ──
app.use((req, res) => res.status(404).json({ message: 'Route not found' }));

app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 3000;
const runMigrations = require('./db-migrate');
const prisma = require('./config/database');

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Session cookie'dan userId ni tekshirish
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

// Audit log jadvalini yaratish
const { ensureAuditTable } = require('./middleware/auditLog');

// Haqiqiy dublikatlarni tozalash: bir xil title va dealId bo'lgan faqat takroriy vazifalarni o'chirish
// (Har restartda BARCHA vazifalarni o'chirish o'rniga faqat nomi va deali bir xil bo'lgan takroriylarni o'chiradi)
async function cleanupDuplicateTasks() {
  try {
    console.log('[Cleanup] Dublikat vazifalarni tekshirish...');

    const activeTasks = await prisma.task.findMany({
      where: { completed: false, dealId: { not: null } },
      orderBy: { id: 'desc' },
      select: { id: true, dealId: true, title: true }
    });

    // Bir xil dealId + title kombinatsiyasi uchun dublikatlarni topish
    const seen = new Set();
    const toDeleteIds = [];

    for (const task of activeTasks) {
      const key = `${task.dealId}:${task.title}`;
      if (seen.has(key)) {
        toDeleteIds.push(task.id);
      } else {
        seen.add(key);
      }
    }

    if (toDeleteIds.length > 0) {
      const result = await prisma.task.deleteMany({
        where: { id: { in: toDeleteIds } }
      });
      console.log(`[Cleanup] ${result.count} ta haqiqiy dublikat vazifa o'chirildi.`);
    } else {
      console.log('[Cleanup] Dublikat vazifalar topilmadi.');
    }
  } catch (e) {
    console.error('[Cleanup] Dublikatlarni tozalashda xato:', e);
  }
}

// DB Push is now handled by package.json "prestart" script during deployment.

runMigrations(prisma).then(async () => {
  await ensureAuditTable();
  await cleanupDuplicateTasks();
  server.listen(PORT, () => {
    console.log(`
   ╔══════════════════════════════════════╗
   ║   DESCO CRM — Running on :${PORT}     ║
   ╚══════════════════════════════════════╝`);
  });
}).catch(async (err) => {
  console.error('Migration xatosi:', err);
  await cleanupDuplicateTasks();
  // Migratsiya muvaffaqiyatsiz bo'lsa ham server'ni ishga tushiramiz
  server.listen(PORT, () => {
    console.log(`DESCO CRM — Running on :${PORT} (migration errors ignored)`);
  });
});

// Global xatoliklarni ushlab qolish (Crash larning oldini olish)
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection] at:', promise, 'reason:', reason);
  // Dasturni to'xtatmaymiz (Railway'da 502 bo'lmasligi uchun)
});

process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception] Xatolik:', error);
  // Tizim holatini tekshirib sekinlashtirish mumkin, lekin crash qildirmaymiz
});

module.exports = { app, server };
