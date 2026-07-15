const express = require('express')
const prisma = require('../config/database')
const { protect, requireRole } = require('../middleware/auth')

const router = express.Router()
router.use(protect)
router.use(requireRole('admin'))

// ── GET all marketing logs (filterlash mumkin) ──
router.get('/', async (req, res) => {
  try {
    const { days = 30 } = req.query
    const since = new Date()
    since.setDate(since.getDate() - Number(days))

    const logs = await prisma.marketingLog.findMany({
      where: { date: { gte: since } },
      orderBy: { date: 'desc' }
    })
    res.json(logs)
  } catch (e) {
    console.error('Marketing GET error:', e)
    res.status(500).json({ message: 'Xatolik' })
  }
})

// ── GET summary (kanal, kunlik, jami) ──
router.get('/summary', async (req, res) => {
  try {
    const { days, filter, startDate, endDate } = req.query
    let where = {}

    if (filter && filter !== 'all') {
      const now = new Date()
      let start, end = new Date(now)
      if (filter === 'today') {
        start = new Date(now); start.setHours(0,0,0,0); end.setHours(23,59,59,999)
      } else if (filter === 'yesterday') {
        start = new Date(now); start.setDate(start.getDate()-1); start.setHours(0,0,0,0)
        end = new Date(start); end.setHours(23,59,59,999)
      } else if (filter === 'month') {
        start = new Date(now); start.setDate(1); start.setHours(0,0,0,0); end.setHours(23,59,59,999)
      } else if (filter === 'range' && startDate && endDate) {
        start = new Date(startDate); start.setHours(0,0,0,0)
        end = new Date(endDate); end.setHours(23,59,59,999)
      }
      if (start) where.date = { gte: start, lte: end }
    } else if (days) {
      const since = new Date(); since.setDate(since.getDate() - Number(days))
      where.date = { gte: since }
    }

    const logs = await prisma.marketingLog.findMany({
      where,
      orderBy: { date: 'desc' }
    })

    const totalSpent = logs.reduce((s, l) => s + l.spent, 0)
    const totalLeads = logs.reduce((s, l) => s + l.leads, 0)
    const cpl = totalLeads > 0 ? totalSpent / totalLeads : 0

    // By channel
    const byChannel = {}
    logs.forEach(l => {
      if (!byChannel[l.channel]) byChannel[l.channel] = { spent: 0, leads: 0 }
      byChannel[l.channel].spent += l.spent
      byChannel[l.channel].leads += l.leads
    })

    // Last 7 days daily
    const dailyMap = {}
    logs.forEach(l => {
      const d = new Date(l.date).toISOString().split('T')[0]
      if (!dailyMap[d]) dailyMap[d] = { spent: 0, leads: 0 }
      dailyMap[d].spent += l.spent
      dailyMap[d].leads += l.leads
    })

    res.json({
      totalSpent,
      totalLeads,
      cpl,
      byChannel: Object.entries(byChannel).map(([channel, v]) => ({
        channel,
        spent: v.spent,
        leads: v.leads,
        cpl: v.leads > 0 ? v.spent / v.leads : 0
      })).sort((a, b) => b.spent - a.spent),
      daily: Object.entries(dailyMap)
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-14),
      logs: logs.slice(0, 50)
    })
  } catch (e) {
    console.error('Marketing summary error:', e)
    res.json({ totalSpent: 0, totalLeads: 0, cpl: 0, byChannel: [], daily: [], logs: [] })
  }
})

// ── POST — yangi kun uchun marketing xarajat qo'shish ──
router.post('/', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { date, channel, campaign, spent, leads, notes } = req.body
    if (!date || !channel) return res.status(400).json({ message: 'date va channel majburiy' })

    const log = await prisma.marketingLog.create({
      data: {
        date: new Date(date),
        channel: String(channel).trim(),
        campaign: campaign ? String(campaign).trim() : null,
        spent: Number(spent) || 0,
        leads: Number(leads) || 0,
        notes: notes ? String(notes).trim() : null
      }
    })
    res.json(log)
  } catch (e) {
    console.error('Marketing POST error:', e)
    res.status(500).json({ message: 'Xatolik' })
  }
})

// ── PUT — tahrirlash ──
router.put('/:id', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { date, channel, campaign, spent, leads, notes } = req.body
    const log = await prisma.marketingLog.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(date && { date: new Date(date) }),
        ...(channel && { channel: String(channel).trim() }),
        campaign: campaign ? String(campaign).trim() : null,
        spent: Number(spent) || 0,
        leads: Number(leads) || 0,
        notes: notes ? String(notes).trim() : null
      }
    })
    res.json(log)
  } catch (e) {
    res.status(500).json({ message: 'Xatolik' })
  }
})

// ── DELETE ──
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await prisma.marketingLog.delete({ where: { id: Number(req.params.id) } })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: 'Xatolik' })
  }
})

// ═══════════════════════════════════════════════
// HODIMLAR OYLIK / KPI
// ═══════════════════════════════════════════════

// GET manager salary + fines
router.get('/salary/:managerId', async (req, res) => {
  try {
    const managerId = Number(req.params.managerId)
    const month = req.query.month || new Date().toISOString().slice(0, 7)

    const salary = await prisma.managerSalary.findUnique({ where: { managerId } })
    const fines = await prisma.managerFine.findMany({
      where: { managerId, month },
      orderBy: { createdAt: 'desc' }
    })
    res.json({
      baseSalary: salary?.baseSalary || 0,
      fines,
      totalFines: fines.reduce((s, f) => s + f.amount, 0)
    })
  } catch (e) {
    res.json({ baseSalary: 0, fines: [], totalFines: 0 })
  }
})

// POST/PUT base salary
router.post('/salary/:managerId', requireRole('admin'), async (req, res) => {
  try {
    const managerId = Number(req.params.managerId)
    const baseSalary = Number(req.body.baseSalary) || 0
    const record = await prisma.managerSalary.upsert({
      where: { managerId },
      update: { baseSalary },
      create: { managerId, baseSalary }
    })
    res.json(record)
  } catch (e) {
    res.status(500).json({ message: 'Xatolik' })
  }
})

// POST jarima
router.post('/fine', requireRole('admin'), async (req, res) => {
  try {
    const { managerId, amount, reason, month } = req.body
    if (!managerId || !amount) return res.status(400).json({ message: 'managerId va amount majburiy' })
    const fine = await prisma.managerFine.create({
      data: {
        managerId: Number(managerId),
        amount: Number(amount),
        reason: reason || null,
        month: month || new Date().toISOString().slice(0, 7)
      }
    })
    res.json(fine)
  } catch (e) {
    res.status(500).json({ message: 'Xatolik' })
  }
})

// DELETE jarima
router.delete('/fine/:id', requireRole('admin'), async (req, res) => {
  try {
    await prisma.managerFine.delete({ where: { id: Number(req.params.id) } })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: 'Xatolik' })
  }
})

// GET all salaries + fines (for dashboard KPI table)
router.get('/salaries', async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7)
    const salaries = await prisma.managerSalary.findMany({
      include: { manager: { select: { id: true, fullName: true, email: true } } }
    })
    const fines = await prisma.managerFine.findMany({ where: { month } })

    const result = salaries.map(s => {
      const mgrFines = fines.filter(f => f.managerId === s.managerId)
      return {
        managerId: s.managerId,
        name: s.manager?.fullName || s.manager?.email || 'Noma\'lum',
        email: s.manager?.email || null,
        baseSalary: s.baseSalary,
        fines: mgrFines,
        totalFines: mgrFines.reduce((sum, f) => sum + f.amount, 0)
      }
    })
    res.json(result)
  } catch (e) {
    res.json([])
  }
})

module.exports = router
