/**
 * Menejer faollik / online vaqt kuzatuvi
 * POST /api/activity/ping   — heartbeat (har 2 daqiqada)
 * GET  /api/activity/stats  — bugun + hafta statistikasi (admin)
 * GET  /api/activity/online — hozir kim online (lastPing < 5 min)
 */
const router  = require('express').Router()
const prisma  = require('../config/database')
const { protect, requireRole } = require('../middleware/auth')

router.use(protect)

// ── helpers ──────────────────────────────────────────────────────────────────
function toUzDate(d) {
  return new Date(d).toISOString().slice(0, 10)   // "YYYY-MM-DD"
}
function nowISO() {
  return new Date().toISOString()
}
// minutes between two ISO strings
function minDiff(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 60000)
}

// ── POST /ping ────────────────────────────────────────────────────────────────
// Frontend every 2 min → keeps session alive; gaps > 8 min = new session
router.post('/ping', async (req, res) => {
  try {
    const userId = req.userId
    const today  = toUzDate(new Date())
    const now    = nowISO()
    const GAP    = 8 * 60 * 1000   // 8 min gap = new session

    // Find most recent active session for today
    const rows = await prisma.$queryRaw`
      SELECT * FROM "UserActivityLog"
      WHERE "userId" = ${userId} AND "date" = ${today} AND "isActive" = 1
      ORDER BY "lastPing" DESC LIMIT 1
    `
    const session = rows[0]

    if (session && (Date.now() - new Date(session.lastPing).getTime()) < GAP) {
      // Extend existing session
      const dur = minDiff(session.sessionStart, now)
      await prisma.$executeRaw`
        UPDATE "UserActivityLog"
        SET "lastPing" = ${now}, "durationMin" = ${dur}, "updatedAt" = ${now}
        WHERE "id" = ${session.id}
      `
    } else {
      // Close old session if exists
      if (session) {
        const dur = minDiff(session.sessionStart, session.lastPing)
        await prisma.$executeRaw`
          UPDATE "UserActivityLog"
          SET "isActive" = 0, "durationMin" = ${dur}, "updatedAt" = ${now}
          WHERE "id" = ${session.id}
        `
      }
      // Start fresh session
      await prisma.$executeRaw`
        INSERT INTO "UserActivityLog"
        ("userId", "date", "sessionStart", "lastPing", "durationMin", "isActive", "createdAt", "updatedAt")
        VALUES (${userId}, ${today}, ${now}, ${now}, 0, 1, ${now}, ${now})
      `
    }

    res.json({ ok: true, ts: now })
  } catch (err) {
    console.error('[activity/ping]', err.message)
    res.json({ ok: false })   // never 500 — client ignores errors silently
  }
})

// ── GET /online ───────────────────────────────────────────────────────────────
// Returns array of userIds who pinged in last 5 minutes
router.get('/online', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const rows = await prisma.$queryRaw`
      SELECT DISTINCT u.id, u.fullName, u.email, u.role
      FROM "UserActivityLog" a
      JOIN "User" u ON u.id = a."userId"
      WHERE a."lastPing" >= ${cutoff} AND a."isActive" = 1
    `
    res.json(rows)
  } catch (err) {
    res.json([])
  }
})

// ── GET /stats ────────────────────────────────────────────────────────────────
// Per-manager breakdown: today + last 7 days total minutes
router.get('/stats', requireRole('admin'), async (req, res) => {
  try {
    const today      = toUzDate(new Date())
    const weekAgo    = toUzDate(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000))
    const cutoff5min = new Date(Date.now() - 5 * 60 * 1000).toISOString()

    // Today minutes per user
    const todayRows = await prisma.$queryRaw`
      SELECT "userId",
             SUM("durationMin") AS "todayMin",
             MAX("lastPing")    AS "lastSeen"
      FROM   "UserActivityLog"
      WHERE  "date" = ${today}
      GROUP BY "userId"
    `

    // Week total per user
    const weekRows = await prisma.$queryRaw`
      SELECT "userId",
             SUM("durationMin") AS "weekMin"
      FROM   "UserActivityLog"
      WHERE  "date" >= ${weekAgo}
      GROUP BY "userId"
    `

    // Online now
    const onlineRows = await prisma.$queryRaw`
      SELECT DISTINCT "userId"
      FROM "UserActivityLog"
      WHERE "lastPing" >= ${cutoff5min} AND "isActive" = 1
    `

    const todayMap  = {}
    const weekMap   = {}
    const onlineSet = new Set()

    todayRows.forEach(r => { todayMap[r.userId]  = { min: Number(r.todayMin || 0), lastSeen: r.lastSeen } })
    weekRows.forEach(r  => { weekMap[r.userId]   = Number(r.weekMin || 0) })
    onlineRows.forEach(r => onlineSet.add(Number(r.userId)))

    // All managers (using standard database-agnostic Prisma Client instead of raw SQL)
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: ['admin', 'manager'] }
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true
      },
      orderBy: {
        fullName: 'asc'
      }
    })

    const result = users.map(u => {
      const uid      = Number(u.id)
      const todayMin = todayMap[uid]?.min  || 0
      const weekMin  = weekMap[uid]        || 0
      const lastSeen = todayMap[uid]?.lastSeen || null
      const online   = onlineSet.has(uid)
      return {
        userId:   uid,
        name:     u.fullName || u.email,
        email:    u.email,
        role:     u.role,
        online,
        todayMin,
        todayHours: (todayMin / 60).toFixed(1),
        weekMin,
        weekHours:  (weekMin / 60).toFixed(1),
        lastSeen,
      }
    })

    // Also return a daily breakdown for charting (last 7 days)
    const dailyRows = await prisma.$queryRaw`
      SELECT "userId", "date", SUM("durationMin") AS "totalMin"
      FROM   "UserActivityLog"
      WHERE  "date" >= ${weekAgo}
      GROUP BY "userId", "date"
      ORDER BY "date"
    `

    res.json({ managers: result, daily: dailyRows })
  } catch (err) {
    console.error('[activity/stats]', err.message)
    res.json({ managers: [], daily: [] })
  }
})

module.exports = router
