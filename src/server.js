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

app.use(helmet({ contentSecurityPolicy: false, hsts: false }));
app.use(cors());
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

// ── API ROUTES ──
app.get('/api/health', (req, res) => res.json({ status: 'OK', message: 'DESCO CRM is running' }));

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
app.use('/api/webhooks',        require('./routes/webhook'));
app.use('/api/webhook',         require('./routes/webhook'));
app.use('/api/ai',              require('./routes/ai'));

// ── PAGE ROUTES ──
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

const { getStages } = require('./routes/pipeline');
const { getCompanySettings } = require('./routes/settings');

app.get('/', requireAuth, (req, res) => res.render('dashboard/index', { user: req.session.user, activePage: 'dashboard' }));
app.get('/deals',    requireAuth, (req, res) => res.render('deals/index',    { user: req.session.user, activePage: 'deals' }));
app.get('/clients',  requireAuth, (req, res) => res.render('clients/index',  { user: req.session.user, activePage: 'clients' }));
app.get('/expenses', requireAuth, (req, res) => res.render('expenses/index', { user: req.session.user, activePage: 'expenses' }));
app.get('/extra/drivers',  requireAuth, (req, res) => res.render('extra/index',  { user: req.session.user, activePage: 'extra-drivers', subPage: 'drivers' }));
app.get('/extra/branches', requireAuth, (req, res) => res.render('extra/index',  { user: req.session.user, activePage: 'extra-branches', subPage: 'branches' }));
app.get('/tasks',    requireAuth, (req, res) => res.render('tasks/index',    { user: req.session.user, activePage: 'tasks' }));
app.get('/instagram', requireAuth, (req, res) => res.render('instagram/index', { user: req.session.user, activePage: 'instagram' }));
app.get('/ai',        requireAuth, (req, res) => res.render('ai/index',        { user: req.session.user, activePage: 'ai' }));
app.get('/nasiya',   requireAuth, (req, res) => res.render('deals/index',    { user: req.session.user, activePage: 'nasiya' }));
app.get('/nasiya/list', requireAuth, (req, res) => res.render('nasiya/index', { user: req.session.user, activePage: 'nasiya-' + req.query.stage, subPage: req.query.stage }));
app.get('/design-system', requireAuth, (req, res) => res.render('design-system/index', { user: req.session.user, activePage: 'design-system' }));

app.get('/settings', requireAuth, async (req, res) => {
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
      users = await prisma.user.findMany({ select: { id: true, email: true, fullName: true, role: true, createdAt: true } });
    }
    res.render('settings/index', { user: req.session.user, activePage: 'settings', pipelines, company, users });
  } catch (err) {
    console.error(err);
    res.render('settings/index', { user: req.session.user, activePage: 'settings', pipelines: [], company: {}, users: [] });
  }
});

app.get('/login',    (req, res) => { if (req.session.userId) return res.redirect('/'); res.render('auth/login'); });
app.get('/register', (req, res) => { if (req.session.userId) return res.redirect('/'); res.render('auth/register'); });

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

wss.on('connection', (ws) => {
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

runMigrations(prisma).then(() => {
  server.listen(PORT, () => {
    console.log(`
  ╔══════════════════════════════════════╗
  ║   DESCO CRM — Running on :${PORT}     ║
  ╚══════════════════════════════════════╝`);
  });
}).catch(err => {
  console.error('Migration xatosi:', err);
  // Migratsiya muvaffaqiyatsiz bo'lsa ham server'ni ishga tushiramiz
  server.listen(PORT, () => {
    console.log(`DESCO CRM — Running on :${PORT} (migration errors ignored)`);
  });
});

module.exports = { app, server };
