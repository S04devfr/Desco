/**
 * Professional Excel Export — Ko'p varaqli hisobot
 * GET /api/export/excel?filter=month&startDate=&endDate=
 */
const router = require('express').Router()
const XLSX   = require('xlsx')
const prisma = require('../config/database')
const { protect, requireRole } = require('../middleware/auth')

router.use(protect)
router.use(requireRole('admin'))

// ── helpers ──────────────────────────────────────────────────────────────────
const fmt  = (n) => Number(n || 0).toLocaleString('uz-UZ')
const fmtD = (d) => d ? new Date(d).toLocaleDateString('uz-UZ') : ''
const fmtDT= (d) => d ? new Date(d).toLocaleString('uz-UZ')  : ''

/** header style: bold, colored bg, white text */
function hStyle(hex = '1E3A5F') {
  return {
    font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
    fill:      { patternType: 'solid', fgColor: { rgb: hex } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: {
      top:    { style: 'thin', color: { rgb: 'AAAAAA' } },
      bottom: { style: 'thin', color: { rgb: 'AAAAAA' } },
      left:   { style: 'thin', color: { rgb: 'AAAAAA' } },
      right:  { style: 'thin', color: { rgb: 'AAAAAA' } },
    }
  }
}

/** alternate row style */
function rowStyle(even) {
  return {
    fill: { patternType: 'solid', fgColor: { rgb: even ? 'EBF2FA' : 'FFFFFF' } },
    alignment: { vertical: 'center' },
    border: {
      top:    { style: 'thin', color: { rgb: 'DDDDDD' } },
      bottom: { style: 'thin', color: { rgb: 'DDDDDD' } },
      left:   { style: 'thin', color: { rgb: 'DDDDDD' } },
      right:  { style: 'thin', color: { rgb: 'DDDDDD' } },
    }
  }
}

/**
 * Build a styled worksheet from headers + rows array-of-arrays.
 * headers: [{label, width}]
 * rows:    array of arrays (values matching header columns)
 * headerHex: header background color
 */
function buildSheet(headers, rows, headerHex) {
  const ws = {}
  const R0 = 0   // header row index

  // write headers
  headers.forEach((h, c) => {
    const addr = XLSX.utils.encode_cell({ r: R0, c })
    ws[addr] = { v: h.label, t: 's', s: hStyle(headerHex) }
  })

  // write data rows
  rows.forEach((row, ri) => {
    const r = R0 + 1 + ri
    row.forEach((val, c) => {
      const addr = XLSX.utils.encode_cell({ r, c })
      const isNum = typeof val === 'number'
      ws[addr] = { v: val ?? '', t: isNum ? 'n' : 's', s: rowStyle(ri % 2 === 0) }
    })
  })

  // range
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: rows.length, c: headers.length - 1 }
  })

  // column widths
  ws['!cols'] = headers.map(h => ({ wch: h.width || 18 }))

  // freeze top row — correct SheetJS syntax
  ws['!sheetviews'] = [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }]

  return ws
}

// ── date filter helper ────────────────────────────────────────────────────────
function dateWhere(filter, startDate, endDate) {
  const now = new Date()
  if (filter === 'today') {
    const s = new Date(now); s.setHours(0,0,0,0)
    const e = new Date(now); e.setHours(23,59,59,999)
    return { gte: s, lte: e }
  }
  if (filter === 'month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1)
    const e = new Date(now.getFullYear(), now.getMonth()+1, 0, 23, 59, 59, 999)
    return { gte: s, lte: e }
  }
  if (filter === 'range' && startDate && endDate) {
    return { gte: new Date(startDate), lte: new Date(endDate + 'T23:59:59') }
  }
  return undefined  // "all"
}

// ── STATUS labels ────────────────────────────────────────────────────────────
const STATUS_LABEL = {
  new: 'Yangi', contacted: 'Bog\'landi', negotiating: 'Muzokaralar',
  won: 'Yutildi', lost: 'Yo\'qotildi', delivered: 'Yetkazildi',
  completed: 'Bajarildi'
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ROUTE
// ─────────────────────────────────────────────────────────────────────────────
router.get('/excel', async (req, res) => {
  try {
    const { filter = 'month', startDate, endDate } = req.query
    const createdAtFilter = dateWhere(filter, startDate, endDate)
    const dateWh = createdAtFilter ? { createdAt: createdAtFilter } : {}

    // ── 1. SDELKALAR ──────────────────────────────────────────────────────────
    const deals = await prisma.deal.findMany({
      where: dateWh,
      include: {
        client:   { select: { name: true, phone: true } },
        manager:  { select: { fullName: true, email: true } },
        stage:    { select: { name: true } },
        pipeline: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' }
    })

    const dealHeaders = [
      { label: '№',            width: 5  },
      { label: 'Mahsulot',     width: 22 },
      { label: 'Mijoz',        width: 20 },
      { label: 'Telefon',      width: 15 },
      { label: 'Menejer',      width: 20 },
      { label: 'Summa (so\'m)',  width: 18 },
      { label: 'To\'lov (so\'m)',width: 18 },
      { label: 'Qoldiq (so\'m)', width: 18 },
      { label: 'Holat',        width: 14 },
      { label: 'Bosqich',      width: 16 },
      { label: 'Voronka',      width: 16 },
      { label: 'Yaratildi',    width: 16 },
    ]

    const dealRows = deals.map((d, i) => [
      i + 1,
      d.productName,
      d.client?.name || '',
      d.client?.phone || '',
      d.manager?.fullName || d.manager?.email || '',
      Number(d.amount || 0),
      Number(d.paidAmount || 0),
      Number((d.amount || 0) - (d.paidAmount || 0)),
      STATUS_LABEL[d.status] || d.status,
      d.stage?.name || '',
      d.pipeline?.name || '',
      fmtD(d.createdAt),
    ])

    // totals row
    const dealTotals = ['', 'JAMI', '', '', '',
      deals.reduce((s,d)=>s+Number(d.amount||0), 0),
      deals.reduce((s,d)=>s+Number(d.paidAmount||0), 0),
      deals.reduce((s,d)=>s+Number((d.amount||0)-(d.paidAmount||0)), 0),
      '', '', '', ''
    ]
    dealRows.push(dealTotals)

    const wsDeals = buildSheet(dealHeaders, dealRows, '1E3A5F')

    // ── 2. MIJOZLAR ──────────────────────────────────────────────────────────
    const clients = await prisma.client.findMany({
      where: dateWh,
      include: { owner: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' }
    })

    const clientHeaders = [
      { label: '№',          width: 5  },
      { label: 'Ism',        width: 22 },
      { label: 'Telefon',    width: 15 },
      { label: 'Email',      width: 22 },
      { label: 'Kompaniya',  width: 20 },
      { label: 'Shahar',     width: 14 },
      { label: 'Qaarz (so\'m)', width: 18 },
      { label: 'Mas\'ul',   width: 20 },
      { label: 'Yaratildi',  width: 16 },
    ]

    const clientRows = clients.map((c, i) => [
      i + 1,
      c.name,
      c.phone || '',
      c.email || '',
      c.company || '',
      c.city || '',
      Number(c.debt || 0),
      c.owner?.fullName || '',
      fmtD(c.createdAt),
    ])

    const wsClients = buildSheet(clientHeaders, clientRows, '15618A')

    // ── 3. XARAJATLAR ────────────────────────────────────────────────────────
    const expenses = await prisma.expense.findMany({
      where: dateWh,
      include: { createdBy: { select: { fullName: true } } },
      orderBy: { date: 'desc' }
    })

    const CAT_LABEL = {
      salary: 'Maosh', rent: 'Ijara', ads: 'Reklama',
      logistics: 'Logistika', equipment: 'Uskunalar', other: 'Boshqa'
    }

    const expHeaders = [
      { label: '№',             width: 5  },
      { label: 'Tavsif',        width: 28 },
      { label: 'Kategoriya',    width: 16 },
      { label: 'Summa (so\'m)', width: 18 },
      { label: 'Sana',          width: 14 },
      { label: 'Kim qo\'shdi',  width: 20 },
    ]

    const expRows = expenses.map((e, i) => [
      i + 1,
      e.description,
      CAT_LABEL[e.category] || e.category,
      Number(e.amount || 0),
      fmtD(e.date),
      e.createdBy?.fullName || '',
    ])

    expRows.push(['', 'JAMI', '', expenses.reduce((s,e)=>s+Number(e.amount||0),0), '', ''])

    const wsExpenses = buildSheet(expHeaders, expRows, '8B1A1A')

    // ── 4. MARKETING ─────────────────────────────────────────────────────────
    const mktLogs = await prisma.marketingLog.findMany({
      where: createdAtFilter ? { date: createdAtFilter } : {},
      orderBy: { date: 'desc' }
    })

    const CH_LABEL = {
      instagram: 'Instagram', facebook: 'Facebook', google: 'Google',
      tiktok: 'TikTok', other: 'Boshqa'
    }

    const mktHeaders = [
      { label: '№',             width: 5  },
      { label: 'Sana',          width: 14 },
      { label: 'Kanal',         width: 14 },
      { label: 'Kampaniya',     width: 22 },
      { label: 'Xarajat (so\'m)', width: 18 },
      { label: 'Leadlar',       width: 12 },
      { label: 'CPL (so\'m)',   width: 16 },
      { label: 'Izoh',          width: 24 },
    ]

    const mktRows = mktLogs.map((m, i) => {
      const cpl = m.leads > 0 ? Math.round(m.spent / m.leads) : 0
      return [
        i + 1,
        fmtD(m.date),
        CH_LABEL[m.channel] || m.channel,
        m.campaign || '',
        Number(m.spent || 0),
        Number(m.leads || 0),
        cpl,
        m.notes || '',
      ]
    })

    const totalSpent = mktLogs.reduce((s,m)=>s+Number(m.spent||0),0)
    const totalLeads = mktLogs.reduce((s,m)=>s+Number(m.leads||0),0)
    mktRows.push(['', 'JAMI', '', '', totalSpent, totalLeads,
      totalLeads > 0 ? Math.round(totalSpent/totalLeads) : 0, ''])

    const wsMkt = buildSheet(mktHeaders, mktRows, '5B2D8E')

    // ── 5. MENEJERLAR KPI ────────────────────────────────────────────────────
    const managers = await prisma.user.findMany({
      where: { role: { in: ['manager', 'admin'] }, isActive: true },
      include: { managerSalary: true, managerFines: true },
      orderBy: { fullName: 'asc' }
    })

    // deals per manager
    const mgrDealsRaw = await prisma.deal.groupBy({
      by: ['managerId'],
      where: { ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) },
      _count: { id: true },
      _sum: { amount: true, paidAmount: true },
    })
    const mgrMap = {}
    mgrDealsRaw.forEach(r => {
      mgrMap[r.managerId] = {
        count: r._count.id,
        amount: r._sum.amount || 0,
        paid:   r._sum.paidAmount || 0,
      }
    })

    const wonDealsRaw = await prisma.deal.groupBy({
      by: ['managerId'],
      where: { status: 'won', ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) },
      _count: { id: true },
    })
    const wonMap = {}
    wonDealsRaw.forEach(r => { wonMap[r.managerId] = r._count.id })

    const kpiHeaders = [
      { label: '№',              width: 5  },
      { label: 'Menejer',        width: 22 },
      { label: 'Email',          width: 24 },
      { label: 'Rol',            width: 12 },
      { label: 'Sdelkalar',      width: 12 },
      { label: 'Yutilgan',       width: 12 },
      { label: 'Konversiya %',   width: 14 },
      { label: 'Jami summa',     width: 18 },
      { label: 'To\'langan',     width: 18 },
      { label: 'Base maosh',     width: 16 },
      { label: 'Jarimalar',      width: 14 },
    ]

    const kpiRows = managers.map((m, i) => {
      const md   = mgrMap[m.id] || { count: 0, amount: 0, paid: 0 }
      const won  = wonMap[m.id] || 0
      const conv = md.count > 0 ? Math.round((won / md.count) * 100) : 0
      const fines = m.managerFines.reduce((s,f)=>s+Number(f.amount||0), 0)
      return [
        i + 1,
        m.fullName || '',
        m.email,
        m.role === 'admin' ? 'Admin' : 'Menejer',
        md.count,
        won,
        conv,
        Number(md.amount),
        Number(md.paid),
        Number(m.managerSalary?.baseSalary || 0),
        Number(fines),
      ]
    })

    const wsKPI = buildSheet(kpiHeaders, kpiRows, '1A6B1A')

    // ── 6. OMBOR ──────────────────────────────────────────────────────────────
    const stocks = await prisma.warehouseStock.findMany({ orderBy: [{ warehouse: 'asc' }, { productName: 'asc' }] })

    const whHeaders = [
      { label: '№',           width: 5  },
      { label: 'Mahsulot',    width: 26 },
      { label: 'Ombor',       width: 18 },
      { label: 'Zaxira (dona)', width: 16 },
    ]

    const whRows = stocks.map((s, i) => [
      i + 1,
      s.productName,
      s.warehouse,
      Number(s.stock || 0),
    ])

    const wsWh = buildSheet(whHeaders, whRows, '7B4B00')

    // ── ASSEMBLE WORKBOOK ─────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, wsDeals,    'Sdelkalar')
    XLSX.utils.book_append_sheet(wb, wsClients,  'Mijozlar')
    XLSX.utils.book_append_sheet(wb, wsExpenses, 'Xarajatlar')
    XLSX.utils.book_append_sheet(wb, wsMkt,      'Marketing')
    XLSX.utils.book_append_sheet(wb, wsKPI,      'Menejerlar KPI')
    XLSX.utils.book_append_sheet(wb, wsWh,       'Ombor')

    // file name with date range
    const today = new Date().toISOString().slice(0, 10)
    const fname = `DESCO_Hisobot_${today}.xlsx`

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true })

    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.send(buf)

  } catch (err) {
    console.error('Excel export error:', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
