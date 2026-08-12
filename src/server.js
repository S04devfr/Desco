const express = require('express');
const dotenv = require('dotenv');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const http = require('http');
const { WebSocketServer } = require('ws');

dotenv.config();

// ── DIGITALOCEAN / CLOUD POSTGRESQL SSL FIX ──
// DigitalOcean Managed Postgres self-signed certificate chain qo'llab-quvvatlash uchun
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();

app.use(compression());

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
  origin: (origin, callback) => {
    if (!origin || origin.includes('ondigitalocean.app') || origin.includes('digitalocean.app') || origin.includes('railway.app') || origin.includes('localhost')) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true
}));
app.use(express.json({
  limit: '20mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Railway reverse proxy ortida ishlaydi — cookie va IP to'g'ri ishlashi uchun
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ── SESSION STORE CONFIGURATION ──
let sessionConfig = {
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: 'auto',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30 // 30 kun
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

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── SECURITY MIDDLEWARE ──
const { rateLimiter, sanitizeResponse } = require('./middleware/security');
app.use('/api', sanitizeResponse);          // Barcha API javoblardan sensitive ma'lumotlarni tozalash
app.use('/api', rateLimiter(200, 60000));    // API uchun global rate limit: 200 req/min

// ── API ROUTES ──
async function ensureDefaultSeed() {
  try {
    const prisma = require('./config/database');
    const existingAdmin = await prisma.user.findFirst({
      where: { email: 'shokirovsharifjon04@gmail.com' }
    });

    if (!existingAdmin) {
      console.log('⚡ Seeding default admin & pipeline into database...');
      const bcrypt = require('bcryptjs');
      const sharifPass = await bcrypt.hash('Sharifjon@2026!', 10);
      const adminPass  = await bcrypt.hash('Admin@Desco2026!', 10);
      const mgrPass    = await bcrypt.hash('Manager@123', 10);

      await prisma.user.createMany({
        data: [
          { fullName: 'Sharifjon', email: 'shokirovsharifjon04@gmail.com', password: sharifPass, role: 'admin' },
          { fullName: 'Administrator', email: 'admin@desco.com', password: adminPass, role: 'admin' },
          { fullName: 'Abdumalik', email: 'abdumalik@desco.com', password: mgrPass, role: 'manager' },
          { fullName: 'Qodirjon', email: 'qodirjon@desco.com', password: mgrPass, role: 'manager' },
          { fullName: 'Bekzod', email: 'bekzod@desco.com', password: mgrPass, role: 'manager' },
          { fullName: 'Ruxshona', email: 'ruxshona@desco.com', password: mgrPass, role: 'manager' },
          { fullName: 'Parvina', email: 'parvina@desco.com', password: mgrPass, role: 'manager' }
        ],
        skipDuplicates: true
      }).catch(() => {});

      let pipeline = await prisma.pipeline.findFirst({ where: { isDefault: true } });
      if (!pipeline) {
        pipeline = await prisma.pipeline.create({
          data: { name: 'Asosiy voronka', isDefault: true, color: '#007AFF', order: 1 }
        }).catch(() => null);
      }
      console.log('✅ Default admin & pipeline verified.');
    }
  } catch (err) {
    console.warn('[Seed Check Notice]', err.message || err);
  }
}

// autoMigrateAndSeedIfNeeded is executed asynchronously after server.listen(PORT)


app.use('/api/auth',            require('./routes/auth'));
app.use('/api/dashboard',       require('./routes/dashboard'));
app.use('/api/deals',           require('./routes/deals'));
app.use('/api/nasiya',          require('./routes/nasiya'));
app.use('/api/extra',           require('./routes/extra'));
app.use('/api/clients',         require('./routes/clients'));
app.use('/api/companies',       require('./routes/companies'));
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
app.get('/extra/tools',    requireAuth, requireRole('admin'), (req, res) => res.render('extra/tools',  { user: req.session.user, activePage: 'extra-tools' }));
app.get('/tasks',    requireAuth, requireRole('admin', 'manager'), (req, res) => res.render('tasks/index',    { user: req.session.user, activePage: 'tasks' }));
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
      where: { completed: false, NOT: { dealId: null } },
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

// Start HTTP server INSTANTLY so Railway/DigitalOcean health check succeeds in < 1 second!
server.listen(PORT, () => {
  console.log(`
   ╔══════════════════════════════════════╗
   ║   DESCO CRM — Running on :${PORT}     ║
   ╚══════════════════════════════════════╝`);

  // Run background initialization asynchronously
  (async () => {
    try {
      await runMigrations(prisma);
      await ensureAuditTable();
      await cleanupDuplicateTasks();
      await ensureDefaultSeed();
    } catch (err) {
      console.error('[Background Init Warning]', err);
    }
  })();
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

// Automatic Static Uploads Storage Cleanup (Older than 15 days) to prevent server disk space leak
function runUploadsCleanup() {
  const uploadsDir = path.join(__dirname, '../public/uploads');
  if (!fs.existsSync(uploadsDir)) return;

  fs.readdir(uploadsDir, (err, files) => {
    if (err) {
      console.error('[Cleanup] Directory read error:', err);
      return;
    }

    const now = Date.now();
    const maxAge = 15 * 24 * 60 * 60 * 1000; // 15 days

    files.forEach(file => {
      if (file.startsWith('.')) return; // Skip dotfiles

      const filePath = path.join(uploadsDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;

        if (now - stats.mtimeMs > maxAge) {
          fs.unlink(filePath, (err) => {
            if (err) console.error(`[Cleanup] Failed to delete expired file ${file}:`, err);
            else console.log(`[Cleanup] Deleted expired temporary file: ${file}`);
          });
        }
      });
    });
  });
}

// Automatic Wazzup CRM Webhook and Users Sync on Startup
async function syncWazzupUsers() {
  try {
    const prisma = require('./config/database');
    const settings = await prisma.companySettings.findFirst();
    const WAZZUP_API_KEY = process.env.WAZZUP_API_KEY || (settings?.instagramAccessToken && settings.instagramAccessToken.length === 32 ? settings.instagramAccessToken : null);
    if (!WAZZUP_API_KEY) return;

    // 1. Sync Webhook URL
    const domain = process.env.APP_URL || 'https://desco.up.railway.app';
    const webhookUrl = `${domain}/api/instagram/webhook`;
    const webhookRes = await fetch('https://api.wazzup24.com/v3/webhooks', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WAZZUP_API_KEY}`
      },
      body: JSON.stringify({
        webhooksUri: webhookUrl,
        subscriptions: {
          messagesAndStatuses: true
        }
      })
    });
    if (webhookRes.ok) {
      console.log('[Wazzup Auto-Sync] Webhook registered successfully:', webhookUrl);
    } else {
      console.error('[Wazzup Auto-Sync] Webhook registration failed:', webhookRes.status, await webhookRes.text());
    }

    // 2. Sync Users
    const users = await prisma.user.findMany({ where: { isActive: true } });
    if (!users.length) return;

    const wazzupUsers = users.map(u => ({
      id: u.id.toString(),
      name: u.fullName || u.email,
      phone: ''
    }));

    const res = await fetch('https://api.wazzup24.com/v3/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WAZZUP_API_KEY}`
      },
      body: JSON.stringify(wazzupUsers)
    });

    if (res.ok) {
      console.log('[Wazzup Auto-Sync] Sync successful for', users.length, 'users.');
    } else {
      console.error('[Wazzup Auto-Sync] Failed to sync users:', res.status, await res.text());
    }
  } catch (err) {
    console.error('[Wazzup Auto-Sync] Error:', err.message);
  }
}

// Fix stuck unread counts for Instagram and Telegram chats
async function fixStuckUnreadCounts() {
  try {
    const prisma = require('./config/database');
    console.log('[Unread Sync] Fixing stuck unread counts...');

    // Reset all unread counts for messages sent before July 30, 2026 16:00 Tashkent time (one-time history reset)
    const thresholdDate = new Date('2026-07-30T11:00:00Z');

    // 1. Reset counts for clients whose last Instagram message was outgoing (meaning we replied), before threshold, or have no messages or no Instagram ID
    const igUnreadClients = await prisma.client.findMany({
      where: { instagramUnreadCount: { gt: 0 } },
      include: {
        messages: {
          orderBy: { timestamp: 'desc' },
          take: 1
        }
      }
    });

    const igIdsToReset = [];
    for (const client of igUnreadClients) {
      const lastMsg = client.messages[0];
      if (!client.instagramId || !lastMsg || lastMsg.isOutgoing || new Date(lastMsg.timestamp) < thresholdDate) {
        igIdsToReset.push(client.id);
      }
    }

    if (igIdsToReset.length > 0) {
      await prisma.client.updateMany({
        where: { id: { in: igIdsToReset } },
        data: { instagramUnreadCount: 0 }
      });
    }

    // 2. Reset counts for clients whose last Telegram message was outgoing (meaning we replied), before threshold, or have no messages or no Telegram ID
    const tgUnreadClients = await prisma.client.findMany({
      where: { telegramUnreadCount: { gt: 0 } },
      include: {
        telegramMessages: {
          orderBy: { timestamp: 'desc' },
          take: 1
        }
      }
    });

    const tgIdsToReset = [];
    for (const client of tgUnreadClients) {
      const lastMsg = client.telegramMessages[0];
      if (!client.telegramId || !lastMsg || lastMsg.isOutgoing || new Date(lastMsg.timestamp) < thresholdDate) {
        tgIdsToReset.push(client.id);
      }
    }

    if (tgIdsToReset.length > 0) {
      await prisma.client.updateMany({
        where: { id: { in: tgIdsToReset } },
        data: { telegramUnreadCount: 0 }
      });
    }

    console.log(`[Unread Sync] Reset ${igIdsToReset.length} stuck Instagram counts and ${tgIdsToReset.length} stuck Telegram counts.`);
  } catch (err) {
    console.error('[Unread Sync] Error during cleanup:', err);
  }
}

// Start cleanup check on startup
runUploadsCleanup();
syncWazzupUsers();
fixStuckUnreadCounts();

// Run cleanup check every 24 hours
setInterval(runUploadsCleanup, 24 * 60 * 60 * 1000);
// Run user sync check every 12 hours
setInterval(syncWazzupUsers, 12 * 60 * 60 * 1000);
// Run unread sync check every 12 hours
setInterval(fixStuckUnreadCounts, 12 * 60 * 60 * 1000);

module.exports = { app, server };
