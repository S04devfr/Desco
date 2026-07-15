const express = require('express')
const prisma = require('../config/database')
const { protect, requireRole } = require('../middleware/auth')

const router = express.Router()
router.use(protect)
router.use(requireRole('admin', 'manager'))

// ── deal + client info selector ──
const dealInclude = {
  deal: {
    select: {
      id: true,
      productName: true,
      amount: true,
      paidAmount: true,
      status: true,
      createdAt: true,
      client: { select: { id: true, name: true, phone: true, city: true, company: true } },
      manager: { select: { id: true, fullName: true, email: true } },
      stage:   { select: { name: true, color: true } }
    }
  }
}

// ── GET /api/delivery — barcha delivery loglar ──
// ?filter=active|paid|unpaid|all  default: active
router.get('/', async (req, res) => {
  try {
    const filter = req.query.filter || 'active'
    let where = {}

    if (filter === 'active') {
      // Yo'lda + yetib bordi lekin to'lanmagan
      where = {
        OR: [
          { status: 'dispatched' },
          { status: 'delivered', paymentStatus: { not: 'paid' } }
        ]
      }
    } else if (filter === 'dispatched') {
      where = { status: 'dispatched' }
    } else if (filter === 'delivered') {
      where = { status: 'delivered' }
    } else if (filter === 'unpaid') {
      where = { paymentStatus: { not: 'paid' }, status: { not: 'cancelled' } }
    } else if (filter === 'paid') {
      where = { paymentStatus: 'paid' }
    } else if (filter === 'returned') {
      where = { status: 'returned' }
    }
    // filter === 'all' → where = {} (barchasi)

    const logs = await prisma.deliveryLog.findMany({
      where,
      include: dealInclude,
      orderBy: [
        { status: 'asc' },        // dispatched first
        { dispatchDate: 'desc' }
      ]
    })

    res.json(logs)
  } catch (e) {
    console.error('Delivery GET error:', e)
    res.status(500).json({ message: 'Xatolik' })
  }
})

// ── Prisma db push bo'lganmi tekshirish ──
async function hasDeliveryTable() {
  try {
    await prisma.$queryRaw`SELECT 1 FROM DeliveryLog LIMIT 1`
    return true
  } catch (_) {
    return false
  }
}

// ── GET /api/delivery/stats — raqamlar ──
router.get('/stats', async (req, res) => {
  if (!(await hasDeliveryTable())) {
    return res.json({ dispatched: 0, delivered: 0, unpaid: 0, returned: 0, totalUnpaidAmount: 0 })
  }
  try {
    const [dispatched, delivered, unpaid, returned] = await Promise.all([
      prisma.deliveryLog.count({ where: { status: 'dispatched' } }),
      prisma.deliveryLog.count({ where: { status: 'delivered' } }),
      prisma.deliveryLog.count({ where: { paymentStatus: { not: 'paid' }, status: { not: 'cancelled' } } }),
      prisma.deliveryLog.count({ where: { status: 'returned' } })
    ])

    const unpaidLogs = await prisma.deliveryLog.findMany({
      where: { paymentStatus: { not: 'paid' }, status: { not: 'cancelled' } },
      include: { deal: { select: { amount: true } } }
    })
    const totalUnpaidAmount = unpaidLogs.reduce((sum, l) => {
      return sum + Math.max((l.deal?.amount || 0) - l.collectedAmount, 0)
    }, 0)

    res.json({ dispatched, delivered, unpaid, returned, totalUnpaidAmount })
  } catch (e) {
    res.json({ dispatched: 0, delivered: 0, unpaid: 0, returned: 0, totalUnpaidAmount: 0 })
  }
})

// ── GET /api/delivery/search-deals ──
router.get('/search-deals', async (req, res) => {
  try {
    const q = (req.query.q || '').trim()
    console.log('[delivery] search-deals q=', q)

    if (!q) return res.json([])

    const numId = parseInt(q, 10)
    const byId  = !isNaN(numId) ? [{ id: numId }] : []

    // Avval barcha deallarni olib, JS da filtr qilamiz (eng ishonchli)
    const all = await prisma.deal.findMany({
      include: {
        client: { select: { name: true, phone: true, city: true } },
        stage:  { select: { name: true } }
      },
      orderBy: { id: 'desc' },
      take: 200
    })

    const ql = q.toLowerCase()
    const filtered = all.filter(d =>
      (d.id === numId) ||
      (d.productName || '').toLowerCase().includes(ql) ||
      (d.client?.name  || '').toLowerCase().includes(ql) ||
      (d.client?.phone || '').includes(q) ||
      (d.client?.city  || '').toLowerCase().includes(ql)
    ).slice(0, 15)

    console.log('[delivery] search-deals found:', filtered.length)
    res.json(filtered)
  } catch (e) {
    console.error('[delivery] search-deals error:', e.message)
    res.json([])
  }
})

// ── POST /api/delivery — yangi delivery log yaratish ──
router.post('/', async (req, res) => {
  try {
    const { dealId, shopirName, dispatchDate, destination, notes } = req.body
    if (!dealId) return res.status(400).json({ message: 'dealId majburiy' })

    // Allaqachon bor-yo'qligini tekshir
    const existing = await prisma.deliveryLog.findUnique({ where: { dealId: Number(dealId) } })
    if (existing) return res.status(409).json({ message: 'Bu zakaz allaqachon kuzatuvda' })

    const log = await prisma.deliveryLog.create({
      data: {
        dealId:       Number(dealId),
        shopirName:   shopirName  ? String(shopirName).trim()  : null,
        dispatchDate: dispatchDate ? new Date(dispatchDate)    : new Date(),
        destination:  destination ? String(destination).trim() : null,
        notes:        notes       ? String(notes).trim()       : null,
        status:       'dispatched',
        paymentStatus:'unpaid',
        updatedBy:    req.user?.fullName || req.user?.email || null
      },
      include: dealInclude
    })

    res.json(log)
  } catch (e) {
    console.error('Delivery POST error:', e)
    res.status(500).json({ message: 'Xatolik: ' + e.message })
  }
})

// ── PUT /api/delivery/:id — holat / to'lov yangilash ──
router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const {
      status,
      paymentStatus,
      collectedAmount,
      paymentNotes,
      shopirName,
      destination,
      notes,
      deliveredDate
    } = req.body

    const data = {
      updatedBy: req.user?.fullName || req.user?.email || null
    }

    if (status          !== undefined) data.status          = status
    if (paymentStatus   !== undefined) data.paymentStatus   = paymentStatus
    if (collectedAmount !== undefined) data.collectedAmount  = Number(collectedAmount) || 0
    if (paymentNotes    !== undefined) data.paymentNotes    = paymentNotes || null
    if (shopirName      !== undefined) data.shopirName      = shopirName   || null
    if (destination     !== undefined) data.destination     = destination  || null
    if (notes           !== undefined) data.notes           = notes        || null

    // Yetib bordi deb belgilanganda avtomatik sana
    if (status === 'delivered' && !deliveredDate) {
      data.deliveredDate = new Date()
    } else if (deliveredDate) {
      data.deliveredDate = new Date(deliveredDate)
    }

    const log = await prisma.deliveryLog.update({
      where: { id },
      data,
      include: dealInclude
    })

    res.json(log)
  } catch (e) {
    console.error('Delivery PUT error:', e)
    res.status(500).json({ message: 'Xatolik' })
  }
})

// ── DELETE /api/delivery/:id ──
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await prisma.deliveryLog.delete({ where: { id: Number(req.params.id) } })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: 'Xatolik' })
  }
})

module.exports = router
