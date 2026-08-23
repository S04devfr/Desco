const path = require('path');
const bcrypt = require('bcryptjs');
const prisma = require('../config/database');
const { ensureAuditTable } = require('../middleware/auditLog');
const runMigrations = require('../db-migrate');

async function autoMigrateDatabase() {
  try {
    const isPostgres = process.env.DATABASE_URL && (process.env.DATABASE_URL.startsWith('postgres://') || process.env.DATABASE_URL.startsWith('postgresql://'));
    if (!isPostgres) return;

    const queries = [
      'ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "phone2" TEXT;',
      'ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "phone2" TEXT;',
      'ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "contactPhone2" TEXT;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "boardId" INTEGER;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "columnId" INTEGER;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "order" INTEGER DEFAULT 0;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN DEFAULT false;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "reminderMinutes" INTEGER;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "reminderSent" BOOLEAN DEFAULT false;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "labels" TEXT;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP;',
      `CREATE TABLE IF NOT EXISTS "user_session_logs" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "date" VARCHAR(20) NOT NULL,
        "firstLogin" TIMESTAMP NOT NULL DEFAULT NOW(),
        "lastPing" TIMESTAMP NOT NULL DEFAULT NOW(),
        "activeSeconds" INTEGER NOT NULL DEFAULT 0,
        "idleSeconds" INTEGER NOT NULL DEFAULT 0,
        "status" VARCHAR(20) NOT NULL DEFAULT 'active',
        "totalActions" INTEGER NOT NULL DEFAULT 0,
        "device" VARCHAR(255),
        "ipAddress" VARCHAR(50),
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT "unique_user_date" UNIQUE ("userId", "date")
      );`,
      `CREATE INDEX IF NOT EXISTS "idx_usl_userId" ON "user_session_logs"("userId");`,
      `CREATE INDEX IF NOT EXISTS "idx_usl_date" ON "user_session_logs"("date");`,
      `CREATE INDEX IF NOT EXISTS "idx_usl_lastPing" ON "user_session_logs"("lastPing");`
    ];
    for (const q of queries) {
      try {
        await prisma.$executeRawUnsafe(q);
      } catch (_) {}
    }
  } catch (err) {
    console.warn('[Database] Auto-migration warning:', err.message);
  }
}

async function ensureDefaultTaskBoard() {
  try {
    const boardCount = await prisma.taskBoard.count().catch(() => 0);
    if (boardCount === 0) {
      console.log('⚡ Seeding default Trello Task Board & Columns...');
      const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
      const board = await prisma.taskBoard.create({
        data: {
          name: 'Asosiy Vazifalar',
          description: 'Kompaniyaning asosiy vazifalari va eslatmalari',
          color: '#007AFF',
          icon: 'fa-clipboard-list',
          isDefault: true,
          createdById: admin ? admin.id : null,
          columns: {
            create: [
              { name: 'Yangi', color: '#007AFF', icon: 'fa-inbox', order: 0 },
              { name: 'Jarayonda', color: '#F59E0B', icon: 'fa-spinner', order: 1 },
              { name: 'Kutilmoqda', color: '#8B5CF6', icon: 'fa-clock', order: 2 },
              { name: 'Yakunlandi', color: '#10B981', icon: 'fa-check-circle', order: 3 }
            ]
          }
        },
        include: { columns: true }
      }).catch(() => null);

      if (board && board.columns.length > 0) {
        const firstCol = board.columns[0];
        await prisma.task.updateMany({
          where: { boardId: null },
          data: { boardId: board.id, columnId: firstCol.id }
        }).catch(() => {});
      }
      console.log('✅ Default Trello Task Board & Columns seeded.');
    }
  } catch (err) {
    console.warn('[Task Board Seed Notice]', err.message);
  }
}

async function ensureDefaultSeed() {
  try {
    const dealCount = await prisma.deal.count().catch(() => 0);
    if (dealCount === 0) {
      console.log('⚡ Railway Database has 0 deals. Checking seed script...');
      try {
        const runFastSeed = require(path.join(__dirname, '../../prisma/seed.js'));
        if (typeof runFastSeed === 'function') {
          await runFastSeed();
        }
      } catch (e) {
        console.log('[Seed Notice]', e.message);
      }
    }

    const existingAdmin = await prisma.user.findFirst({
      where: { email: 'admin@desco.com' }
    }).catch(() => null);

    if (!existingAdmin) {
      console.log('⚡ Seeding default admin & pipeline into database...');
      const adminPass = await bcrypt.hash(process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@Desco2026!', 12);
      const muhammadPass = await bcrypt.hash(process.env.DEFAULT_ADMIN2_PASSWORD || 'Muhammad@Desco2026!', 12);

      await prisma.user.createMany({
        data: [
          { fullName: 'Administrator', email: 'admin@desco.com', password: adminPass, role: 'admin' },
          { fullName: 'Muhammadyusuf', email: 'muhammad@desco.com', password: muhammadPass, role: 'admin' }
        ],
        skipDuplicates: true
      }).catch(() => {});

      let pipeline = await prisma.pipeline.findFirst({ where: { isDefault: true } });
      if (!pipeline) {
        await prisma.pipeline.create({
          data: { name: 'Asosiy voronka', isDefault: true, color: '#007AFF', order: 1 }
        }).catch(() => null);
      }
      console.log('✅ Default admin & pipeline verified.');
    }
  } catch (err) {
    console.warn('[Seed Check Notice]', err.message || err);
  }
}

/**
 * Run all database initialization and bootstrap tasks
 */
async function initializeDatabase() {
  await autoMigrateDatabase();
  await runMigrations(prisma);
  await ensureAuditTable();
  await ensureDefaultTaskBoard();
  await ensureDefaultSeed();
}

module.exports = {
  initializeDatabase,
  autoMigrateDatabase,
  ensureDefaultTaskBoard,
  ensureDefaultSeed
};
