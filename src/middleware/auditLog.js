/**
 * Audit Log — Barcha muhim amallarni alohida jadvalga yozadi.
 * 
 * Loglanadigan hodisalar:
 *  - login / logout (kim, qachon, IP)
 *  - Webhook kelishi (page_id, leadgen_id)
 *  - AI chatbot so'rovlari (faqat savol, javob emas)
 *  - Deal yaratish/o'zgartirish/o'chirish
 */

const prisma = require('../config/database');

/**
 * Server startup'da audit_logs jadvalini yaratadi (agar mavjud bo'lmasa).
 */
async function ensureAuditTable() {
  try {
    const isSQLite = process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('.db') || process.env.DATABASE_URL.startsWith('file:'));
    if (isSQLite) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "audit_logs" (
          "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
          "action"     VARCHAR(100) NOT NULL,
          "details"    TEXT,
          "userId"     INTEGER,
          "userEmail"  VARCHAR(255),
          "ipAddress"  VARCHAR(50),
          "userAgent"  VARCHAR(500),
          "createdAt"  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } else {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "audit_logs" (
          "id"         SERIAL PRIMARY KEY,
          "action"     VARCHAR(100) NOT NULL,
          "details"    TEXT,
          "userId"     INTEGER,
          "userEmail"  VARCHAR(255),
          "ipAddress"  VARCHAR(50),
          "userAgent"  VARCHAR(500),
          "createdAt"  TIMESTAMP DEFAULT NOW()
        );
      `);
    }
    console.log('[Audit] ✓ audit_logs jadvali tayyor');
  } catch (err) {
    console.warn('[Audit] Jadval yaratishda xato (muhim emas):', err.message);
  }
}

/**
 * Audit log yozish — asinxron, xato bo'lsa tizimni to'xtatmaydi.
 * 
 * @param {string} action    — "LOGIN", "LOGOUT", "WEBHOOK_RECEIVED", "AI_QUERY", "DEAL_CREATE" va h.k.
 * @param {string} details   — Qo'shimcha ma'lumot
 * @param {number|null} userId — Foydalanuvchi ID (agar mavjud bo'lsa)
 * @param {string|null} userEmail — Foydalanuvchi email
 * @param {string|null} ipAddress — So'rov yuboruvchi IP
 * @param {string|null} userAgent — Browser/Client ma'lumoti
 */
async function logAudit(action, details = '', userId = null, userEmail = null, ipAddress = null, userAgent = null) {
  try {
    // Details ni 2000 belgiga cheklash
    const safeDetails = details ? String(details).substring(0, 2000) : '';
    const safeAgent = userAgent ? String(userAgent).substring(0, 500) : '';

    const isSQLite = process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('.db') || process.env.DATABASE_URL.startsWith('file:'));

    if (isSQLite) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "audit_logs" ("action", "details", "userId", "userEmail", "ipAddress", "userAgent")
         VALUES (?, ?, ?, ?, ?, ?)`,
        action,
        safeDetails,
        userId,
        userEmail,
        ipAddress || '',
        safeAgent
      );
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "audit_logs" ("action", "details", "userId", "userEmail", "ipAddress", "userAgent")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        action,
        safeDetails,
        userId,
        userEmail,
        ipAddress || '',
        safeAgent
      );
    }
  } catch (err) {
    // Audit log xatosi tizimni to'xtatmasligi kerak
    console.warn(`[Audit] Log yozishda xato: ${err.message}`);
  }
}

/**
 * Express request dan audit ma'lumotlarni ajratib olish helper.
 */
function getAuditContext(req) {
  return {
    userId: req.userId || req.session?.userId || null,
    userEmail: req.user?.email || req.session?.user?.email || null,
    ipAddress: req.ip || req.connection?.remoteAddress || '',
    userAgent: req.headers?.['user-agent'] || ''
  };
}

module.exports = {
  ensureAuditTable,
  logAudit,
  getAuditContext
};
